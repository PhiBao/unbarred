import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { audits, fixes, issues } from "../server/db/schema.js";
import { newId, nowIso, requireEmail } from "../server/lib/access.js";
import { zFix } from "../server/lib/schemas.js";

export default defineAction({
  deferLoading: false,
  description:
    "Save a proposed fix for one barrier without approving it. Editing an approved fix returns it to draft so it must be re-approved.",
  schema: z.object({
    issueId: z.string().describe("Issue id from list-issues"),
    value: z
      .string()
      .max(600)
      .default("")
      .describe(
        "The fix value: alt text, aria-label, lang, title, or a colour such as #1d1a16",
      ),
    decorative: z
      .boolean()
      .default(false)
      .describe("For images only: mark the image decorative (empty alt)"),
    note: z
      .string()
      .max(600)
      .default("")
      .describe("Optional reviewer note recorded in the ledger"),
  }),
  outputSchema: z.object({ fix: zFix, issueStatus: z.string() }),
  run: async ({ issueId, value, decorative, note }, ctx) => {
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
    if (issue.status === "verified") {
      fail("This fix is already verified by a re-scan.", {
        errorCode: "already_verified",
      });
    }
    if (!issue.proposal) {
      fail(
        "This pattern has no deterministic patch. Fix it in the source, then re-scan.",
        { errorCode: "manual_only" },
      );
    }

    const [existing] = await db
      .select()
      .from(fixes)
      .where(eq(fixes.issueId, issueId))
      .limit(1);

    const values = {
      auditId: issue.auditId,
      issueId,
      kind: issue.proposal.kind,
      selector: issue.selector,
      op: issue.proposal.op,
      name: issue.proposal.name,
      value,
      decorative,
      status: "draft",
      note,
      reason: "",
      approvedBy: null,
      approvedAt: null,
      verifiedAt: null,
    };

    let id = existing?.id;
    if (existing) {
      await db.update(fixes).set(values).where(eq(fixes.id, existing.id));
    } else {
      id = newId();
      await db.insert(fixes).values({ id, ...values, createdAt: nowIso() });
    }
    await db
      .update(issues)
      .set({ status: "open" })
      .where(eq(issues.id, issueId));

    const [saved] = await db
      .select()
      .from(fixes)
      .where(eq(fixes.id, id!));
    if (!saved) {
      fail("The fix could not be saved.", { errorCode: "save_failed" });
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
      issueStatus: "open",
    };
  },
});
