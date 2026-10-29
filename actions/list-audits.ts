import { defineAction } from "@agent-native/core/action";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { audits, projects } from "../server/db/schema.js";
import { requireEmail } from "../server/lib/access.js";
import { toAuditSummary } from "../server/lib/queries.js";
import { zAuditSummary } from "../server/lib/schemas.js";

export default defineAction({
  deferLoading: false,
  description:
    "List the signed-in user's recent site audits, newest first, with counts and status.",
  schema: z.object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(40)
      .default(12)
      .describe("How many audits to return; defaults to 12"),
  }),
  http: { method: "GET" },
  outputSchema: z.object({ audits: z.array(zAuditSummary) }),
  run: async ({ limit }, ctx) => {
    const email = requireEmail(ctx);
    const db = getDb();
    const rows = await db
      .select({ audit: audits, projectName: projects.name })
      .from(audits)
      .innerJoin(projects, eq(audits.projectId, projects.id))
      .where(eq(audits.ownerEmail, email))
      .orderBy(desc(audits.createdAt))
      .limit(limit);
    return {
      audits: rows.map((row) => toAuditSummary(row.audit, row.projectName)),
    };
  },
});
