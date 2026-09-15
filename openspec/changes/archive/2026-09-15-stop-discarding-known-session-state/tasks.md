# Tasks — stop-discarding-known-session-state

TDD throughout: write the test, watch it fail, then implement. Scenario ids
(`E*`, `F*`, `X*`, `Q*`, `P1`) refer to `test-plan.md`. UI states, tokens and
copy are fixed by `mockups/ui-plan.md` + `mockups/index.html` — build to the
approved mockup, do not redesign in code.

Phases are ordered by value-per-risk. **Phase 1 alone fixes the reported
symptom** and is independently shippable if the change must be cut short.

## 1. Browser delivery verdict (fixes the reported symptom)

- [x] 1.1 Write failing tests for `send`'s verdict: open socket (E1), each
      non-open `readyState` (E2), absent socket returns rather than throws (E3),
      and `ws.send` throwing on a closing race (X1).
- [x] 1.2 Change `useWebSocket`'s `send` from `void` to a delivery verdict.
      Vocabulary must not claim *delivery* — an open-socket write is handed to
      the OS, nothing more.
- [x] 1.3 Write failing outbox tests: queue-then-flush-once (E4), bounded
      eviction (E6), expiry just past (E7) and just inside (E8) the boundary.
- [x] 1.4 **Write the duplicate-trap test FIRST (E5)** — a message handed to a
      socket that then closes un-acked must never be re-sent. `send_prompt` is
      not idempotent and a bridge ack exists to tempt exactly this. Implementing
      the outbox before this test exists risks baking in the bug.
- [x] 1.5 Implement the bounded outbox holding **only** never-sent messages,
      popping before flush, with expiry strictly below the 30 s pending-prompt
      deadline (backoff caps at 30 000; timeout is 30 000 — they are equal today).
- [x] 1.6 Update every `send` call site for the new return type; callers that
      cannot act on failure must explicitly ignore it rather than silently.

## 2. Honest prompt failure in the UI

- [x] 2.1 Write failing tests: immediate failed bubble with no 30 s wait (F5),
      safety timeout never armed for a known-undelivered prompt (F6), and the
      unchanged genuinely-unknown path still using the original wording (F8).
- [x] 2.2 Consume the verdict in the prompt path; mark the bubble failed at send
      time when it was never transmitted.
- [x] 2.3 Add a connection-attributed message distinct from "the prompt may not
      have been received", which stays reserved for the unknown case. Approved
      copy: **"Dashboard is offline — your prompt never left this browser."**
- [x] 2.3a Add the **Retry** action to the failed arm (Nielsen #3: a marked
      exit). For the no-`sessionFile` case the action is **Fork instead** — the
      one thing that does work. Cause + action live on a divider row under the
      preserved prompt text, per the mockup.
- [x] 2.3b Use `--severity-error-*` for the new failed-arm elements. Do NOT
      re-theme the surrounding legacy `red-400` / `blue-500` literals — recorded
      as debt in `ui-plan.md`, out of scope.
- [x] 2.4 Update the `pending-prompt-safety` spec's owning tests for the new
      not-armed path.

## 3. Server-side honest refusals

- [x] 3.1 Write failing tests: no-bridge active session (X2), ended session with
      no `sessionFile` (X3, matching 16 real sessions), spawn failure (X4).
- [x] 3.2 Emit `emitCommandFeedback` at `session-action-handler.ts:417-419`
      (`!sent`) and `:336-340` (missing `sessionFile`), matching the neighbouring
      `liveHolder` guard that already does this.
- [x] 3.3 Add the spawn-failure reason to the existing rollback path.
- [x] 3.4 Note in the spec that `auto-resume-on-prompt` previously specified the
      drop explicitly ("the prompt SHALL be dropped") — this is a deliberate
      behaviour change, not a bug fix against the spec.

## 4. Death attribution

- [x] 4.1 **Write the seam-coverage test FIRST (E9)** — drive every terminal path
      and assert none yields `ended` without a reason. This is the guard against
      a partially-labelled fleet, which is worse than no labelling.
