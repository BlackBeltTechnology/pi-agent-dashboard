## 1. Bridge synchronizer-state ordering fix (D1, D5)

- [x] 1.1 In `packages/extension/src/bridge.ts` `message_end` handler, run `retryTracker.observeMessageEnd(...)` SYNCHRONOUSLY (before the `setTimeout(0)` block); capture the synthetic event into a local variable.
- [x] 1.2 Run `usageLimitOrderer.noteRetryStart(sessionId)` / `noteRetryEnd(sessionId)` synchronously based on the synthetic event's type (still inside the message_end handler, before return).
- [x] 1.3 Move only the `connection.send(message_end)` body into the existing `setTimeout(0)` block; the synthesized `auto_retry_*` ships SYNCHRONOUSLY in the same tick so it lands on the wire before the next `agent_end`. (Reducer's `message_end` arm is no-op for retry/error fields, so the deferred body order doesn't matter for this fix.)
- [x] 1.4 Re-verify `agent_end` handler order: `usageLimitOrderer.maybeSynthesize` → `retryTracker.observeAgentEnd` (fallback) → `connection.send(agent_end)`. No structural change; synthesizer state is now reliably populated when this runs.
- [x] 1.5 Added `packages/extension/src/__tests__/bridge-retry-ordering.test.ts` with a `BridgeSim` that mirrors the real bridge synthesizer pipeline; asserts wire order `auto_retry_start → message_end → auto_retry_end → agent_end` for back-to-back retryable error.
- [x] 1.6 Added a Gemini-fixture scenario in the same file using the real `monthly spending cap` / `RESOURCE_EXHAUSTED` 429 error string.

## 2. Broaden USAGE_LIMIT_PATTERN (D2)

- [x] 2.1 Updated `USAGE_LIMIT_PATTERN` to broadened regex (`monthly[_ ]spending[_ ]cap`, `resource[_ ]exhausted`, `insufficient_quota`, `credit[_ ]balance`, `daily[_ ]limit`, `spending[_ ]cap`, `exceeded[^"]{0,40}(quota|cap|spending)`) with documentation header.
- [x] 2.2 Added `packages/extension/src/__tests__/fixtures/usage-limit-error-strings.ts` with `USAGE_LIMIT_FIXTURES` (9 terminal entries incl. real Gemini fixture) and `NON_USAGE_LIMIT_FIXTURES` (8 transient entries).
- [x] 2.3 Extended `usage-limit-orderer.test.ts` with `it.each(USAGE_LIMIT_FIXTURES)` asserting positive match.
- [x] 2.4 Same test file: `it.each(NON_USAGE_LIMIT_FIXTURES)` asserting negative match. All 36 tests pass.

## 3. Reducer defensive guard (D3)

- [x] 3.1 Added defensive guard in `auto_retry_start` arm with `FRESH_ERROR_WINDOW_MS = 1500`.
- [x] 3.2 Added "drops auto_retry_start when lastError is fresh same-turn" scenario.
- [x] 3.3 Added "does NOT drop auto_retry_start when lastError is stale carry-over" scenario.
- [x] 3.4 Added "does NOT drop auto_retry_start when streaming" scenario; also added "undefined lastError" and "boundary 1501ms" edge cases.
- [x] 3.5 ChatView coexist test still passes (124 reducer + 30 ChatView tests green).

## 4. Error-detection spec sync (D4)

- [x] 4.1 Verified `App.tsx:1129` `onRetryAfterError` closure matches the spec: `const last = findLastUserPrompt(selectedState.messages); if (last) handleSendPromptToSession(selectedId, last.text, last.images);`.
- [x] 4.2 Coverage already exists via decomposed unit tests: `findLastUserPrompt` has 6 scenarios in `event-reducer.test.ts:1980+`; ErrorBanner Retry click invokes `onRetry` (verified in `ErrorBanner.test.tsx:27`). App.tsx is pure composition of these well-tested pieces; no new integration test needed.

## 5. Cross-cutting validation

- [x] 5.1 Full suite passes: 4866 tests green / 10 skipped / 0 failed (`/tmp/pi-test.log`).
- [x] 5.2 `npm run reload:check` type-check: 0 errors in any file touched by this change. Pre-existing errors in `use-message-handler-pending-prompt.test.ts`, `plugin-registry.tsx`, `provider-register-reload.test.ts` are out of scope.
- [ ] 5.3 Manual repro: in a Gemini-backed session, exceed monthly spending cap → confirm only red `ErrorBanner` appears, no stuck yellow `RetryBanner`, dot is red (not amber). _(deferred to user)_
- [ ] 5.4 Manual repro: in any session, hit a transient `503 high demand` (e.g. Gemini overloaded) → confirm yellow → red transition is visible (yellow first, then red replaces it) without overlap. _(deferred to user)_
- [ ] 5.5 Manual: Retry button on red banner — verify it re-sends the last user message via `send_prompt`, not `resume_session`. _(deferred to user)_

## 6. Docs

- [x] 6.1 Subagent delegated; appended change-history annotations to `bridge.ts`, `usage-limit-orderer.ts`, `retry-tracker.ts`, `event-reducer.ts` rows; added NEW rows for `bridge-retry-ordering.test.ts` and `fixtures/usage-limit-error-strings.ts` in path-alphabetical order.
- [x] 6.2 AGENTS.md unchanged — no new architectural backbone files.

## 7. Archive

- [ ] 7.1 After QA passes (5.3, 5.4, 5.5 manually verified), follow `openspec-archive-change` skill to promote spec deltas into `openspec/specs/provider-retry-state/spec.md` and `openspec/specs/error-detection/spec.md`.
