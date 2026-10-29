import { defineAction, fail } from "@agent-native/core/action";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { audits, evidence, fixes, issues, pages } from "../server/db/schema.js";
import { newId, nowIso, ownedAudit, requireEmail } from "../server/lib/access.js";
import { startEngineRescan, type EnginePatch } from "../server/lib/engine.js";
import { loadAuditSummary } from "../server/lib/queries.js";
import { zAuditSummary } from "../server/lib/schemas.js";

export default defineAction({
  deferLoading: false,
  description:
    "Re-render every page with the approved fixes applied and run an independent axe scan. Only after this can a fix be called verified.",
  schema: z.object({
    auditId: z.string().describe("Audit id"),
  }),
  outputSchema: z.object({
    audit: zAuditSummary,
    patchCount: z.number(),
    pageCount: z.number(),
  }),
  run: async ({ auditId }, ctx) => {
    const email = requireEmail(ctx);
    const db = getDb();
    const audit = await ownedAudit(auditId, email);

    if (audit.status === "verifying" || audit.status === "importing") {
      fail("A re-scan is already running for this audit.", {
        errorCode: "rescan_running",
      });
    }
    if (audit.status !== "complete" && audit.status !== "verified") {
      fail("Finish the baseline audit before re-scanning.", {
        errorCode: "audit_not_ready",
      });
    }

    const pageRows = await db
      .select()
      .from(pages)
      .where(eq(pages.auditId, auditId))
      .orderBy(asc(pages.position));
    const approved = await db
      .select({ fix: fixes, issue: issues })
      .from(fixes)
      .innerJoin(issues, eq(fixes.issueId, issues.id))
      .where(and(eq(fixes.auditId, auditId), eq(fixes.status, "approved")));
    if (approved.length === 0) {
      fail("Approve at least one fix before running a re-scan.", {
        errorCode: "no_approved_fixes",
      });
    }

    const patchesByPage = new Map<string, EnginePatch[]>();
    for (const { fix, issue } of approved) {
      const list = patchesByPage.get(issue.pageId) ?? [];
      list.push({
        id: issue.engineId,
        selector: fix.selector,
        op: fix.op,
        name: fix.name,
        value: fix.decorative ? "" : fix.value,
        ruleId: issue.ruleId,
      });
      patchesByPage.set(issue.pageId, list);
    }

    let job: { id: string };
    try {
      job = await startEngineRescan(
        pageRows.map((page) => ({
          url: page.url,
          patches: patchesByPage.get(page.id) ?? [],
        })),
      );
    } catch (error) {
      fail(
        error instanceof Error
          ? error.message
          : "The audit engine could not start the re-scan.",
        { errorCode: "engine_unavailable", statusCode: 503 },
      );
    }

    await db
      .update(audits)
      .set({
        status: "verifying",
        rescanJobId: job.id,
        verifiedAt: null,
        error: null,
        progress: {
          phase: "verifying",
          pagesDone: 0,
          pagesTotal: pageRows.length,
          currentUrl: "",
        },
      })
      .where(eq(audits.id, auditId));

    await db.insert(evidence).values({
      id: newId(),
      auditId,
      type: "rescan.started",
      summary: `Re-scan started: ${approved.length} approved fixes across ${pageRows.length} pages.`,
      payload: {
        patchCount: approved.length,
        pageCount: pageRows.length,
        engineJobId: job.id,
      },
      actor: email,
      createdAt: nowIso(),
    });

    const summary = await loadAuditSummary(auditId, email);
    return {
      audit: summary!,
      patchCount: approved.length,
      pageCount: pageRows.length,
    };
  },
});
