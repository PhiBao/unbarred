# Clips demo — 2:30

Record at 1440×1000, light mode, browser zoom 100%. Close other tabs. Use a
fresh audit so the counts are deterministic.

## Pre-flight (5 minutes before)

- [ ] Rust engine running on `:8787` with `ALLOW_PRIVATE_URLS=1` and the fixture server on `:8099`.
- [ ] App running on `:8081`; signed in; Chat has one clean thread.
- [ ] A fresh audit of `http://127.0.0.1:8099/` completed (37 barriers, 9 patterns).
- [ ] Browser devtools closed; notifications off; cursor visible.
- [ ] Run the whole flow once without recording. Then delete the test audit and repeat.

## Script

**0:00 — Hook.** Static frame of the workbench, 37 pins.
> "Your client just got an accessibility demand letter. A scanner says 37 barriers. Now what?"

**0:12 — The intake.** Cut to Inspections. Paste the bakery URL. Click **Run baseline audit**.
> "Unbarred renders the real page, not the source. It finds 37 barriers in 9 patterns across three pages."

**0:30 — The workbench.** Cut to the workbench. Click the **Low contrast text** pattern. Hover a pin.
> "Each pin is an element that actually failed. The inspector shows the failing values and a correction that mathematically passes."

**0:55 — Bulk approval.** Click **Approve all 21 computed fixes**. The header count becomes 21 approved.
> "Deterministic fixes can be approved as a pattern. The person still decides."

**1:10 — Judgment.** Click **Images without text alternatives**. Select the loaf image. Type an alt text, or use the agent's draft.
> "Automation cannot know what an image means. Unbarred refuses to auto-verify this. It asks."

**1:30 — The proof.** Click **Verify fixes (36)**. Show the re-scan sweep. Cut to the result: **36 verified · 2 remaining · 1 new**.
> "An independent re-scan applies every approved change to a fresh render and reports what survived. Thirty-six verified. Two still open. One new pattern that only appeared after the changes."

**1:50 — Honesty.** Click the **Links indistinguishable without color** pattern.
> "This one needs a source change. It stays red, and it stays in the record. No compliance claims."

**2:05 — Agent-Native.** Cut to Chat. Ask: "What is still open on this audit? Use the tools." Show the tool calls and the answer.
> "The agent reads the same actions the UI uses. It can explain the record, but it cannot approve a fix without the human gate."

**2:18 — The artifact.** Open the evidence ledger, download JSON, flash the printable report.
> "Every fix has an approval, a diff, and a re-scan result. That is what you send the client."

**2:28 — Close.** Wordmark on paper.
> "Unbarred. Find it. Fix it. Prove it."

## Reliability notes

- Primary demo is the controlled fixture. Any-URL audit is the interactive path for a judge, not the recording.
- If the engine is slow, the workbench shows the scan sweep and polls. Do not cut away.
- If a judgment fix fails to verify, that is a **feature** of the demo: show the red state and the reason. Never narrate a failed fix as verified.
- Have a second browser profile with a completed audit as fallback.
