import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { audits, projects } from "../server/db/schema.js";
import {
  newId,
  normalizeUrl,
  nowIso,
  requireEmail,
  siteName,
} from "../server/lib/access.js";
import { startEngineAudit } from "../server/lib/engine.js";
import { toAuditSummary } from "../server/lib/queries.js";
import { zAuditSummary } from "../server/lib/schemas.js";

export default defineAction({
  deferLoading: false,
  description:
    "Start an accessibility audit for a public URL. Returns immediately with an audit id; call sync-audit to follow progress and import findings.",
  schema: z.object({
    url: z.string().describe("Public http(s) URL to audit"),
    projectId: z
      .string()
      .optional()
      .describe("Existing site id to attach this audit to"),
    maxPages: z.coerce
      .number()
      .int()
      .min(1)
      .max(6)
      .default(4)
      .describe("Same-origin pages to scan, 1-6; defaults to 4"),
  }),
  link: (ctx) => ({
    url: `/workbench/${ctx.result.auditId}`,
    label: "Open the workbench",
  }),
  outputSchema: z.object({
    auditId: z.string(),
    projectId: z.string(),
    status: z.string(),
    audit: zAuditSummary,
    engineError: z.string().nullable(),
  }),
  run: async ({ url, projectId, maxPages }, ctx) => {
    const email = requireEmail(ctx);
    const db = getDb();
    const normalized = normalizeUrl(url);

    let project: typeof projects.$inferSelect | undefined;
    if (projectId) {
      const [found] = await db
        .select()
        .from(projects)
        .where(
          and(eq(projects.id, projectId), eq(projects.ownerEmail, email)),
        )
        .limit(1);
      project = found;
    }
    if (!project) {
      const [existing] = await db
        .select()
        .from(projects)
        .where(
          and(eq(projects.ownerEmail, email), eq(projects.url, normalized)),
        )
        .limit(1);
      if (existing) {
        project = existing;
      } else {
        project = {
          id: newId(),
          name: siteName(normalized),
          url: normalized,
          ownerEmail: email,
          createdAt: nowIso(),
        };
        await db.insert(projects).values(project);
      }
    }

    const auditId = newId();
    const base = {
      id: auditId,
      projectId: project.id,
      url: normalized,
      status: "queued",
      engineJobId: null,
      rescanJobId: null,
      progress: {
        phase: "queued",
        pagesDone: 0,
        pagesTotal: maxPages,
        currentUrl: normalized,
      },
      error: null,
      axeVersion: null,
      pageCount: 0,
      issueCount: 0,
      verifiedCount: 0,
      remainingCount: 0,
      newCount: 0,
      clusterCount: 0,
      ownerEmail: email,
      createdAt: nowIso(),
      completedAt: null,
      verifiedAt: null,
    };
    await db.insert(audits).values(base);

    try {
      const job = await startEngineAudit(normalized, maxPages);
      await db
        .update(audits)
        .set({
          status: "running",
          engineJobId: job.id,
          progress: {
            phase: "rendering",
            pagesDone: 0,
            pagesTotal: maxPages,
            currentUrl: normalized,
          },
        })
        .where(eq(audits.id, auditId));
      return {
        auditId,
        projectId: project.id,
        status: "running",
        audit: toAuditSummary(
          {
            ...base,
            status: "running",
            engineJobId: job.id,
            progress: {
              phase: "rendering",
              pagesDone: 0,
              pagesTotal: maxPages,
              currentUrl: normalized,
            },
          },
          project.name,
        ),
        engineError: null,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "The engine could not start.";
      await db
        .update(audits)
        .set({ status: "failed", error: message })
        .where(eq(audits.id, auditId));
      return {
        auditId,
        projectId: project.id,
        status: "failed",
        audit: toAuditSummary(
          { ...base, status: "failed", error: message },
          project.name,
        ),
        engineError: message,
      };
    }
  },
});
