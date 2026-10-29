import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { evidence, manualChecks } from "../server/db/schema.js";
import { newId, nowIso, ownedAudit, requireEmail } from "../server/lib/access.js";
import { zManualCheck } from "../server/lib/schemas.js";

export default defineAction({
  deferLoading: false,
  description:
    "Record the result of one manual accessibility check. Manual checks are separate from automated findings and stay visible in the evidence pack.",
  schema: z.object({
    auditId: z.string().describe("Audit id"),
    key: z
      .string()
      .min(1)
      .describe("Check id, for example keyboard or focus-order"),
    status: z
      .enum(["pass", "fail", "open"])
      .describe("pass, fail, or open to clear the result"),
    note: z.string().max(600).default("").describe("Optional note"),
  }),
  outputSchema: z.object({ check: zManualCheck }),
  run: async ({ auditId, key, status, note }, ctx) => {
    const email = requireEmail(ctx);
    const db = getDb();
    await ownedAudit(auditId, email);

    const [existing] = await db
      .select()
      .from(manualChecks)
      .where(
        and(eq(manualChecks.auditId, auditId), eq(manualChecks.key, key)),
      )
      .limit(1);
    if (!existing) {
      fail("That manual check does not exist on this audit.", {
        errorCode: "check_not_found",
        statusCode: 404,
      });
    }
    const completedAt = status === "open" ? null : nowIso();
    await db
      .update(manualChecks)
      .set({ status, note, completedAt })
      .where(eq(manualChecks.id, existing.id));

    if (status !== "open") {
      await db.insert(evidence).values({
        id: newId(),
        auditId,
        type: "manual.checked",
        summary: `${status === "pass" ? "Passed" : "Flagged"} manual check: ${existing.label}`,
        payload: { key, status, note },
        actor: email,
        createdAt: nowIso(),
      });
    }

    return {
      check: {
        id: existing.id,
        key: existing.key,
        label: existing.label,
        status,
        note,
        completedAt,
      },
    };
  },
});
