import { defineAction, fail } from "@agent-native/core/action";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import {
  audits,
  clusters,
  evidence,
  fixes,
  issues,
  pages,
} from "../server/db/schema.js";
import { newId, nowIso, ownedAudit, requireEmail } from "../server/lib/access.js";
import { getEngineRescanJob } from "../server/lib/engine.js";
import { loadAuditSummary } from "../server/lib/queries.js";
import { zAuditSummary } from "../server/lib/schemas.js";

function pathOf(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.host}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return raw;
  }
}

export default defineAction({
  deferLoading: false,
  description:
    "Poll the re-scan engine job, record which fixes the independent scan verified, and refresh the patched previews.",
  schema: z.object({
    auditId: z.string().describe("Audit id"),
  }),
  outputSchema: z.object({ audit: zAuditSummary, done: z.boolean() }),
  run: async ({ auditId }, ctx) => {
    const email = requireEmail(ctx);
    const db = getDb();
    const audit = await ownedAudit(auditId, email);

    if (audit.status === "verified") {
      return { audit: (await loadAuditSummary(auditId, email))!, done: true };
    }
    if (audit.status !== "verifying" && audit.status !== "importing") {
      fail("No re-scan is running for this audit.", {
        errorCode: "no_rescan",
      });
    }
    if (!audit.rescanJobId) {
      fail("This audit has no re-scan job.", {
        errorCode: "missing_rescan_job",
      });
    }

    let job = await getEngineRescanJob(audit.rescanJobId);
    const waitMs =
      ctx?.caller === "tool" || ctx?.caller === "cli" || ctx?.caller === "mcp"
        ? 24_000
        : 0;
    const deadline = Date.now() + waitMs;
    while (
      job.status !== "complete" &&
      job.status !== "failed" &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      job = await getEngineRescanJob(audit.rescanJobId!);
    }
    if (job.status === "failed") {
      const message = job.error ?? "The re-scan could not complete.";
      await db
        .update(audits)
        .set({ status: "complete", error: `Re-scan failed: ${message}` })
        .where(eq(audits.id, auditId));
      await db.insert(evidence).values({
        id: newId(),
        auditId,
        type: "rescan.failed",
        summary: message,
        payload: { engineJobId: audit.rescanJobId },
        actor: "engine",
        createdAt: nowIso(),
      });
      return { audit: (await loadAuditSummary(auditId, email))!, done: true };
    }
    if (job.status !== "complete" || !job.result) {
      await db
        .update(audits)
        .set({
          progress: {
            phase: job.progress.phase,
            pagesDone: job.progress.pagesDone,
            pagesTotal: job.progress.pagesTotal,
            currentUrl: job.progress.currentUrl,
          },
        })
        .where(eq(audits.id, auditId));
      return { audit: (await loadAuditSummary(auditId, email))!, done: false };
    }

    const claimed = await db
      .update(audits)
      .set({ status: "importing" })
      .where(
        and(
          eq(audits.id, auditId),
          eq(audits.ownerEmail, email),
          inArray(audits.status, ["verifying"]),
        ),
      )
      .returning({ id: audits.id });
    if (claimed.length === 0) {
      return { audit: (await loadAuditSummary(auditId, email))!, done: true };
    }

    const result = job.result;
    const [pageRows, issueRows, fixRows] = await Promise.all([
      db.select().from(pages).where(eq(pages.auditId, auditId)),
      db.select().from(issues).where(eq(issues.auditId, auditId)),
      db.select().from(fixes).where(eq(fixes.auditId, auditId)),
    ]);

    const pageByPath = new Map(pageRows.map((page) => [pathOf(page.url), page]));
    const issueByPageEngine = new Map(
      issueRows.map((issue) => [`${issue.pageId}:${issue.engineId}`, issue]),
    );
    const fixByIssue = new Map(fixRows.map((fix) => [fix.issueId, fix]));
    const originalByKey = new Map(
      issueRows.map((issue) => [
        `${issue.pageId}|${issue.ruleId}|${issue.selector}`,
        issue,
      ]),
    );

    let verifiedThisRun = 0;
    let remainingThisRun = 0;
    let newThisRun = 0;
    const newIssueRows: Array<typeof issues.$inferInsert> = [];
    const verifiedEvents: Array<typeof evidence.$inferInsert> = [];
    const verifiedIssueIds = new Set<string>();

    for (const scanned of result.pages) {
      const page = pageByPath.get(pathOf(scanned.url));
      if (!page) continue;

      await db
        .update(pages)
        .set({
          patchedHtml: scanned.html,
          height: Math.round(scanned.height),
          title: scanned.title,
          issueCount: scanned.issues.length,
          updatedAt: nowIso(),
        })
        .where(eq(pages.id, page.id));

      for (const outcome of scanned.patches) {
        const issue = issueByPageEngine.get(`${page.id}:${outcome.id}`);
        if (!issue) continue;
        const fix = fixByIssue.get(issue.id);
        if (fix) {
          await db
            .update(fixes)
            .set({
              status: outcome.verified ? "verified" : "failed",
              verifiedAt: outcome.verified ? nowIso() : null,
              reason: outcome.reason,
            })
            .where(eq(fixes.id, fix.id));
        }
        await db
          .update(issues)
          .set({ status: outcome.verified ? "verified" : "remaining" })
          .where(eq(issues.id, issue.id));
        if (outcome.verified) {
          verifiedIssueIds.add(issue.id);
          verifiedThisRun += 1;
          if (verifiedEvents.length < 60) {
            verifiedEvents.push({
              id: newId(),
              auditId,
              type: "fix.verified",
              summary: `Verified by re-scan: ${issue.help} at ${issue.selector}`,
              payload: {
                issueId: issue.id,
                ruleId: issue.ruleId,
                selector: issue.selector,
                engineJobId: audit.rescanJobId,
              },
              actor: "rescan",
              createdAt: nowIso(),
            });
          }
        }
      }

      const seen = new Set<string>();
      for (const scannedIssue of scanned.issues) {
        remainingThisRun += 1;
        const key = `${page.id}|${scannedIssue.ruleId}|${scannedIssue.selector}`;
        const existing = originalByKey.get(key);
        if (existing) {
          seen.add(existing.id);
          if (existing.status !== "verified") {
            await db
              .update(issues)
              .set({ status: "remaining" })
              .where(eq(issues.id, existing.id));
          }
          continue;
        }
        newThisRun += 1;
        newIssueRows.push({
          id: `${page.id}:after:${newId()}`,
          auditId,
          pageId: page.id,
          pageUrl: scannedIssue.pageUrl || page.url,
          engineId: `after-${newId()}`,
          ruleId: scannedIssue.ruleId,
          impact: scannedIssue.impact,
          help: scannedIssue.help,
          description: scannedIssue.description,
          helpUrl: scannedIssue.helpUrl,
          tags: scannedIssue.tags ?? [],
          selector: scannedIssue.selector,
          snippet: scannedIssue.snippet,
          failureSummary: scannedIssue.failureSummary,
          rect: scannedIssue.rect ?? null,
          text: scannedIssue.text,
          tag: scannedIssue.tag,
          attrs: scannedIssue.attrs ?? {},
          proposal: scannedIssue.proposal ?? null,
          status: "open",
          origin: "rescan",
          position: issueRows.length + newIssueRows.length + 1,
          createdAt: nowIso(),
        });
      }

      for (const issue of issueRows.filter((row) => row.pageId === page.id)) {
        if (issue.status === "verified" || verifiedIssueIds.has(issue.id)) {
          continue;
        }
        if (!seen.has(issue.id)) {
          await db
            .update(issues)
            .set({ status: "resolved" })
            .where(eq(issues.id, issue.id));
        }
      }
    }

    for (let index = 0; index < newIssueRows.length; index += 60) {
      await db.insert(issues).values(newIssueRows.slice(index, index + 60));
    }

    // A pattern that only appears after patching still needs a queue row.
    const existingClusters = await db
      .select({ ruleId: clusters.ruleId })
      .from(clusters)
      .where(eq(clusters.auditId, auditId));
    const knownRules = new Set(existingClusters.map((row) => row.ruleId));
    const newClusters: Array<typeof clusters.$inferInsert> = [];
    for (const scanned of result.pages) {
      for (const cluster of scanned.clusters) {
        if (knownRules.has(cluster.ruleId)) continue;
        knownRules.add(cluster.ruleId);
        const members = [...issueRows, ...newIssueRows].filter(
          (issue) => issue.ruleId === cluster.ruleId,
        );
        newClusters.push({
          id: `${auditId}:${cluster.ruleId}`,
          auditId,
          ruleId: cluster.ruleId,
          title: cluster.title,
          description: cluster.description,
          impact: cluster.impact,
          count: members.length,
          issueIds: members.map((issue) => issue.id),
          pageUrls: cluster.pageUrls ?? [],
          fixKind: cluster.fixKind ?? null,
          needsHuman: cluster.needsHuman,
        });
      }
    }
    if (newClusters.length > 0) await db.insert(clusters).values(newClusters);

    const allFixes = await db
      .select({ status: fixes.status })
      .from(fixes)
      .where(eq(fixes.auditId, auditId));
    const verifiedTotal = allFixes.filter(
      (fix) => fix.status === "verified",
    ).length;

    await db
      .update(audits)
      .set({
        status: "verified",
        verifiedCount: verifiedTotal,
        remainingCount: remainingThisRun,
        newCount: newThisRun,
        clusterCount: knownRules.size,
        error: null,
        verifiedAt: nowIso(),
        progress: {
          phase: "complete",
          pagesDone: result.pages.length,
          pagesTotal: result.pages.length,
          currentUrl: "",
        },
      })
      .where(eq(audits.id, auditId));

    if (verifiedEvents.length > 0) {
      await db.insert(evidence).values(verifiedEvents);
    }
    await db.insert(evidence).values({
      id: newId(),
      auditId,
      type: "rescan.completed",
      summary: `Independent re-scan verified ${verifiedThisRun} fix${verifiedThisRun === 1 ? "" : "es"}. ${remainingThisRun} barrier${remainingThisRun === 1 ? "" : "s"} remain.`,
      payload: {
        verified: verifiedThisRun,
        remaining: remainingThisRun,
        newIssues: newThisRun,
        axeVersion: "4.10.2",
        engineJobId: audit.rescanJobId,
      },
      actor: "rescan",
      createdAt: nowIso(),
    });

    return { audit: (await loadAuditSummary(auditId, email))!, done: true };
  },
});
