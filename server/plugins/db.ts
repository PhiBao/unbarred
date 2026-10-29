import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
    {
      version: 1,
      name: "unbarred-core",
      sql: `
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          owner_email TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS projects_owner_created_idx ON projects (owner_email, created_at);

        CREATE TABLE IF NOT EXISTS audits (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          url TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'queued',
          engine_job_id TEXT,
          rescan_job_id TEXT,
          progress JSONB NOT NULL DEFAULT '{}'::jsonb,
          error TEXT,
          axe_version TEXT,
          page_count INTEGER NOT NULL DEFAULT 0,
          issue_count INTEGER NOT NULL DEFAULT 0,
          verified_count INTEGER NOT NULL DEFAULT 0,
          remaining_count INTEGER NOT NULL DEFAULT 0,
          new_count INTEGER NOT NULL DEFAULT 0,
          cluster_count INTEGER NOT NULL DEFAULT 0,
          owner_email TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          completed_at TEXT,
          verified_at TEXT
        );
        CREATE INDEX IF NOT EXISTS audits_owner_created_idx ON audits (owner_email, created_at);
        CREATE INDEX IF NOT EXISTS audits_project_idx ON audits (project_id);

        CREATE TABLE IF NOT EXISTS pages (
          id TEXT PRIMARY KEY,
          audit_id TEXT NOT NULL,
          url TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          html TEXT NOT NULL DEFAULT '',
          patched_html TEXT,
          height INTEGER NOT NULL DEFAULT 900,
          issue_count INTEGER NOT NULL DEFAULT 0,
          position INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS pages_audit_idx ON pages (audit_id, position);

        CREATE TABLE IF NOT EXISTS clusters (
          id TEXT PRIMARY KEY,
          audit_id TEXT NOT NULL,
          rule_id TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          impact TEXT NOT NULL DEFAULT 'minor',
          count INTEGER NOT NULL DEFAULT 0,
          issue_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
          page_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
          fix_kind TEXT,
          needs_human BOOLEAN NOT NULL DEFAULT true
        );
        CREATE INDEX IF NOT EXISTS clusters_audit_idx ON clusters (audit_id);
        CREATE UNIQUE INDEX IF NOT EXISTS clusters_audit_rule_idx ON clusters (audit_id, rule_id);

        CREATE TABLE IF NOT EXISTS issues (
          id TEXT PRIMARY KEY,
          audit_id TEXT NOT NULL,
          page_id TEXT NOT NULL,
          page_url TEXT NOT NULL,
          engine_id TEXT NOT NULL,
          rule_id TEXT NOT NULL,
          impact TEXT NOT NULL DEFAULT 'minor',
          help TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          help_url TEXT NOT NULL DEFAULT '',
          tags JSONB NOT NULL DEFAULT '[]'::jsonb,
          selector TEXT NOT NULL,
          snippet TEXT NOT NULL DEFAULT '',
          failure_summary TEXT NOT NULL DEFAULT '',
          rect JSONB,
          text TEXT NOT NULL DEFAULT '',
          tag TEXT NOT NULL DEFAULT '',
          attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
          proposal JSONB,
          status TEXT NOT NULL DEFAULT 'open',
          origin TEXT NOT NULL DEFAULT 'audit',
          position INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS issues_audit_idx ON issues (audit_id, position);
        CREATE INDEX IF NOT EXISTS issues_page_idx ON issues (page_id);
        CREATE UNIQUE INDEX IF NOT EXISTS issues_audit_engine_idx ON issues (audit_id, page_id, engine_id);

        CREATE TABLE IF NOT EXISTS fixes (
          id TEXT PRIMARY KEY,
          audit_id TEXT NOT NULL,
          issue_id TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'custom',
          selector TEXT NOT NULL,
          op TEXT NOT NULL DEFAULT 'set-attr',
          name TEXT NOT NULL DEFAULT '',
          value TEXT NOT NULL DEFAULT '',
          decorative BOOLEAN NOT NULL DEFAULT false,
          status TEXT NOT NULL DEFAULT 'draft',
          note TEXT NOT NULL DEFAULT '',
          reason TEXT NOT NULL DEFAULT '',
          approved_by TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          approved_at TEXT,
          verified_at TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS fixes_issue_idx ON fixes (issue_id);
        CREATE INDEX IF NOT EXISTS fixes_audit_idx ON fixes (audit_id, status);

        CREATE TABLE IF NOT EXISTS evidence (
          id TEXT PRIMARY KEY,
          audit_id TEXT NOT NULL,
          type TEXT NOT NULL,
          summary TEXT NOT NULL,
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          actor TEXT NOT NULL DEFAULT 'system',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS evidence_audit_idx ON evidence (audit_id, created_at);

        CREATE TABLE IF NOT EXISTS manual_checks (
          id TEXT PRIMARY KEY,
          audit_id TEXT NOT NULL,
          key TEXT NOT NULL,
          label TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open',
          note TEXT NOT NULL DEFAULT '',
          completed_at TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS manual_checks_audit_key_idx ON manual_checks (audit_id, key);
      `,
    },
  ],
  { table: "unbarred_migrations" },
);
