import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { audits, evidence, fixes, issues } from "../server/db/schema.js";
import { newId, nowIso, requireEmail } from "../server/lib/access.js";
import { zFix } from "../server/lib/schemas.js";

export default defineAction({
  deferLoading: false,
  description:
    "Approve one proposed fix. This is the human checkpoint: nothing is verified until a re-scan runs. Requires approval when called by an agent.",
  needsApproval: true,
  schema: z.object({
    issueId: z.string().describe("Issue id from list-issues"),
    value: z
      .string()
      .max(600)
      .optional()
      .describe("Optional final value to save before approving"),
    decorative: z
      .boolean()
      .optional()
      .describe("For images only: mark the image decorative"),
  }),
  outputSchema: z.object({ fix: zFix }),
  run: async ({ issueId, value, decorative }, ctx) => {
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
    if (!existing) {
      fail("Save a proposed fix before approving it.", {
        errorCode: "fix_not_found",
      });
    }

    const nextValue = value === undefined ? existing.value : value;
    const nextDecorative =
      decorative === undefined ? existing.decorative : decorative;
    const emptyAllowed = existing.kind === "alt" && nextDecorative;
    if (!emptyAllowed && !nextValue.trim()) {
      fail(
        existing.kind === "alt"
          ? "Write the alt text, or mark the image as decorative."
          : "This fix needs a value before it can be approved.",
        { errorCode: "missing_value" },
      );
    }

    await db
      .update(fixes)
      .set({
        value: nextValue,
        decorative: nextDecorative,
        status: "approved",
        approvedBy: email,
        approvedAt: nowIso(),
        verifiedAt: null,
        reason: "",
      })
      .where(eq(fixes.id, existing.id));
    await db
      .update(issues)
      .set({ status: "approved" })
      .where(eq(issues.id, issueId));

    await db.insert(evidence).values({
      id: newId(),
      auditId: issue.auditId,
      type: "fix.approved",
      summary: `Approved: ${issue.help} at ${issue.selector}`,
      payload: {
        issueId,
        selector: issue.selector,
        ruleId: issue.ruleId,
        value: nextDecorative ? "(decorative image)" : nextValue,
      },
      actor: email,
      createdAt: nowIso(),
    });

    const [saved] = await db
      .select()
      .from(fixes)
      .where(eq(fixes.id, existing.id));
    if (!saved) {
      fail("The fix could not be approved.", { errorCode: "save_failed" });
    }
    return {
      fix: {
        id: saved.id,
        kind: saved.kind,
        selector: saved.selector,
        op: saved.op,
        name: saved.name,
        value: saved.value,
        decorative: saved.decorative,
        status: saved.status,
        note: saved.note,
        reason: saved.reason,
        approvedBy: saved.approvedBy ?? null,
        createdAt: saved.createdAt,
        approvedAt: saved.approvedAt ?? null,
        verifiedAt: saved.verifiedAt ?? null,
      },
    };
  },
});
