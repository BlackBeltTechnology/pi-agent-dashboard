## Why

When a provider returns a hard usage-limit / billing-cap error (e.g. Gemini "Your project has exceeded its monthly spending cap" with HTTP 429 / `RESOURCE_EXHAUSTED`), the dashboard ends up showing **both** banners at once: the red `ErrorBanner` (terminal) AND a stuck yellow `RetryBanner` (transient) that never clears until the next user turn. Two compounding root causes, both proven against real session logs and bridge source:

1. **Bridge wire-order race.** `bridge.ts:913` defers the `message_end` send via `setTimeout(0)` (a workaround introduced by `fix-per-message-fork` for pi 0.69+ entryId capture). When pi fires `message_end(error)` and `agent_end` synchronously back-to-back (verified in pi-coding-agent `agent-session.js:298–331`), `agent_end` is sent first while the retry-tracker's `attempt` map and the usage-limit-orderer's `pending` set are still empty. Both synthesizers return null, `agent_end` ships bare, then the deferred macrotask fires, the tracker matches `RETRYABLE_PATTERN`, and `auto_retry_start` ships AFTER `agent_end` — leaving `retryState` set forever (no future `auto_retry_end` will arrive, no `agent_end`/`agent_start` is coming for this turn).

2. **`USAGE_LIMIT_PATTERN` is too narrow.** The regex matches `monthly limit` but NOT `monthly spending cap`. It does not match Gemini's `RESOURCE_EXHAUSTED`, OpenAI `insufficient_quota`, or Anthropic `credit balance` phrasings. Even without bug 1, `usageLimitOrderer.maybeSynthesize` returns null on the most common real-world quota errors, so the orderer never synthesizes the `auto_retry_end` that the spec promises to fire BEFORE `agent_end`.

A third, smaller, related issue: the `error-detection` spec's "Retry button" scenario is stale — it says the button sends `resume_session{mode:"continue"}`, but `App.tsx:1123` was rewritten by `fix-retry-resends-last-user-message` to instead call `findLastUserPrompt` + `send_prompt`. The spec needs to catch up.

## What Changes

- **Bridge ordering invariant.** Move retry/usage-limit synthesis OUT of the `setTimeout(0)` macrotask in `bridge.ts` `message_end` handler. The `connection.send(message_end)` body MAY remain deferred (still needed for entryId capture per pi 0.69+), but `retryTracker.observeMessageEnd(...)` and `usageLimitOrderer.noteRetryStart/End(...)` SHALL run synchronously inside the message_end handler, BEFORE the handler returns. Synthetic `auto_retry_*` events SHALL be queued so they ship in the same wire-order they would have under the old "send everything sync" contract: ordering becomes `auto_retry_start → message_end → agent_end → auto_retry_end` (or `→ agent_end` alone when no retry).
- **Broaden `USAGE_LIMIT_PATTERN`.** Add coverage for Gemini `monthly[_ ]spending[_ ]cap`, generic `RESOURCE_EXHAUSTED`, OpenAI `insufficient_quota`, Anthropic `credit balance`, generic `daily limit`, and `exceeded.{0,40}(quota|cap|limit)`. The specs/usage-limit-orderer test SHALL include real production-log error strings as fixtures.
- **Reducer safety net.** Add a defensive guard in the `auto_retry_start` arm: when `state.lastError` is already set with a timestamp from the same turn (i.e. set within the last ~1s and `state.isStreaming === false`), the incoming `auto_retry_start` SHALL be dropped (no `retryState` set). This is belt-and-braces: if any future ordering bug recurs, the UI never enters the (yellow + red) wedge state for a single turn. The existing "carry-over from previous turn" scenario (yellow on top of stale red, both visible briefly) is preserved by checking `state.isStreaming` and the timestamp window.
- **Update `error-detection` retry-button scenario.** Replace `resume_session{mode:"continue"}` language with `send_prompt{text, images}` driven by `findLastUserPrompt`, matching what `App.tsx:1123` actually does today. Add a scenario for "Retry on errored alive session re-runs last user message".
- **No new wire types.** Same `event_forward { eventType: auto_retry_start | auto_retry_end }` envelope. Same reducer state shape.

## Capabilities

### New Capabilities

(none — purely deltas)

### Modified Capabilities

- `provider-retry-state`: Adds wire-ordering invariant requirement; broadens `USAGE_LIMIT_PATTERN` coverage requirement (with Gemini / OpenAI / Anthropic phrasings); adds reducer no-double-banner guard requirement.
- `error-detection`: Updates "Retry action on error banner" requirement to reflect the `send_prompt` wiring instead of stale `resume_session{continue}` language; adds scenario for re-running the last user message.

## Impact

- **Code.**
  - `packages/extension/src/bridge.ts` — restructure `message_end` handler so synthesis (retryTracker, usageLimitOrderer) runs sync; only `connection.send(message_end)` body stays in `setTimeout(0)`.
  - `packages/extension/src/usage-limit-orderer.ts` — broaden `USAGE_LIMIT_PATTERN`.
  - `packages/client/src/lib/event-reducer.ts` — add defensive guard in `auto_retry_start` arm (drop when `lastError` is fresh-same-turn).
- **Tests.**
  - `packages/extension/src/__tests__/usage-limit-orderer.test.ts` — fixture-driven tests with real strings (Gemini monthly cap, OpenAI insufficient_quota, Anthropic credit balance, GitHub Copilot daily cap).
  - New `packages/extension/src/__tests__/bridge-retry-ordering.test.ts` (or extend existing bridge tests) — drive message_end+agent_end back-to-back, assert wire order: `auto_retry_start` ships BEFORE `agent_end`.
  - `packages/client/src/lib/__tests__/event-reducer.test.ts` — scenario for the new `auto_retry_start` drop-when-fresh-error guard, with explicit assertion that the existing "stale lastError carryover" path is unaffected.
- **Specs.**
  - `provider-retry-state` delta: 3 new requirements + scenarios.
  - `error-detection` delta: revised retry-button requirement + 1 new scenario.
- **Protocol.** No changes.
- **No breaking changes.** Existing `retryState` / `lastError` shapes unchanged. Existing dashboard sessions reload cleanly.
- **Out of scope** (explicit): broadening `RETRYABLE_PATTERN`; adding pi-ai `isContextOverflow` integration in the dashboard's retry-tracker; classifying 401/400/404 as terminal-config errors; changing pi-coding-agent's internal retry counts. These are tracked separately and DO NOT need to land for this fix to resolve the user-visible double-banner symptom.
