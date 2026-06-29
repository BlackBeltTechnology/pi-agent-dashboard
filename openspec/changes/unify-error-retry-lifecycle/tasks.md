## 1. Resolve open questions (design.md) — RESOLVED, see design.md "Resolved Decisions"

- [x] 1.1 Confirmed-good trigger = first assistant `message_end` with `stopReason === "end_turn"` OR clean `agent_end`; mid-turn `tool_use` stops do NOT clear (avoids flicker)
- [x] 1.2 Auto-retry header = no early promotion; retry-only stays amber until terminal `agent_end(error)` sets `lastError`
- [x] 1.3 Stale error on brand-new prompt = wait for confirmed-good (no optimistic clear on send); abort latch cleared on new prompt

## 2. Reducer — defer lastError clearing (error-detection)

- [x] 2.1 Write failing test: `agent_start` no longer clears `lastError` (event-reducer test)
- [x] 2.2 Write failing test: confirmed non-error `message_end` clears `lastError`; failed retry updates without a hidden intermediate frame
- [x] 2.3 Remove `next.lastError = undefined` from the `agent_start` arm in `event-reducer.ts`
- [x] 2.4 Add confirmed-good clear keyed on a terminal-SUCCESS `stopReason` (`CONFIRMED_GOOD_STOP_REASONS = {"stop","end_turn"}`; real pi-ai wire value is `"stop"`) on `message_end` AND clean `agent_end` (`isCleanAgentEnd`); do NOT clear on `toolUse`/`error`/`aborted`/`length` (per 1.1). E2E `ask-select` caught that `agent_end` yielding at an interactive tool carries a `toolUse` last message — tightened from `!== "error"` to the success allowlist.
- [x] 2.5 Make tests 2.1/2.2 pass; update existing reducer tests that asserted the old `agent_start` clear

## 3. Selector + composed BannerState (session-status-banner)

- [x] 3.1 Write failing test: `deriveBannerState` composes `error` + `retry` when both set; returns `hidden` only when both undefined; marks `limit-exceeded` via `USAGE_LIMIT_PATTERN`
- [x] 3.2 Change `deriveBannerState` return shape to `{ variant: "hidden" } | { error?, retry? }`
- [x] 3.3 Update all selector unit tests to the composed shape

## 4. SessionBanner UI — composed surface + dismiss semantics

- [x] 4.1 Write failing component test: error anchor persists with retry sub-line composed on top; Stop retrying present
- [x] 4.2 Render composed surface (persistent error header + swappable retry/Retry/limit sub-line) in `SessionBanner.tsx`, preserving `data-testid="error-banner"`, `error-banner-dismiss`, `retry-banner` markers
- [x] 4.3 Wire Dismiss ✕ to be state-dependent: abort+clear on retrying/retryable, clear-only on limit-exceeded (decision lives in `SessionBanner`, calls `onAbort` then `onDismiss`)
- [x] 4.4 `App.tsx` `onDismiss` clears `lastError`; `onAbort` dispatches WS abort; dot derivation already single-color via `!lastError` guard
- [x] 4.5 Make component tests pass; migrate existing banner tests to composed surface

## 5. Single red surface — suppress duplicate inline error card

- [x] 5.1 Write failing test for the suppression helper (failed attempt collapses while error-lifecycle surface active)
- [x] 5.2 Extend `collapse-retried-errors.ts` with `findSurfaceSuppressedErrorIds` to collapse the inline failed-attempt card for the active surface failure
- [x] 5.3 Wire helper into `ChatView.tsx` render path; renders compact `RetriedErrorBadge`
- [x] 5.4 Make tests pass; add assertion that no simultaneous yellow-banner + red-inline-card for the same failure

## 6. Bridge — abort latch outlasts backoff (provider-retry-state)

- [x] 6.1 Write failing test: latch re-aborts a retry that wakes after the 2 s scheduler window
- [x] 6.2 Write failing tests: latch cleared by new user prompt (new turn not killed) and on settle (`agent_end`/idle)
- [x] 6.3 Add per-session `AbortLatch` in the bridge (abort-on-sight per design D3b): set on `abort`, re-call `cachedCtx.abort()` on resumed agent_start/assistant message_start, clear on settle (`agent_end`) OR new user prompt (`noteUserPrompt` pre-send + user message_start)
- [x] 6.4 Keep the existing persistent-abort scheduler as the fast path (rawAbort, streaming-transition break) — unchanged
- [x] 6.5 Make bridge tests pass

## 7. Integration + regression

- [x] 7.1 Add reducer/integration test for the full lifecycle: error → retry-on-top → fail (no flicker) → retry → confirmed-good clear
- [x] 7.2 Run `npm test`; my suites green (event-reducer 162, SessionBanner 17, collapse 23, extension 337). Remaining 17 failures pre-existing + unrelated (image-fit Jimp dep; 2 server timing flakes that pass in isolation). `tsc --noEmit` clean for all touched files.
- [x] 7.3 Browser E2E QA: `tests/e2e/error-lifecycle.spec.ts` (3 specs) against the real Docker stack (faux model) — all PASS: (1) terminal error = one `error-banner` + Retry + Dismiss, no yellow `retry-banner`; (2) error anchor PERSISTS across a new turn that pauses at `ask_user` (no confirmed-good yet); (3) error clears after a confirmed-good `stop` response. Caught two real bugs pre-merge: `isCleanAgentEnd` too loose (cleared on `toolUse` pause) and the confirmed-good check used fictional `"end_turn"` instead of pi-ai's real `"stop"`. (Live-rate-limit abort-latch path stays unit-covered: `abort-latch.test.ts`.)
- [ ] 7.4 Build + deploy: `npm run build` → `POST /api/restart`; bridge change → `npm run reload` — deploy step; per AGENTS.md worktree work does NOT deploy to the live instance