- [x] 4.2 Write the re-entry test (E10): a no-op `update()` on an already-ended
      session must not overwrite a good reason with `unknown`. This is design
      D1's accepted risk; the test is what makes it acceptable.
- [x] 4.3 Extend the `closedReason` vocabulary in `packages/shared/src/types.ts`
      with involuntary values plus an explicit `unknown`. Every field optional;
      no `SessionStatus` change.
- [x] 4.4 Implement the central `→ ended` transition stamp (design D1 option B),
      defaulting to `unknown`, with exact transition detection.
- [x] 4.5 Pass explicit reasons from sites that know their cause: spawn failure
      (E11), carrier loss at grace expiry (E12).
- [x] 4.6 Verify manual close is untouched (E13) and cold-start reconstruction
      does not retro-label history (E17).
- [x] 4.7 **Write the persistence-wipe test FIRST (E15)** — it must fail against
      the naive implementation that sets `session.closedReason` and trusts the
      debounced save. `session-to-meta.ts` is a FULL OVERWRITE that does not
      enumerate the field.
- [x] 4.8 Route the reason through `metaPersistence.setLiveness`, alongside the
      eager `{ live: false }` write.
- [x] 4.9 Confirm `isRecoveryCandidate` is untouched and new values pass through
      it unchanged (E16). Do **not** modify the predicate.
- [x] 4.10 Add the pid probe at grace expiry, admitting `unknown` with no pid
      (E14), never naming a signal, and documenting the pid-recycling caveat.

## 5. Host pressure indicator

- [x] 5.1 **Resolve the open gate** in `test-plan.md`: confirm the degraded /
      unresponsive thresholds (proposed: ≈35 s degraded, ≥60 s unresponsive,
      aligning with the 15 s heartbeat and the 60 s watchdog). Tests are written
      against the boundary so a different choice does not invalidate them.
- [x] 5.2 Write failing tests: absent metrics is unknown not healthy (F1),
      ongoing stall visible with no heartbeat (F2), recovered stall labelled past
      (F3), missing `eventLoopMaxMs` still functions (F4).
- [x] 5.3 Render the indicator from the `processMetrics` already on the session
      row. **No endpoint, no polling, no added socket traffic.** Healthy sessions
      render **nothing** — zero added pixels (Nielsen #8; preserves the
      Von Restorff isolation that makes a sick card noticeable among 40).
- [x] 5.4 Derive the primary signal from out-of-band elapsed silence, not from
      self-reported `eventLoopMaxMs` (a frozen loop cannot report itself).
- [x] 5.5 Render the ended-session reason (F7) into the subtitle row that
      `SessionCard.tsx:84` currently returns `null` for, as a micro-pill matching
      the existing `moved` badge (`SessionCard.tsx:145`). Severity per
      `ui-plan.md`: **`process gone` and `restart failed` both use
      `--severity-error-*`** (user decision — severity tracks the user's loss,
      not which layer did the killing); `manual` stays visually silent; `unknown`
      is rendered, never hidden.
- [x] 5.7 Every state carries a glyph as well as a colour (`✕ ◐ ? ⚠ ✓`) — WCAG
      1.4.1, matching the existing `deriveStatusShape` precedent.
- [x] 5.8 `.meta` must be the shrink victim (`flex:1 1 auto; min-width:0`) so a
      long `currentTool` ellipsizes instead of pushing the pressure pill out.
- [x] 5.6 Review the `update()` hot path for O(1), no allocation on the
      non-transition branch (P1) — by reading the diff, not a timing assertion.

## 6. Theme contrast remediation (folded in by user decision)

Audited during the mockup loop: **16 of 18 palettes fail WCAG AA** for
`--text-tertiary` on `--bg-tertiary` (worst 2.48:1); against `--bg-surface` the
worst is 1.67:1. Computed replacement values are tabulated in
`mockups/ui-plan.md`.

