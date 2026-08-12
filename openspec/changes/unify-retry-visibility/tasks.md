# Tasks — unify retry visibility

Defects 1–3 already exist as uncommitted edits in the main checkout, written by
session `019fd19c` and preserved through the 2026-08-11 stash/pop. Those tasks
are **verify-and-adopt**, not write-from-scratch. Defect 4 is new work.

## 1. Rescue the existing work

- [ ] 1.1 Create a worktree + branch for this change; do NOT continue on `develop`.
      All three prior sessions worked directly in the main checkout, which is why
      nothing ever shipped.
- [ ] 1.2 Move the defect 1–3 edits onto the branch:
      `packages/extension/src/retry-tracker.ts` (+ its test),
      `packages/client/src/lib/chat/event-reducer.ts` (+ its test),
      `packages/client/src/components/session/SessionBanner.tsx` (+ its test).
      Leave the `folder-filter-respects-collapse` and
      `reload-models-on-selector-open` edits behind — they belong to their own changes.
- [ ] 1.3 Reconcile with the overlapping uncommitted edit to `event-reducer.ts` in
      worktree `os/fix-error-anchor-backoff-persistence` (different base,
      2186 vs 2390 lines). Decide one lineage; record which in design.md.
- [ ] 1.4 Replace the three dangling `See change:` slugs
      (`fix-retry-tracker-last-assistant`, `fix-agent-end-last-assistant`,
      `restore-error-banner-dismiss`) with `See change: unify-retry-visibility`.

## 2. Tracker — last assistant message (defect 1)

- [ ] 2.1 Red: test that an `agent_end` whose `messages` end with a `toolResult`
      after an errored assistant message arms the retry chain. Confirm it fails
      against the pre-fix implementation.
- [ ] 2.2 Red: test that three such turns emit attempt `2` then `3`.
- [ ] 2.3 Red: test that a clean turn with a trailing `toolResult` closes the chain.
- [ ] 2.4 Red: test that a `messages` array with no assistant entry arms nothing.
- [ ] 2.5 Green: backward scan for `role === "assistant"` in `retry-tracker.ts`.
- [ ] 2.6 Confirm no text matching was introduced — assert only on `role` and `stopReason`.

## 3. Reducer — shared disposition helper (defect 2)

- [ ] 3.1 Red: test that a successful turn ending with a trailing `toolResult`
      clears `lastError` and hides the error surface.
- [ ] 3.2 Red: test that a failed turn ending with a trailing `toolResult` still
      extracts the error.
- [ ] 3.3 Red: test the agreement property between `isCleanAgentEnd` and
      `extractAgentEndError`.
- [ ] 3.4 Green: extract one `lastAssistantMessage()` helper and apply it to both.

## 4. Banner — restore the dismiss control (defect 3)

- [ ] 4.1 Red: test that ✕ renders while `waiting: false`.
- [ ] 4.2 Red: test that ✕ renders while `waiting: true`, alongside the countdown.
- [ ] 4.3 Red: test that activating ✕ dispatches no abort/cancel/stop command.
- [ ] 4.4 Red: test that a subsequent attempt re-opens a dismissed banner with the new number.
- [ ] 4.5 Red: assert no "stop retrying" control exists in any state.
- [ ] 4.6 Green: remove the stale `retrying ? undefined : onDismiss` gate.

## 5. Card — retry branch in ActivityIndicator (defect 4)

- [ ] 5.1 Red: test that a session with both `retryState` and `lastError` is a
      member of the retry set. Confirm it fails against the current
      `!state.lastError` gate.
- [ ] 5.2 Red: test the four `retryState × lastError` cells render the retry label
      or not as specified.
- [ ] 5.3 Red: test the `ActivityIndicator` precedence — retry beats `currentTool`
      and `streaming`; `ask_user` beats retry; `ended` still renders nothing.
- [ ] 5.4 Red: regression-guard the additive claim — with both flags set, assert the
      dot color, status shape, rail tint and folder-capsule bucket are all still
      the error variants.
- [ ] 5.5 Green: drop the `!state.lastError` clause in `App.tsx:1364` and publish
      `retryAttemptMap: Map<string, number>`.
- [ ] 5.6 Green: thread `retryAttempt?: number` through `SessionList` → `SessionCard`
      → `ActivityIndicator`, and add the retry branch after the `ask_user` branch
      in `SessionCard.tsx:61`. Reuse the `currentTool` branch's wrapper classes and
      `size={0.5}` icon; swap `mdiFlash` for `mdiRefresh`.
- [ ] 5.7 Green: colour the label `text-[var(--severity-warning-fg)]`. Do NOT use
      raw `--status-working` — it measures 1.68:1 on the light card surface.
- [ ] 5.8 Extend `tests/e2e/severity-contrast.spec.ts` to probe the retry label, so
      it is covered by the existing 9-theme × 2-mode gate.

## 6. Verify

- [ ] 6.1 `npm test` green; report the red list before touching source if any.
- [ ] 6.2 Biome + `tsc --noEmit` clean (`npm run quality:changed`).
- [ ] 6.3 `review-code` pass on the full diff — four surfaces, extension + client.
- [ ] 6.4 Deploy per the rebuild matrix: extension → `npm run reload`;
      client → `npm run build` + `POST /api/restart`.

## 7. Manual QA (needs a provider that actually fails)

The docker harness runs `faux/faux-1`, which cannot 503 on demand — the reason
this shipped broken the first time. These require a real rate-limited provider.

- [ ] 7.1 Trigger a real provider retry. Confirm the card's activity slot reads
      `Retry 2`, then `Retry 3`, while the dot stays error-red.
- [ ] 7.1b Confirm the card no longer reads “Thinking…” while pi sits in a backoff.
- [ ] 7.2 Confirm the banner shows `attempt N` and a live countdown.
- [ ] 7.3 Press ✕ mid-retry. Confirm the banner clears, the card's retry label
      persists, and the banner re-opens on the next attempt with the incremented
      number.
- [ ] 7.4 Let a retry succeed. Confirm the banner AND the retry label both disappear
      with no user action.
- [ ] 7.5 Repeat 7.1 in light mode and in a second theme; confirm the label stays legible.
- [ ] 7.6 Refresh the mock's stylesheet href if the bundle hash rotated, and
      re-compare it side by side against the live card at `:8000`.
