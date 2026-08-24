---
session: 019f144e
week: 2026/W27
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (7 user prompts); large facts sheet (~13709 tok)"
upgrade_status: pending
openspec_changes: [unify-error-retry-lifecycle]
proposal_excerpt: "Today the dashboard treats provider-retry (🟡) and settled-error (🔴) as mutually exclusive replacements: retryState wins over lastError, and agent_start clears lastError the instant a retry begins."
---

# How we did it: Unify the error / retry lifecycle — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with `check the proposal is valid. Is there anything to clarify?`
— an OpenSpec change (`unify-error-retry-lifecycle`) was already drafted and they
wanted a critical read before building. The *real* objective, which unfolded across
the steering turns, was the full arc: **validate the proposal → resolve its open
questions → implement the change end-to-end (TDD) → add browser QA → open a PR and
get CI + CodeRabbit green → merge and clean up the worktree.**

The change itself reframes the dashboard's error UI: instead of provider-retry (🟡)
and settled-error (🔴) being mutually-exclusive states where `agent_start` optimistically
clears `lastError`, the two become **one composed error-lifecycle surface** — a
persistent red error anchor plus a live amber retry sub-status, cleared only on a
*confirmed-good* response.

## 2. TL;DR playbook

1. **Ask for a validation read first, not an implementation.** `check the proposal is
   valid. Is there anything to clarify?` → the AI runs `openspec validate --strict` and
   surfaces contradictions between `design.md` open questions and the spec deltas.
2. **Say `yes` to let it reconcile the specs** — it closes the open questions by editing
   `design.md` + the affected spec deltas, then re-validates.
3. **Hand off to the apply skill:** `/skill:openspec-apply-change unify-error-retry-lifecycle`.
   The AI reads all collaborators in parallel, then implements phase-by-phase with TDD
   (reducer → banner → inline-card suppression → bridge abort-latch → integration test).
4. **Extract pure logic into testable classes** (`AbortLatch`, mirroring the existing
   `RetryTracker`) so bridge behaviour is unit-testable without a live provider.
5. **Ask for a real browser test:** `can you do playwright test for qa test`. The AI
   drives the faux-model harness (`[[faux:...]]` sentinels) in `tests/e2e/` — and the
   E2E catches **two real correctness bugs** the unit tests missed.
6. **Open the PR against `develop` and watch CI:** `There is one ci test. Create PR and
   check with CI`. Verify Biome is warn-only before pushing.
7. **Triage every CodeRabbit finding** — say `yes` to apply the fixes; here 4 Majors
   were genuine gaps in the fresh implementation.
8. **Merge + clean up:** `merge pr, delete branch, delete worktree` → squash-merge,
   delete remote branch, `git worktree remove`, prune stale refs.

## 3. How the collaboration unfolded

**Phase 1 — Validate & reconcile (prompts 1–2).** The AI ran
`openspec validate unify-error-retry-lifecycle --strict` (valid), then read all three
spec deltas and `design.md` and found the specs were *ahead of* the design: the design
still listed "Open Questions" (confirmed-good trigger, auto-retry promotion, brand-new
prompt) that the spec deltas had already frozen. On `yes`, it promoted the open questions
to **Resolved Decisions**, tightened the clear-trigger from `stopReason !== "error"` to
`stopReason === "end_turn"` (killing a `tool_use`-mid-turn flicker), added flicker-guard
scenarios, updated `tasks.md`, and re-validated. *Why it worked:* the validation pass
turned a fuzzy spec into a set of firm, testable contracts **before** any code was written.

**Phase 2 — Implement TDD, phase by phase (prompt 3).** Via `openspec-apply-change`, the
AI read the reducer, `App.tsx`, `ChatView`, `command-handler`, `bridge`, and the existing
tests **in parallel**, then found the cleanest testable seam by mirroring the existing
`RetryTracker` pattern. It implemented in ordered phases, each red-test-first:
reducer deferred-clear + composed `deriveBannerState` → `SessionBanner` composed surface →
inline duplicate-error suppression in `collapse-retried-errors.ts` → a new pure
`AbortLatch` class wired into `bridge.ts` → a full-lifecycle integration test. It used the
project's ephemeral-HOME vitest runner convention to avoid localStorage collisions.