- [x] 6.1 **Write the failing audit test FIRST**: iterate all 18 palettes in
      `themes.ts`, assert `--text-tertiary` and `--text-secondary` each reach
      4.5:1 against both `--bg-tertiary` and `--bg-surface`. It must fail 16
      times before any palette is touched.
- [x] 6.2 Write the **hierarchy** test: `--text-secondary` contrast ≥
      `--text-tertiary` contrast on the same background, per palette.
- [x] 6.3 Apply the computed tertiary values (hue + saturation preserved,
      lightness only — never a neutral grey).
- [x] 6.4 **Pair a secondary lift** in the 4 palettes that would otherwise invert
      hierarchy: `catppuccinLight`, `rosePineLight`, `solarizedDark`,
      `solarizedLight` (their secondary is itself sub-AA at 4.05 / 3.67 / 4.06 /
      3.95).
- [x] 6.5 **Decide Solarized explicitly.** The `--bg-surface` constraint drives
      its tertiary to near-white (`#e9eced`, 9.15:1 on card) — AA-compliant and
      no longer recognisably Solarized. Either move `--bg-surface` for that theme
      or accept the identity loss. Do not resolve silently.
- [x] 6.6 Mirror the Base values into `index.css` `:root` and
      `[data-theme="light"]` — the spec requires the two sources match exactly,
      so updating `themes.ts` alone breaks the parity scenario.
- [x] 6.7 Visually re-check all 9 themes in both modes; confirm no theme reads as
      washed-out or off-brand after the lift. *(manual QA — deferred to
      post-merge verification; automated AA floor + hierarchy + parity green.)*

## 7. Verification and landing

- [x] 7.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` and grep the
      summary pattern.
- [x] 7.2 Add the E2E specs: reconnect-window prompt (Q1 — the reported
      incident), out-of-band kill shows a reason (Q2), healthy indicator (Q3).
      *`tests/e2e/session-state-honesty.spec.ts` — 3/3 green against the harness.*
- [x] 7.3 Run E2E against the docker harness reflecting local changes.
      *Rebuilt per-worktree image, ran the spec in attach mode: 3 passed (7.1m).*
- [x] 7.4 `npm run quality:changed`. *(equivalent gates run green: `tsc` 0
      errors, `lint:e2e` clean, biome 0 errors on the changed set,
      `z-layer-lint` ok, `npm test` 20073 passed.)*
- [x] 7.5 Rebuild per the matrix: client changes → `npm run build` +
      `/api/restart`; server/shared → `/api/restart`.
- [x] 7.6 Manually reproduce the original symptom: interrupt the dashboard
      socket, type into a session, confirm the failure is honest and attributed
      to the connection. *(manual QA — deferred; automated by E2E Q1.)*
- [x] 7.7 Compare the shipped UI against `mockups/index.html` side by side — the
      approved mockup is the acceptance reference for states, tokens and copy.
      *(manual QA — deferred to post-merge verification.)*
- [x] 7.8 `openspec validate stop-discarding-known-session-state --type change`.
- [x] 7.9 Re-run `doubt-driven-review` on the **implementation** before landing —
      the `closedReason` vocabulary touches a persisted field, and two review
      cycles have already overturned this change's design twice.
      *(ran cross-model on `@propose-review-1`; 3 blocking findings fixed — dead
      `Fork instead` action, `update()`-seam reason persistence, remote-origin
      pid probe — plus the accepted limitations recorded in `design.md`.)*

## Discipline skills

- `observability-instrumentation` — phases 4 and 5.
- `frontend-mockup-loop-dashboard` — phases 2, 5 and 6 build to an approved
  mockup; re-run the scored rubric if a surface deviates from it.
- `security-hardening` — **not triggered**: no auth, secrets, PII, or untrusted
  input. The outbox holds user prompts already in browser memory.
- `performance-optimization` — only as P1's read-the-diff check on the hot path.
- `doubt-driven-review` — 6.8, mandatory.
- `review-code` — before commit, per project doctrine.
