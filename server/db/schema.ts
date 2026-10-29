import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export type ProposalJson = {
  kind: string;
  op: string;
  name: string;
  value: string;
  needsHuman: boolean;
  rationale: string;
  before: string;
  after: string;
};

export type RectJson = { x: number; y: number; w: number; h: number };

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    ownerEmail: text("owner_email").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index("projects_owner_created_idx").on(table.ownerEmail, table.createdAt)],
);

export const audits = pgTable(
  "audits",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    url: text("url").notNull(),
    status: text("status").notNull().default("queued"),
    engineJobId: text("engine_job_id"),
    rescanJobId: text("rescan_job_id"),
    progress: jsonb("progress")
      .$type<{
        phase?: string;
        pagesDone?: number;
        pagesTotal?: number;
        currentUrl?: string;
      }>()
      .notNull()
      .default({}),
    error: text("error"),
    axeVersion: text("axe_version"),
    pageCount: integer("page_count").notNull().default(0),
    issueCount: integer("issue_count").notNull().default(0),
    verifiedCount: integer("verified_count").notNull().default(0),
    remainingCount: integer("remaining_count").notNull().default(0),
    newCount: integer("new_count").notNull().default(0),
    clusterCount: integer("cluster_count").notNull().default(0),
    ownerEmail: text("owner_email").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`now()`),
    completedAt: text("completed_at"),
    verifiedAt: text("verified_at"),
  },
  (table) => [
    index("audits_owner_created_idx").on(table.ownerEmail, table.createdAt),
    index("audits_project_idx").on(table.projectId),
  ],
);

export const pages = pgTable(
  "pages",
  {
    id: text("id").primaryKey(),
    auditId: text("audit_id").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull().default(""),
    html: text("html").notNull().default(""),
    patchedHtml: text("patched_html"),
    height: integer("height").notNull().default(900),
    issueCount: integer("issue_count").notNull().default(0),
    position: integer("position").notNull().default(0),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index("pages_audit_idx").on(table.auditId, table.position)],
);

export const clusters = pgTable(
  "clusters",
  {
    id: text("id").primaryKey(),
    auditId: text("audit_id").notNull(),
    ruleId: text("rule_id").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    impact: text("impact").notNull().default("minor"),
    count: integer("count").notNull().default(0),
    issueIds: jsonb("issue_ids").$type<string[]>().notNull().default([]),
    pageUrls: jsonb("page_urls").$type<string[]>().notNull().default([]),
    fixKind: text("fix_kind"),
    needsHuman: boolean("needs_human").notNull().default(true),
  },
  (table) => [
    index("clusters_audit_idx").on(table.auditId),
    uniqueIndex("clusters_audit_rule_idx").on(table.auditId, table.ruleId),
  ],
);

export const issues = pgTable(
  "issues",
  {
    id: text("id").primaryKey(),
    auditId: text("audit_id").notNull(),
    pageId: text("page_id").notNull(),
    pageUrl: text("page_url").notNull(),
    engineId: text("engine_id").notNull(),
    ruleId: text("rule_id").notNull(),
    impact: text("impact").notNull().default("minor"),
    help: text("help").notNull().default(""),
    description: text("description").notNull().default(""),
    helpUrl: text("help_url").notNull().default(""),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    selector: text("selector").notNull(),
    snippet: text("snippet").notNull().default(""),
    failureSummary: text("failure_summary").notNull().default(""),
    rect: jsonb("rect").$type<RectJson | null>(),
    text: text("text").notNull().default(""),
    tag: text("tag").notNull().default(""),
    attrs: jsonb("attrs").$type<Record<string, string>>().notNull().default({}),
    proposal: jsonb("proposal").$type<ProposalJson | null>(),
    status: text("status").notNull().default("open"),
    origin: text("origin").notNull().default("audit"),
    position: integer("position").notNull().default(0),
    createdAt: text("created_at")
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("issues_audit_idx").on(table.auditId, table.position),
    index("issues_page_idx").on(table.pageId),
    uniqueIndex("issues_audit_engine_idx").on(table.auditId, table.pageId, table.engineId),
  ],
);

export const fixes = pgTable(
  "fixes",
  {
    id: text("id").primaryKey(),
    auditId: text("audit_id").notNull(),
    issueId: text("issue_id").notNull(),
    kind: text("kind").notNull().default("custom"),
    selector: text("selector").notNull(),
    op: text("op").notNull().default("set-attr"),
    name: text("name").notNull().default(""),
    value: text("value").notNull().default(""),
    decorative: boolean("decorative").notNull().default(false),
    status: text("status").notNull().default("draft"),
    note: text("note").notNull().default(""),
    reason: text("reason").notNull().default(""),
    approvedBy: text("approved_by"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`now()`),
    approvedAt: text("approved_at"),
    verifiedAt: text("verified_at"),
  },
  (table) => [
    uniqueIndex("fixes_issue_idx").on(table.issueId),
    index("fixes_audit_idx").on(table.auditId, table.status),
  ],
);

export const evidence = pgTable(
  "evidence",
  {
    id: text("id").primaryKey(),
    auditId: text("audit_id").notNull(),
    type: text("type").notNull(),
    summary: text("summary").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    actor: text("actor").notNull().default("system"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index("evidence_audit_idx").on(table.auditId, table.createdAt)],
);

export const manualChecks = pgTable(
  "manual_checks",
  {
    id: text("id").primaryKey(),
    auditId: text("audit_id").notNull(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    status: text("status").notNull().default("open"),
    note: text("note").notNull().default(""),
    completedAt: text("completed_at"),
  },
  (table) => [uniqueIndex("manual_checks_audit_key_idx").on(table.auditId, table.key)],
);