**Phase 3 — Browser QA finds real bugs (prompt 4).** `can you do playwright test for qa
test` → the AI wrote `tests/e2e/error-lifecycle.spec.ts` driving the faux model
(`[[faux:model-error]]`, `[[faux:ask-select]]`, `[[faux:plain-text]]`) against the Docker
all-in-one harness. Two bugs surfaced that unit tests couldn't: (a) `isCleanAgentEnd` was
too loose — pi fires an `agent_end` with a `toolUse` last message when a turn *pauses* at
`ask_user`, which was wrongly treated as confirmed-good and cleared the error; (b) the
positive clear check `=== "end_turn"` **never matched the real wire value** — pi-ai emits
`"stop"`, not `"end_turn"` (that was a fiction in the test fixtures). Fixed with a success
allowlist `{"stop","end_turn"}`. *Why it worked:* the faux harness gives deterministic,
credential-free lifecycle control, and a real browser exercised the true stop-reason casing.

**Phase 4 — PR, CI, CodeRabbit (prompts 5–6).** `Create PR and check with CI`. A branch
divergence appeared (a colleague owned the remote `os/unify-error-retry-lifecycle` branch
with 4 unmerged, partly-unrelated commits, 67 develop-commits stale). The AI **stopped and
asked** rather than force-push; when the literal rebase-onto-his-tip proved non-viable
(stale + broken base), it pushed to a **new** branch (`-impl`), leaving the colleague's
work intact, and opened PR #199. CI passed; CodeRabbit posted 7 advisory findings —
4 Majors were genuine implementation gaps (see §5) — all fixed and re-pushed to green.

**Phase 5 — Merge & clean up (prompt 7).** `merge pr, delete branch, delete worktree` →
squash-merge `b89bcffe`, remote branch deleted, worktree removed, stale refs pruned.

## 4. Prompts that worked

- **Goal prompt** — `check the proposal is valid. Is there anything to clarify?` A strong
  kickoff: it asks for a *critical review*, not implementation, so the AI surfaces
  contradictions while course-correction is cheap. Reuse verbatim before building any
  drafted OpenSpec change.
- **`yes`** (×3) — high-leverage unlocks after the AI laid out a concrete plan. Cheap to
  type because the preceding turn had already enumerated exactly what "yes" would do.
- **`/skill:openspec-apply-change <change>`** — routes straight into the disciplined,
  TDD, phase-by-phase implementation loop instead of ad-hoc coding.
- **`can you do playwright test for qa test`** — a small prompt that triggered the
  highest-value work in the session (the E2E caught two real bugs). Stronger version:
  *"add a Playwright E2E in tests/e2e using the faux-model harness that proves the error
  banner persists across a new turn's agent_start and clears only on confirmed-good."*
- **`There is one ci test. Create PR and check with CI`** — pins the exact gate to satisfy.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Trust a design's "Open Questions" as still-open when specs had frozen them | asking "is there anything to clarify?" up front | always `openspec validate --strict` + cross-read design vs deltas before coding |
| Assume the success stop-reason was `"end_turn"` (a test-fixture fiction) | requiring a real browser E2E that exposed pi-ai's real `"stop"` value | assert against the true wire value; treat fixtures as suspect |
| Treat *any* non-error `agent_end` as confirmed-good | the `ask_user` pause E2E failing | require an explicit success allowlist (`{"stop","end_turn"}`), exclude `toolUse`/`aborted` |
| Clear the abort-latch on *every* `send_prompt` (incl. `!bash`/`/compact`/slash) | CodeRabbit Major #7 | only clear the latch on the branch that actually dispatches a turn |
| Never clear the latch on `new`/`fork`/`resume` transitions | CodeRabbit Major #6 (own spec required it) | wire latch-clear into every session-transition path |
| Leave the manual Retry button clickable mid-stream (duplicate send) | CodeRabbit Major | gate `onRetry` on `!isStreaming` |
| Request the latch *after* `cachedCtx.abort()` (leaks onto a later turn) | CodeRabbit finding | request the latch **before** abort |
| Consider force-pushing over a colleague's diverged branch | operator confirmation on a deletion-risk divergence | **stop and ask** before any destructive git op; prefer a new `-impl` branch |
| Add a stray `newText2`/extra field to edits repeatedly | retrying the edit clean | keep multi-edit payloads minimal; re-read before re-editing |

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were persisted this session. The reusable *assets* produced are
in-tree code patterns worth repeating:

