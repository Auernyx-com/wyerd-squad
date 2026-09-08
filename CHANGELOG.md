# Changelog

## 2026-09-04 to 2026-09-08 — Independent Security & Correctness Audit

A multi-day, multi-round independent audit (fresh-agent cold reads, every finding
reproduced with a real jsdom-based probe against `tool/index.html`'s own source
before being called a bug, test coverage added alongside every fix) of the
client-side wizard, session vault, and feedback flow. 21 PRs (#1–#21), all
merged. No high/mid-tier bugs outstanding as of the last round.

**Security**
- #2 — unescaped HTML sinks allowed DOM XSS + full vault exfiltration:
  `fmt()` piped unsanitized AI-response markdown straight into `.innerHTML`
  with zero escaping, and the county field interpolated into a diff screen
  and a `value="..."` attribute unescaped. Any HTML in a backend response
  could execute in the same scope as the decrypted vault, defeating the
  "stays encrypted on your device" promise (critical)

**Wizard state machine**
- #3 — back navigation didn't respect `skip()` gating, leaving stale intake
  fields behind (medium)
- #7 — guided-mode intake had no way to express a business/contracting need
  (low)
- #8 — guided-mode intake reverted to the direct-mode question set on resume
  (high)
- #10 — the `isReturning` flag survived "Start over for a different
  situation" (medium)
- #12 — `advance()` saved the just-answered step instead of the next one
  (low)
- #13 — guided and direct mode collected materially different data (medium)
- #16 — guided-mode urgency stayed "tonight" after the crisis option was
  deselected (medium)
- #19 — single-select had no visual "already answered" state, and "none"
  wasn't treated as exclusive (low-medium)
- #21 — `restoreSession` crashed on an out-of-range saved `currentStep`
  (medium)

**Session vault / storage**
- #4 — unguarded `JSON.parse` on vault storage caused silent failures
  (low-medium)
- #15 — import validation missed empty arrays; the unlock error only ever
  named one possible cause (low)

**Diff / disclosure accuracy**
- #5 — a county substring collision falsely suppressed the coverage-gap
  disclosure (high)
- #9 — the diff screen misreported VA facility issues and used stale field
  labels (high+medium)
- #17 — county coverage matching didn't collapse internal whitespace
  (medium)

**Chat / feedback**
- #1 — added structured correction fields to the feedback form
- #6 — old chat history silently survived into fresh results; truncation was
  invisible to the user
- #11 — the detailed feedback modal's privacy disclosure omitted `need_area`
  (medium)
- #18 — `sendChat` left orphaned unanswered turns in `chatHistory` on
  failure (medium)
- #20 — feedback modal state leak, a hidden report link after a quick vote,
  a stale truncation flag, overflow, and an autofill risk, all in one pass
  (medium)

**Housekeeping**
- #14 — removed a dead `showResults` param and unreachable
  `buildIntakeSummary` fields (low)
