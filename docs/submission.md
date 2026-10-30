# Submission checklist

Builder.io Agent-Native Hackathon — deadline **9 November 2026, 11:59 PM PT**.
Submit at <https://www.builder.io/hackathon/submit>.

## Live deployment

| Piece | URL |
| --- | --- |
| App | https://unbarred-black.vercel.app |
| Audit engine | https://unbarred-engine.fly.dev (bearer-authenticated; not for public use) |
| Database | Neon project `rough-hall-24254953`, `aws-eu-west-2` (pooled connection) |
| Repository | _add the public GitHub URL after pushing_ |
| Clips demo | _record and add the public Clips URL_ |

The app runs on Vercel Hobby with Neon Postgres (`aws-eu-west-2`). The engine
runs on a separate 1 GB Fly machine with Debian Chromium and the pinned
axe-core build.
The app reaches the engine over Fly's private network; the engine's public URL
rejects requests without the bearer secret.

## What the judge should do

1. Open the app, create an account (email + password on the sign-in screen).
2. Click **Audit the demo bakery** on the landing page.
3. Wait ~10 seconds for the baseline: **37 barriers in 9 patterns**.
4. Approve **Low contrast text** in one click; open the judgment patterns and
   approve the alt text, language, link names, labels, and buttons.
5. Press **Verify fixes**. The re-scan returns **36 verified · 2 remaining**.
6. Open **Report** for the printable evidence pack, or **Evidence** for the
   ledger and JSON/CSV downloads.
7. Open **Chat** and ask: “What is still open on this audit? Use the tools.”

## What is real

- Headless Chrome crawling and axe-core 4.10.2 findings, with element selectors
  and bounding boxes.
- Computed contrast corrections and DOM patches.
- Independent re-scan verification per element.
- Evidence ledger, JSON/CSV export, printable report.
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

## Clips demo

Follow `docs/demo-script.md`. Record at 1440×1000 in light mode. The public
Clips link must open without a login. Target 2:20–2:40.

## Submission form fields

- **Project name:** Unbarred
- **Tagline:** Find it. Fix it. Prove it.
- **Track/category:** Grand Prize; Best Use of Agent-Native
- **Live app:** https://unbarred-black.vercel.app (create an account, then Audit the demo bakery)
- **Repository:** _add public repo URL_
- **Demo video:** _add Clips URL_
- **Built with:** Agent-Native, Rust (Axum/Tokio), Headless Chrome, axe-core,
  Neon Postgres, Vercel, Fly.io (audit engine)
- **Disclosures:** axe-core is pre-existing open source; the Chat starter is the
  Agent-Native template. The framework patch for `strict: true` is documented
  in the README. No mocked audit results are used in the demo.

## User-only actions

- Eligibility (18+), tax and payment details.
- Push the repository publicly (if not already).
- Record and upload the Clips demo.
- Submit the form under your identity before the deadline.
- Keep the Fly apps running through judging; the app is set to stay warm.
- Neon's free tier scales to zero and wakes on the next connection; no keepalive
  job is required.
- Rotate the SandBase key, the Neon/Vercel credentials, and the Fly secrets after
  judging if desired.