- **`AbortLatch` pure class** (`packages/extension/src/abort-latch.ts`) — mirrors the
  existing `RetryTracker`. Extracting bridge logic into a pure, dependency-free class makes
  latch behaviour unit-testable via a `BridgeSim` without a live provider. Reach for this
  seam whenever bridge lifecycle logic needs coverage.
- **Faux-model E2E pattern** (`tests/e2e/error-lifecycle.spec.ts`) — `[[faux:...]]`
  sentinels drive deterministic lifecycle states (error, `ask_user` pause, success) against
  the Docker harness with no LLM credential. This is the go-to for QA-ing UI that reacts to
  agent lifecycle events. It caught two bugs unit tests structurally could not.
- **System-Chrome fallback for Playwright** — when the sandbox couldn't reach
  `cdn.playwright.dev`, the AI used `channel: "chrome"` + a symlink to satisfy the
  preflight `existsSync`. Recommended skill to create: *"run dashboard E2E with system
  Chrome when Playwright's Chromium download is blocked."*

## 7. Pitfalls & dead ends

- **`npx vitest` resolves the wrong install** in a worktree → use the project's runner
  with an ephemeral `HOME=$(mktemp -d)` + `--localstorage-file` to avoid collisions.
- **`slow-stream` isn't actually slow** at the harness default `FAUX_TPS=50` — a
  mid-stream assertion races a stream that completes near-instantly. Use a *paused*
  discriminator (`ask-select` → `tool_use` stop) instead of a timing-based one.
- **`FAUX_TPS` doesn't propagate** into the container (`compose.test.yml` env allowlist) —
  don't rely on tuning stream speed; use a genuinely paused turn.
- **Stale Docker image serves old client** — after a reducer change, the E2E ran the
  cached bundle. Rebuild `pi-dashboard:local` (only post-`COPY packages` layers rebuild)
  before trusting an E2E result.
- **Pre-existing failures are noise** — 17 suite failures were `pi-image-fit` (Jimp dep)
  + timing-sensitive server flakes, none in touched files; confirmed clean under CI's fresh
  `npm ci`. Isolate suspected flakes by running them alone before blaming your change.
- **Diverged colleague branch** — a normal push was rejected; force-push would orphan 4
  unmerged commits. Don't rebase onto a 67-commit-stale tip (Frankenstein/broken base);
  push a new `-impl` branch and leave the colleague's branch untouched.
- **`docs/` edits must be delegated** to a subagent in caveman style (file-index rows);
  `openspec/` edits are edited directly. Don't hand-edit `docs/` file-index tables.

## 8. Reproduce it faster — checklist

- [ ] `openspec validate <change> --strict`; cross-read `design.md` open questions vs the
      spec deltas and reconcile before coding.
- [ ] `/skill:openspec-apply-change <change>`; read all collaborators in parallel first.
- [ ] Implement phase-by-phase, red-test-first; extract bridge logic into a pure class
      (mirror `RetryTracker`).
- [ ] Run vitest with ephemeral `HOME`/localstorage via the project runner.
- [ ] Add a faux-model Playwright spec in `tests/e2e/`; use a *paused* discriminator, not a
      timing race; **rebuild the Docker image** so it serves your client.
- [ ] Verify Biome is warn-only, then open the PR against `develop`; watch CI to green.
- [ ] Triage **every** CodeRabbit finding against the code; fix Majors, re-push, re-check.
- [ ] On any git divergence with deletion risk, **stop and ask**; prefer a new `-impl`
      branch over force-push.
- [ ] Squash-merge, delete the remote branch, `git worktree remove`, prune stale refs.

**Key inputs:** the drafted OpenSpec change dir, a working Docker harness (or system Chrome
+ `channel:"chrome"` fallback), `gh` auth for PR/CI, CodeRabbit access.
**Final artifacts:** 5 source files + tests (`event-reducer.ts`, `SessionBanner.tsx`,
`collapse-retried-errors.ts`, `bridge.ts`, `command-handler.ts` + new `abort-latch.ts`,
`error-lifecycle.spec.ts`); PR #199 (squash `b89bcffe`) merged to `develop`.

---

_Generated from session `019f144e-612e-763b-9f8a-129b7fc411e3` · `pi-agent-dashboard/.worktrees/os-unify-error-retry-lifecycle` · 2026-06-29. Source extract: `/tmp/facts_unify_97981.md`._
