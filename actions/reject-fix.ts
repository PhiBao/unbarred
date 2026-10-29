import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { audits, evidence, fixes, issues } from "../server/db/schema.js";
import { newId, nowIso, requireEmail } from "../server/lib/access.js";

export default defineAction({
  deferLoading: false,
  description:
    "Reject a proposed fix and record why. The barrier stays open and is never counted as verified.",
  schema: z.object({
    issueId: z.string().describe("Issue id from list-issues"),
    reason: z.string().max(600).default("").describe("Why this fix is not right"),
  }),
  outputSchema: z.object({ ok: z.boolean(), issueStatus: z.string() }),
  run: async ({ issueId, reason }, ctx) => {
    const email = requireEmail(ctx);
    const db = getDb();
    const [row] = await db
      .select({ issue: issues })
      .from(issues)
      .innerJoin(audits, eq(issues.auditId, audits.id))
      .where(and(eq(issues.id, issueId), eq(audits.ownerEmail, email)))
      .limit(1);
    if (!row) {
      fail("That barrier was not found.", {
        errorCode: "issue_not_found",
        statusCode: 404,
      });
    }
    const issue = row.issue;
    const [existing] = await db
      .select()
      .from(fixes)
      .where(eq(fixes.issueId, issueId))
      .limit(1);
    if (existing) {
      await db
        .update(fixes)
        .set({
          status: "rejected",
          reason,
          approvedBy: null,
          approvedAt: null,
        })
        .where(eq(fixes.id, existing.id));
    }
    await db
      .update(issues)
      .set({ status: "rejected" })
      .where(eq(issues.id, issueId));
    await db.insert(evidence).values({
      id: newId(),
      auditId: issue.auditId,
      type: "fix.rejected",
      summary: `Rejected: ${issue.help} at ${issue.selector}`,
      payload: { issueId, ruleId: issue.ruleId, reason },
      actor: email,
      createdAt: nowIso(),
    });
    return { ok: true, issueStatus: "rejected" };
  },
});
