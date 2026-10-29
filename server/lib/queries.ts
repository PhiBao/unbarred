import { and, asc, desc, eq } from "drizzle-orm";

import { getDb } from "../db/index.js";
import {
  audits,
  clusters,
  evidence,
  fixes,
  issues,
  manualChecks,
  pages,
  projects,
} from "../db/schema.js";
import type {
  AuditSummary,
  ClusterView,
  FixView,
  IssueView,
  PageSummary,
} from "./schemas.js";

type AuditRow = typeof audits.$inferSelect;

export function toAuditSummary(
  audit: AuditRow,
  projectName: string,
): AuditSummary {
  const raw = audit.progress;
  return {
    id: audit.id,
    projectId: audit.projectId,
    projectName,
    url: audit.url,
    status: audit.status,
    progress:
      raw && typeof raw === "object"
        ? {
            phase: raw.phase ?? "",
            pagesDone: raw.pagesDone ?? 0,
            pagesTotal: raw.pagesTotal ?? 0,
            currentUrl: raw.currentUrl ?? "",
          }
        : null,
    error: audit.error ?? null,
    axeVersion: audit.axeVersion ?? null,
    pageCount: audit.pageCount,
    issueCount: audit.issueCount,
    verifiedCount: audit.verifiedCount,
    remainingCount: audit.remainingCount,
    newCount: audit.newCount,
    clusterCount: audit.clusterCount,
    createdAt: audit.createdAt,
    completedAt: audit.completedAt ?? null,
    verifiedAt: audit.verifiedAt ?? null,
  };
}

export async function loadAuditSummary(
  auditId: string,
  email: string,
): Promise<AuditSummary | null> {
  const db = getDb();
  const [row] = await db
    .select({ audit: audits, projectName: projects.name })
    .from(audits)
    .innerJoin(projects, eq(audits.projectId, projects.id))
    .where(and(eq(audits.id, auditId), eq(audits.ownerEmail, email)))
    .limit(1);
  return row ? toAuditSummary(row.audit, row.projectName) : null;
}

export async function loadAuditDetail(auditId: string, email: string) {
  const db = getDb();
  const [row] = await db
    .select({ audit: audits, projectName: projects.name })
    .from(audits)
    .innerJoin(projects, eq(audits.projectId, projects.id))
    .where(and(eq(audits.id, auditId), eq(audits.ownerEmail, email)))
    .limit(1);
  if (!row) return null;

  const [pageRows, clusterRows, checkRows, issueRows, evidenceRows] =
    await Promise.all([
      db
        .select()
        .from(pages)
        .where(eq(pages.auditId, auditId))
        .orderBy(asc(pages.position)),
      db
        .select()
        .from(clusters)
        .where(eq(clusters.auditId, auditId)),
      db
        .select()
        .from(manualChecks)
        .where(eq(manualChecks.auditId, auditId))
        .orderBy(asc(manualChecks.key)),
      db
        .select({ ruleId: issues.ruleId, status: issues.status })
        .from(issues)
        .where(eq(issues.auditId, auditId)),
      db
        .select()
        .from(evidence)
        .where(eq(evidence.auditId, auditId))
        .orderBy(desc(evidence.createdAt))
        .limit(80),
    ]);

  const statusByRule = new Map<string, { verified: number; total: number }>();
  for (const issue of issueRows) {
    const entry = statusByRule.get(issue.ruleId) ?? { verified: 0, total: 0 };
    entry.total += 1;
    if (issue.status === "verified") entry.verified += 1;
    statusByRule.set(issue.ruleId, entry);
  }

  const clusterViews: ClusterView[] = clusterRows
    .map((cluster) => {
      const stats = statusByRule.get(cluster.ruleId);
      return {
        id: cluster.id,
        ruleId: cluster.ruleId,
        title: cluster.title,
        description: cluster.description,
        impact: cluster.impact,
        count: cluster.count,
        verifiedCount: stats?.verified ?? 0,
        needsHuman: cluster.needsHuman,
        fixKind: cluster.fixKind ?? null,
        pageUrls: cluster.pageUrls ?? [],
      };
    })
    .sort((a, b) => b.count - a.count);

  const fixRows = await db
    .select({ status: fixes.status })
    .from(fixes)
    .where(eq(fixes.auditId, auditId));
  const counts = { approved: 0, draft: 0, rejected: 0 };
  for (const fix of fixRows) {
    if (fix.status === "approved") counts.approved += 1;
    else if (fix.status === "rejected") counts.rejected += 1;
    else if (fix.status === "draft") counts.draft += 1;
  }

  const pageViews: PageSummary[] = pageRows.map((page) => ({
    id: page.id,
    url: page.url,
    title: page.title,
    height: page.height,
    issueCount: page.issueCount,
    hasPatched: Boolean(page.patchedHtml),
    updatedAt: page.updatedAt,
  }));

  return {
    audit: toAuditSummary(row.audit, row.projectName),
    pages: pageViews,
    clusters: clusterViews,
    manualChecks: checkRows.map((check) => ({
      id: check.id,
      key: check.key,
      label: check.label,
      status: check.status,
      note: check.note,
      completedAt: check.completedAt ?? null,
    })),
    approvedCount: counts.approved,
    draftCount: counts.draft,
    rejectedCount: counts.rejected,
    evidence: evidenceRows.map((event) => ({
      id: event.id,
      type: event.type,
      summary: event.summary,
      actor: event.actor,
      createdAt: event.createdAt,
    })),
  };
}

