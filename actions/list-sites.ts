import { defineAction } from "@agent-native/core/action";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { audits, manualChecks, projects } from "../server/db/schema.js";
import { requireEmail } from "../server/lib/access.js";

export default defineAction({
  deferLoading: false,
  description:
    "List the signed-in user's client sites with their latest audit, counts, and open manual checks. Use it for an agency portfolio view or to re-audit a site.",
  schema: z.object({}),
  http: { method: "GET" },
  outputSchema: z.object({
    sites: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        url: z.string(),
        auditCount: z.number(),
        latestAuditId: z.string().nullable(),
        latestStatus: z.string().nullable(),
        lastAuditAt: z.string().nullable(),
        issueCount: z.number(),
        verifiedCount: z.number(),
        remainingCount: z.number(),
        manualOpen: z.number(),
      }),
    ),
  }),
  run: async (_args, ctx) => {
    const email = requireEmail(ctx);
    const db = getDb();

    const [projectRows, auditRows, checkRows] = await Promise.all([
      db.select().from(projects).where(eq(projects.ownerEmail, email)),
      db
        .select()
        .from(audits)
        .where(eq(audits.ownerEmail, email))
        .orderBy(desc(audits.createdAt)),
      db
        .select({
          auditId: manualChecks.auditId,
          status: manualChecks.status,
        })
        .from(manualChecks)
        .innerJoin(audits, eq(manualChecks.auditId, audits.id))
        .where(eq(audits.ownerEmail, email)),
    ]);

    const openByAudit = new Map<string, number>();
    for (const check of checkRows) {
      if (check.status === "open") {
        openByAudit.set(
          check.auditId,
          (openByAudit.get(check.auditId) ?? 0) + 1,
        );
      }
    }

    const sites = projectRows.map((project) => {
      const projectAudits = auditRows.filter(
        (audit) => audit.projectId === project.id,
      );
      const latest = projectAudits[0];
      return {
        id: project.id,
        name: project.name,
        url: project.url,
        auditCount: projectAudits.length,
        latestAuditId: latest?.id ?? null,
        latestStatus: latest?.status ?? null,
        lastAuditAt: latest?.createdAt ?? null,
        issueCount: latest?.issueCount ?? 0,
        verifiedCount: latest?.verifiedCount ?? 0,
        remainingCount: latest?.remainingCount ?? 0,
        manualOpen: latest ? (openByAudit.get(latest.id) ?? 0) : 0,
      };
    });

    sites.sort((a, b) =>
      (b.lastAuditAt ?? "").localeCompare(a.lastAuditAt ?? ""),
    );
    return { sites };
  },
});
