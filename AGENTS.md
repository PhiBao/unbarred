# Unbarred — Agent Guide

Unbarred is an accessibility remediation workspace: audit a real page, cluster barriers into patterns, approve fixes with human judgment, re-scan independently, and export the evidence ledger. `/` redirects to shared sign-in, then `/home` (Inspections). Chat lives at `/chat`. Actions carry capabilities; screens exist only for durable workflows.

## Skills

Search with `rg --hidden --follow`; read the exact linked guide before deeper work. `.agents/skills/build-an-app/SKILL.md` — start here for vague requests to create a domain app. `.agents/skills/adding-a-feature/SKILL.md` — cross-area feature checklist. Data/integrations: `.agents/skills/actions/SKILL.md`, `.agents/skills/storing-data/SKILL.md`, `.agents/skills/security/SKILL.md`, `.agents/skills/secrets/SKILL.md`, `.agents/skills/sharing/SKILL.md`. UI: `.agents/skills/frontend-design/SKILL.md`, `.agents/skills/shadcn-ui/SKILL.md`, `.agents/skills/client-side-routing/SKILL.md`. Agent context/workflows: `.agents/skills/context-awareness/SKILL.md`, `.agents/skills/real-time-sync/SKILL.md`, `.agents/skills/reliable-mutations/SKILL.md`, `.agents/skills/performance/SKILL.md`, `.agents/skills/delegate-to-agent/SKILL.md`. Framework: `.agents/skills/agent-native-docs/SKILL.md`, `.agents/skills/agent-native-toolkit/SKILL.md`, `.agents/skills/customizing-agent-native/SKILL.md`.

Use local docs only (no web research): `pnpm action docs-search --query "<topic>"`, `pnpm action docs-search --slug "<slug>"`, `pnpm action docs-search --list`, `pnpm action source-search --query "<pattern>"`, `pnpm action source-search --path <path>`, or `pnpm action source-search --list`. For external-agent integrations, read `pnpm action docs-search --slug "external-agents"`.

## Core rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Normal app data must flow through actions. Keep actions deterministic and focused; use agent chat/AgentSidebar for AI work and follow-ups in the same thread. Keep structured state in SQL and large files in configured storage; persist references only.
- For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver. Never hardcode credentials, webhook URLs, or private/customer data.
- Never fabricate. Report failures and recover; verify writes by reading the row or screen. Navigation is in `<current-screen>`; use `view-screen` for fresh visible-record details.

For custom branding, keep `server/plugins/agent-native-email-branding.ts` aligned: `app.name` appears in transactional email and optional `app.logoUrl` must be an absolute HTTPS URL.

## Application state

- `navigation` describes the view and selected ids. Chat is `chat` at `/chat` and `/chat/<threadId>`; the Get started page is `home` at `/home`; `/` opens shared sign-in/signup.
- Use `navigate` when supported and `view-screen` for a fresh read of visible details; basic navigation is already in `<current-screen>`.

## Unbarred domain

- **Home / Inspections** — `app/routes/home.tsx` at `/home`: URL intake, recent audits, method.
- **Workbench** — `app/routes/workbench.$auditId.tsx` at `/workbench/:auditId`: three panes (pattern queue, pinned page preview, fix inspector), manual checks, evidence drawer. Selection lives in `?cluster=&issue=&page=` so the agent can read it via `view-screen`.
- **Evidence report** — `app/routes/report.$auditId.tsx` at `/report/:auditId`: printable client-facing record with JSON/CSV downloads.
- **Preview route** — `server/routes/api/snapshot/[pageId].get.ts`: inert stored snapshot, session + owner scoped, sandbox CSP, scripts stripped.
- **Engine** — `engine/` (Rust/Axum). Owns crawl, headless Chrome, pinned axe-core, clustering, DOM patching, and independent re-scan. Contract: `POST /v1/audits`, `GET /v1/audits/:id`, `POST /v1/rescans`, `GET /v1/rescans/:id`, bearer `ENGINE_SECRET`. The app persists every result; the engine is a cache and never the system of record.
- **Data** — `server/db/schema.ts`: `projects → audits → pages → issues → fixes`, plus `clusters`, `evidence`, `manual_checks`. Snapshots are capped text; scripts stripped at capture.
- **Invariants** — never claim compliance/certification; only a re-scan can mark a fix `verified`; a disappeared issue is `resolved`, not `verified`, unless it had an approved fix; approval actions stay `needsApproval`; every read is scoped by `ctx.userEmail` through the audit owner.
- **Primary actions** — `start-audit`, `sync-audit`, `get-audit`, `list-issues`, `save-fix`, `approve-fix`, `approve-cluster`, `start-rescan`, `sync-rescan`, `export-evidence`, `record manual checks` via `complete-manual-check`.
- **Demo fixture** — `public/fixture/` (fictional Marlow & Rye bakery) with deliberate barriers. Dev engine may set `ALLOW_PRIVATE_URLS=1`; production must not.
- **Framework patch** — `patches/@agent-native__core@0.222.1.patch` sets tool `strict: true` so OpenAI-compatible gateways stream tool arguments the AI SDK can assemble, and forwards the sign-up session cookie on serverless hosts. Keep `pnpm.patchedDependencies` intact.

## Building a domain app

Choose the primary workflow and route before editing. Add a domain route under `app/routes/` and set `app.homePath` in `server/plugins/agent-native-email-branding.ts` with `defineAppConfig`. The default Get started page lives at `/home`, and Chat stays at `/chat`; edit `app/routes/home.tsx` when replacing that page with a domain-specific home. Add a static link in `app/components/layout/Sidebar.tsx` before `ChatThreadsSection`; `Header.tsx` uses `APP_TITLE` elsewhere. Shared sidebar and AgentInspector remain.

Use `adding-a-feature` for functional parity and `frontend-design` for a user-facing screen. Keep feature guidance here; do not rewrite `README.md` or `DESIGN.md`. After all edits, run one typecheck, one doctor check, and one browser smoke of the primary workflow, including overlap rejection, cancellation freeing the slot, and authenticated landing. Skip production build and extra test suites.

Before building common workspace or agent UI, read `agent-native-toolkit`; for supported customization, read `customizing-agent-native`.

- Guarded verification: run `pnpm agent-native:doctor`; fix findings before done.
