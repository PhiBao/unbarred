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
  manualChecks,
  pages,
  projects,
} from "../server/db/schema.js";
import {
  newId,
  nowIso,
  ownedAudit,
  requireEmail,
  siteName,
} from "../server/lib/access.js";
import { getEngineAuditJob } from "../server/lib/engine.js";
import { MANUAL_CHECKS } from "../server/lib/manual-checks.js";
import { loadAuditSummary } from "../server/lib/queries.js";
import { zAuditSummary } from "../server/lib/schemas.js";

export default defineAction({
  deferLoading: false,
  description:
    "Poll the audit engine and import findings once the scan completes. Call repeatedly while the audit status is queued or running.",
  schema: z.object({
    auditId: z.string().describe("Audit id returned by start-audit"),
  }),
  outputSchema: z.object({ audit: zAuditSummary, done: z.boolean() }),
  run: async ({ auditId }, ctx) => {
    const email = requireEmail(ctx);
    const db = getDb();
    const audit = await ownedAudit(auditId, email);

    if (["complete", "verified", "failed"].includes(audit.status)) {
      const summary = await loadAuditSummary(auditId, email);
      return { audit: summary!, done: true };
    }
    if (!audit.engineJobId) {
      fail("This audit has no engine job yet.", {
        errorCode: "missing_engine_job",
      });
    }

    let job = await getEngineAuditJob(audit.engineJobId);

    // A tool caller should not have to guess how many times to poll. Wait for
    // the engine here (bounded well under the 60s tool timeout) so one call can
    // return the imported result. The UI keeps its own short interval.
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
      job = await getEngineAuditJob(audit.engineJobId!);
    }

    if (job.status === "failed") {
      const message = job.error ?? "The audit engine could not render the page.";
      await db
        .update(audits)
        .set({ status: "failed", error: message })
        .where(eq(audits.id, auditId));
      if (job.progress) {
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
      }
      await db.insert(evidence).values({
        id: newId(),
        auditId,
        type: "audit.failed",
        summary: message,
        payload: { engineJobId: audit.engineJobId },
        actor: "engine",
        createdAt: nowIso(),
      });
      const summary = await loadAuditSummary(auditId, email);
      return { audit: summary!, done: true };
    }

    if (job.status !== "complete" || !job.result) {
      await db
        .update(audits)
        .set({
          status: "running",
          progress: {
            phase: job.progress.phase,
            pagesDone: job.progress.pagesDone,
            pagesTotal: job.progress.pagesTotal,
            currentUrl: job.progress.currentUrl,
          },
        })
        .where(eq(audits.id, auditId));
      const summary = await loadAuditSummary(auditId, email);
      return { audit: summary!, done: false };
    }

    // Only one caller may import this job. A conditional status change is the
    // lock: zero updated rows means another sync already claimed it.
    const claimed = await db
      .update(audits)
      .set({ status: "importing" })
      .where(
        and(
          eq(audits.id, auditId),
          eq(audits.ownerEmail, email),
          inArray(audits.status, ["queued", "running"]),
        ),
      )
      .returning({ id: audits.id });
    if (claimed.length === 0) {
      const summary = await loadAuditSummary(auditId, email);
      return { audit: summary!, done: summary?.status !== "running" };
    }

    const result = job.result;
    await db.delete(fixes).where(eq(fixes.auditId, auditId));
    await db.delete(issues).where(eq(issues.auditId, auditId));
    await db.delete(clusters).where(eq(clusters.auditId, auditId));
    await db.delete(pages).where(eq(pages.auditId, auditId));
    await db.delete(manualChecks).where(eq(manualChecks.auditId, auditId));

    const pageIdByUrl = new Map<string, string>();
    const pageRows = result.pages.map((page, index) => {
      const id = newId();
      pageIdByUrl.set(page.url, id);
      return {
        id,
        auditId,
        url: page.url,
        title: page.title,
        html: page.html,
        patchedHtml: null,
        height: Math.round(page.height),
        issueCount: page.issues.length,
        position: index,
        updatedAt: nowIso(),
      };
    });
    if (pageRows.length > 0) await db.insert(pages).values(pageRows);

    let position = 0;
    const issueRows: Array<typeof issues.$inferInsert> = [];
    for (const page of result.pages) {
      const pageId = pageIdByUrl.get(page.url)!;
      for (const issue of page.issues) {
        position += 1;
        issueRows.push({
          id: `${pageId}:${issue.id}`,
          auditId,
          pageId,
          pageUrl: page.url,
          engineId: issue.id,
          ruleId: issue.ruleId,
          impact: issue.impact,
          help: issue.help,
          description: issue.description,
          helpUrl: issue.helpUrl,
          tags: issue.tags ?? [],
          selector: issue.selector,
          snippet: issue.snippet,
          failureSummary: issue.failureSummary,
          rect: issue.rect ?? null,
          text: issue.text,
          tag: issue.tag,
          attrs: issue.attrs ?? {},
          proposal: issue.proposal ?? null,
          status: "open",
          origin: "audit",
          position,
          createdAt: nowIso(),
        });
      }
    }
    for (let index = 0; index < issueRows.length; index += 60) {
      await db.insert(issues).values(issueRows.slice(index, index + 60));
    }

    const issueIdsByRule = new Map<string, string[]>();
    for (const issue of issueRows) {
      const list = issueIdsByRule.get(issue.ruleId) ?? [];
      list.push(issue.id);
      issueIdsByRule.set(issue.ruleId, list);
    }
    const clusterRows = result.clusters.map((cluster) => ({
      id: `${auditId}:${cluster.ruleId}`,
      auditId,
      ruleId: cluster.ruleId,
      title: cluster.title,
      description: cluster.description,
      impact: cluster.impact,
      count: issueIdsByRule.get(cluster.ruleId)?.length ?? cluster.count,
      issueIds: issueIdsByRule.get(cluster.ruleId) ?? [],
      pageUrls: cluster.pageUrls ?? [],
      fixKind: cluster.fixKind ?? null,
      needsHuman: cluster.needsHuman,
    }));
    if (clusterRows.length > 0) await db.insert(clusters).values(clusterRows);

    await db.insert(manualChecks).values(
      MANUAL_CHECKS.map((check) => ({
        id: newId(),
        auditId,
        key: check.key,
        label: check.label,
        status: "open",
        note: "",
        completedAt: null,
      })),
    );

    await db
      .update(audits)
      .set({
        status: "complete",
        axeVersion: result.axeVersion,
        pageCount: result.pages.length,
        issueCount: result.totals.issues,
        clusterCount: clusterRows.length,
        error: null,
        completedAt: nowIso(),
        progress: {
          phase: "complete",
          pagesDone: result.pages.length,
          pagesTotal: result.pages.length,
          currentUrl: result.finalUrl,
        },
      })
      .where(eq(audits.id, auditId));

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, audit.projectId))
      .limit(1);
    const pageTitle = result.pages[0]?.title?.split(/[—–|·]/)[0]?.trim();
    if (project && pageTitle && project.name === siteName(audit.url)) {
      await db
        .update(projects)
        .set({ name: pageTitle.slice(0, 80) })
        .where(eq(projects.id, project.id));
    }

    await db.insert(evidence).values({
      id: newId(),
      auditId,
      type: "audit.completed",
      summary: `Baseline audit found ${result.totals.issues} barriers across ${result.pages.length} page${result.pages.length === 1 ? "" : "s"} in ${clusterRows.length} patterns.`,
      payload: {
        axeVersion: result.axeVersion,
        pages: result.pages.length,
        issues: result.totals.issues,
        patterns: clusterRows.length,
        byImpact: {
          critical: result.totals.critical,
          serious: result.totals.serious,
          moderate: result.totals.moderate,
          minor: result.totals.minor,
        },
      },
      actor: "engine",
      createdAt: nowIso(),
    });

    const summary = await loadAuditSummary(auditId, email);
    return { audit: summary!, done: true };
    },
});
