# Submission checklist

Builder.io Agent-Native Hackathon — deadline **9 November 2026, 11:59 PM PT**.
Submit at <https://www.builder.io/hackathon/submit>.

## Live deployment

| Piece | URL |
| --- | --- |
| App | https://unbarred-black.vercel.app |
| Public demo recording | https://unbarred-demo.vercel.app |
| Slides | https://unbarred-slides.vercel.app/s/unbarred |
| Repository | https://github.com/PhiBao/unbarred |
| Audit engine | https://unbarred-engine.fly.dev (bearer-authenticated; not for public use) |
| Database | Neon project `rough-hall-24254953`, `aws-eu-west-2` (pooled connection) |

The app runs on Vercel Hobby with Neon Postgres (`aws-eu-west-2`). The engine
runs on a separate 1 GB Fly machine with Debian Chromium and the pinned
axe-core build. The app calls the engine’s public URL with a bearer secret; the
engine auto-stops when idle.

## What the judge should do

1. Open the app, create an account (email + password on the sign-in screen).
2. Click **Audit the demo bakery** on the landing page.
3. Wait ~10 seconds for the baseline: **37 barriers in 8 patterns**.
4. Approve **Low contrast text** in one click; open the judgment patterns and
   approve the alt text, language, link names, labels, and selects.
5. Press **Verify fixes**. The re-scan returns **36 verified · 2 remaining**
   and surfaces **1 new pattern**.
6. Open **Report** for the printable evidence pack, or **Evidence** for the
   hash-chained ledger and JSON/CSV downloads.
7. Open **Code** for the implementation pack: verified CSS/HTML changes with
   selectors, before/after values, and instructions.
8. Open **Chat** or **Ask agent** in the inspector and ask what is still open.

## What is real

- Headless Chrome crawling and axe-core 4.10.2 findings, with element selectors
  and bounding boxes.
- Computed contrast corrections and DOM patches.
- Independent re-scan verification per element.
- Evidence ledger, SHA-256 chain, JSON/CSV export, printable report.
- Implementation pack of verified CSS/HTML changes.
- Agent-Native actions shared across UI, agent, HTTP, MCP, CLI, and A2A.
- `needsApproval` gates on `approve-fix` and `approve-cluster`.

## What is deliberately limited

- Automated checks cover a subset of WCAG. The manual checklist stays in the
  evidence pack. The product never claims compliance or certification.
- Fixes are demonstrated on a stored snapshot and verified against the live URL.
  Repository PR creation is roadmap, not shipped.
- Authenticated pages, PDFs, canvas, and third-party widgets are out of scope.
- SSRF protection validates the top-level and post-navigation URLs; it does not
  intercept every subresource request.

## Demo recording

The 2:17 recording is at **https://unbarred-demo.vercel.app**. It is a public
page with the video, burned captions, a transcript, and links to the live app,
repo, and slides. It opens without a login.

The page is a public video page, not a Clips-app share link. If the form
requires a `clips.agent-native.com` URL specifically, sign in to Clips, upload
`unbarred-demo.mp4`, make the clip public, and replace the URL. The MP4 is at
`https://unbarred-demo.vercel.app/unbarred-demo.mp4`.

## Submission form fields

- **Project name:** Unbarred
- **Tagline:** Find it. Fix it. Prove it.
- **Track/category:** Grand Prize; Best Use of Agent-Native
- **Live app:** https://unbarred-black.vercel.app (create an account, then Audit the demo bakery)
- **Repository:** https://github.com/PhiBao/unbarred
- **Public Clips recording URL:** https://unbarred-demo.vercel.app
- **Slides URL:** https://unbarred-slides.vercel.app/s/unbarred
- **Built with:** Agent-Native, Rust (Axum/Tokio), Headless Chrome, axe-core,
  Neon Postgres, Vercel, Fly.io (audit engine)
- **Disclosures:** axe-core is pre-existing open source; the Chat starter is the
  Agent-Native template. The framework patch for `strict: true` is documented
  in the README. No mocked audit results are used in the demo.

## Project description (form field)

