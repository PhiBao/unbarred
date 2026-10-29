import { z } from "zod";

export const zProgress = z
  .object({
    phase: z.string(),
    pagesDone: z.number(),
    pagesTotal: z.number(),
    currentUrl: z.string(),
  })
  .nullable();

export const zAuditSummary = z.object({
  id: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  url: z.string(),
  status: z.string(),
  progress: zProgress,
  error: z.string().nullable(),
  axeVersion: z.string().nullable(),
  pageCount: z.number(),
  issueCount: z.number(),
  verifiedCount: z.number(),
  remainingCount: z.number(),
  newCount: z.number(),
  clusterCount: z.number(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  verifiedAt: z.string().nullable(),
});

export type AuditSummary = z.infer<typeof zAuditSummary>;

export const zFix = z.object({
  id: z.string(),
  kind: z.string(),
  selector: z.string(),
  op: z.string(),
  name: z.string(),
  value: z.string(),
  decorative: z.boolean(),
  status: z.string(),
  note: z.string(),
  reason: z.string(),
  approvedBy: z.string().nullable(),
  createdAt: z.string(),
  approvedAt: z.string().nullable(),
  verifiedAt: z.string().nullable(),
});

export type FixView = z.infer<typeof zFix>;

export const zRect = z
  .object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
  .nullable();

export const zProposal = z
  .object({
    kind: z.string(),
    op: z.string(),
    name: z.string(),
    value: z.string(),
    needsHuman: z.boolean(),
    rationale: z.string(),
    before: z.string(),
    after: z.string(),
  })
  .nullable();

export const zIssue = z.object({
  id: z.string(),
  pageId: z.string(),
  pageUrl: z.string(),
  ruleId: z.string(),
  impact: z.string(),
  help: z.string(),
  description: z.string(),
  helpUrl: z.string(),
  tags: z.array(z.string()),
  selector: z.string(),
  snippet: z.string(),
  failureSummary: z.string(),
  rect: zRect,
  text: z.string(),
  tag: z.string(),
  attrs: z.record(z.string(), z.string()),
  proposal: zProposal,
  status: z.string(),
  origin: z.string(),
  position: z.number(),
  clusterTitle: z.string(),
  fix: zFix.nullable(),
});

export type IssueView = z.infer<typeof zIssue>;

export const zCluster = z.object({
  id: z.string(),
  ruleId: z.string(),
  title: z.string(),
  description: z.string(),
  impact: z.string(),
  count: z.number(),
  verifiedCount: z.number(),
  needsHuman: z.boolean(),
  fixKind: z.string().nullable(),
  pageUrls: z.array(z.string()),
});

export type ClusterView = z.infer<typeof zCluster>;

export const zPageSummary = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  height: z.number(),
  issueCount: z.number(),
  hasPatched: z.boolean(),
  updatedAt: z.string(),
});

export type PageSummary = z.infer<typeof zPageSummary>;

export const zManualCheck = z.object({
  id: z.string(),
  key: z.string(),
  label: z.string(),
  status: z.string(),
  note: z.string(),
  completedAt: z.string().nullable(),
});

export const zEvidence = z.object({
  id: z.string(),
  type: z.string(),
  summary: z.string(),
  actor: z.string(),
  createdAt: z.string(),
});

export const zAuditDetail = z.object({
  audit: zAuditSummary,
  pages: z.array(zPageSummary),
  clusters: z.array(zCluster),
  manualChecks: z.array(zManualCheck),
  approvedCount: z.number(),
  draftCount: z.number(),
  rejectedCount: z.number(),
  evidence: z.array(zEvidence),
});