function toFixView(fix: typeof fixes.$inferSelect | null): FixView | null {
  if (!fix) return null;
  return {
    id: fix.id,
    kind: fix.kind,
    selector: fix.selector,
    op: fix.op,
    name: fix.name,
    value: fix.value,
    decorative: fix.decorative,
    status: fix.status,
    note: fix.note,
    reason: fix.reason,
    approvedBy: fix.approvedBy ?? null,
    createdAt: fix.createdAt,
    approvedAt: fix.approvedAt ?? null,
    verifiedAt: fix.verifiedAt ?? null,
  };
}

export async function loadIssues(
  auditId: string,
  email: string,
  filters: { ruleId?: string; pageId?: string; status?: string } = {},
): Promise<IssueView[] | null> {
  const db = getDb();
  const summary = await loadAuditSummary(auditId, email);
  if (!summary) return null;

  const conditions = [eq(issues.auditId, auditId)];
  if (filters.ruleId) conditions.push(eq(issues.ruleId, filters.ruleId));
  if (filters.pageId) conditions.push(eq(issues.pageId, filters.pageId));
  if (filters.status) conditions.push(eq(issues.status, filters.status));

  const [issueRows, clusterRows] = await Promise.all([
    db
      .select({ issue: issues, fix: fixes })
      .from(issues)
      .leftJoin(fixes, eq(fixes.issueId, issues.id))
      .where(and(...conditions))
      .orderBy(asc(issues.position)),
    db.select().from(clusters).where(eq(clusters.auditId, auditId)),
  ]);

  const titleByRule = new Map(
    clusterRows.map((cluster) => [cluster.ruleId, cluster.title]),
  );

  return issueRows.map(({ issue, fix }) => ({
    id: issue.id,
    pageId: issue.pageId,
    pageUrl: issue.pageUrl,
    ruleId: issue.ruleId,
    impact: issue.impact,
    help: issue.help,
    description: issue.description,
    helpUrl: issue.helpUrl,
    tags: issue.tags ?? [],
    selector: issue.selector,
    snippet: issue.snippet,
    failureSummary: issue.failureSummary,
    rect: issue.rect ?? null,
    text: issue.text,
    tag: issue.tag,
    attrs: issue.attrs ?? {},
    proposal: issue.proposal ?? null,
    status: issue.status,
    origin: issue.origin,
    position: issue.position,
    clusterTitle: titleByRule.get(issue.ruleId) ?? issue.help,
    fix: toFixView(fix),
  }));
}