Unbarred is an accessibility remediation workspace for the part after the
scanner. It audits a real rendered page, groups the failures into patterns,
proposes fixes, keeps a person in the loop for judgment calls, then re-scans
independently to prove what actually changed.

A baseline audit of the demo bakery finds 37 barriers in 8 patterns across 3
pages. 21 low-contrast elements become one computed decision. 15 fixes — alt
text, page language, link and button names, labels, selects — are marked
`needsHuman`; Unbarred refuses to auto-verify them. After approval, a Rust/Axum
engine applies the DOM patches to a fresh render and runs an independent
axe-core 4.10.2 scan. The result is 36 verified, 2 still open, and 1 new pattern
that only appeared after the changes. The two remaining barriers stay red and
stay in the record. There are no compliance claims anywhere in the product. The
output is a reviewable fix queue, a CSS/HTML implementation pack, and a
hash-chained evidence record a client can keep.

Unbarred is built on Agent-Native. Every capability is a `defineAction` action
shared by the workbench UI, the agent chat, HTTP, MCP, the CLI, and A2A. The
agent uses `view-screen` to read the selected cluster and issue and `list-issues`
for the record; it can explain a failure and draft a fix, but `approve-fix` and
`approve-cluster` are approval-gated, so it cannot approve its own work. The chat
is the Agent-Native Chat starter, renamed and extended with a domain system
prompt and the Unbarred action registry. The workbench, report, sites portfolio,
evidence ledger, and implementation pack are new. A small framework patch sets
tool `strict: true` for OpenAI-compatible gateways and forwards the sign-up
session cookie on serverless hosts.

Pre-existing work: the Agent-Native Chat starter (scaffold, auth, chat shell,
action plumbing), axe-core 4.10.2, and the standard open-source stack (React
Router, Drizzle, Neon Postgres, Vercel, Fly.io, Axum/Tokio, headless Chrome). The
fictional Marlow & Rye bakery fixture is original and controlled so the demo is
reproducible.

During the event I built the Rust audit engine (crawl, CDP, axe, clustering,
contrast computation, DOM patching, independent re-scan); the SQL schema and 19
actions; the three-pane workbench with pattern queue, pinned preview, and fix
inspector; the human approval gate; the report, sites portfolio, before/after
compare slider, agent-in-context, manual checks, hash-chained evidence export,
and implementation pack. The app is deployed to Vercel + Neon, with the engine
on Fly.

Team: Kiter (solo build). Live: https://unbarred-black.vercel.app · Repo:
https://github.com/PhiBao/unbarred · Demo: https://unbarred-demo.vercel.app ·
Slides: https://unbarred-slides.vercel.app/s/unbarred

### Short version (if the form has a tight character limit)

Unbarred is an accessibility remediation workspace for the part after the
scanner. It audits a real rendered page, groups 37 barriers into 8 patterns, and
keeps a person in the loop for the 15 judgment fixes automation cannot make. A
Rust/Axum engine then applies the approved DOM patches to a fresh render and
runs an independent axe-core scan: 36 verified, 2 still open, 1 new pattern. The
output is a CSS/HTML implementation pack and a hash-chained evidence record —
not a compliance certificate. Every capability is a shared Agent-Native action:
the UI and agent use the same `list-issues` and `start-rescan`, while
`approve-fix` stays approval-gated. Built on the Agent-Native Chat starter; new
work is the Rust engine, schema, workbench, report, sites, evidence ledger, and
implementation pack. Team: Kiter (solo).

## User-only actions

- Eligibility (18+), tax and payment details.
- Submit the form under your identity before the deadline.
- If a Clips-branded URL is mandatory, sign in to Clips, upload the MP4, make
  the clip public, and replace the public video page URL.
- Keep the Fly engine available through judging; it sleeps when idle and wakes on
  the next audit. The Vercel app and Neon database are on free tiers.
- Neon’s free tier scales to zero and wakes on the next connection; no keepalive
  job is required.
- Rotate the SandBase key, the Neon/Vercel credentials, and the Fly secrets after
  judging if desired.
