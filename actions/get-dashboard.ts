import { defineAction } from "@agent-native/core/action";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { audits, manualChecks, projects } from "../server/db/schema.js";
import { requireEmail } from "../server/lib/access.js";
import { toAuditSummary } from "../server/lib/queries.js";
import { zAuditSummary } from "../server/lib/schemas.js";

export default defineAction({
  deferLoading: false,
  description:
    "Read the workspace summary: sites, barriers found, fixes verified, and the most recent audits.",
  schema: z.object({}),
  http: { method: "GET" },
  outputSchema: z.object({
    totals: z.object({
      sites: z.number(),
      audits: z.number(),
      barriers: z.number(),
      verified: z.number(),
      remaining: z.number(),
      manualChecksOpen: z.number(),
    }),
    recent: z.array(zAuditSummary),
  }),
  run: async (_args, ctx) => {
    const email = requireEmail(ctx);
    const db = getDb();

    const rows = await db
      .select({ audit: audits, projectName: projects.name })
      .from(audits)
      .innerJoin(projects, eq(audits.projectId, projects.id))
      .where(eq(audits.ownerEmail, email))
      .orderBy(desc(audits.createdAt))
      .limit(8);

    const [siteRow] = await db
      .select({ count: sql<number>`count(distinct ${projects.id})` })
      .from(projects)
      .where(eq(projects.ownerEmail, email));
    const [auditRow] = await db
      .select({
        count: sql<number>`count(*)`,
        barriers: sql<number>`coalesce(sum(${audits.issueCount}), 0)`,
        verified: sql<number>`coalesce(sum(${audits.verifiedCount}), 0)`,
        remaining: sql<number>`coalesce(sum(${audits.remainingCount}), 0)`,
      })
      .from(audits)
      .where(eq(audits.ownerEmail, email));
    const [manualRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(manualChecks)
      .innerJoin(audits, eq(manualChecks.auditId, audits.id))
      .where(
        and(
          eq(audits.ownerEmail, email),
          sql`${manualChecks.status} = 'open'`,
        ),
      );

    return {
      totals: {
        sites: Number(siteRow?.count ?? 0),
        audits: Number(auditRow?.count ?? 0),
        barriers: Number(auditRow?.barriers ?? 0),
        verified: Number(auditRow?.verified ?? 0),
        remaining: Number(auditRow?.remaining ?? 0),
        manualChecksOpen: Number(manualRow?.count ?? 0),
      },
      recent: rows.map((row) => toAuditSummary(row.audit, row.projectName)),
    };
  },
});
