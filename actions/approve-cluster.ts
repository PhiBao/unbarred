import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { evidence, fixes, issues } from "../server/db/schema.js";
import { newId, nowIso, ownedAudit, requireEmail } from "../server/lib/access.js";

export default defineAction({
  deferLoading: false,
  description:
    "Approve every deterministic fix in one pattern at once. Judgment items (alt text, labels, language) are skipped and must be reviewed one by one.",
  needsApproval: true,
  schema: z.object({
    auditId: z.string().describe("Audit id"),
    ruleId: z.string().describe("Pattern id, for example color-contrast"),
  }),
  outputSchema: z.object({
    approved: z.number(),
    skipped: z.number(),
  }),
  run: async ({ auditId, ruleId }, ctx) => {
    const email = requireEmail(ctx);
    const db = getDb();
    await ownedAudit(auditId, email);

    const rows = await db
      .select()
      .from(issues)
      .where(and(eq(issues.auditId, auditId), eq(issues.ruleId, ruleId)));
    const eligible = rows.filter(
      (issue) =>
        issue.proposal &&
        !issue.proposal.needsHuman &&
        issue.status !== "verified",
    );
    if (eligible.length === 0) {
      fail(
        "This pattern has no deterministic fixes to approve. Review its items individually.",
        { errorCode: "no_deterministic_fixes" },
      );
    }

    for (const issue of eligible) {
      const proposal = issue.proposal!;
      const [existing] = await db
        .select()
        .from(fixes)
        .where(eq(fixes.issueId, issue.id))
        .limit(1);
      const values = {
        auditId,
        issueId: issue.id,
        kind: proposal.kind,
        selector: issue.selector,
        op: proposal.op,
        name: proposal.name,
        value: proposal.value,
        decorative: false,
        status: "approved",
        note: "",
        reason: "",
        approvedBy: email,
        approvedAt: nowIso(),
        verifiedAt: null,
      };
      if (existing) {
        await db.update(fixes).set(values).where(eq(fixes.id, existing.id));
      } else {
        await db
          .insert(fixes)
          .values({ id: newId(), ...values, createdAt: nowIso() });
      }
      await db
        .update(issues)
        .set({ status: "approved" })
        .where(eq(issues.id, issue.id));
    }

    await db.insert(evidence).values({
      id: newId(),
      auditId,
      type: "pattern.approved",
      summary: `Approved ${eligible.length} deterministic fixes for ${ruleId}.`,
      payload: { ruleId, count: eligible.length },
      actor: email,
      createdAt: nowIso(),
    });

    return {
      approved: eligible.length,
      skipped: rows.length - eligible.length,
    };
  },
});
