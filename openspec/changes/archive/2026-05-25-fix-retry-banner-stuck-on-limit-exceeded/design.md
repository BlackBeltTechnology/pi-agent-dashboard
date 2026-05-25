## Context

Two existing capabilities — `provider-retry-state` (yellow `RetryBanner`, archived 2026-05-07) and `error-detection` (red `ErrorBanner`) — already define a clean transient→terminal split for LLM provider failures. The `provider-retry-state` change shipped a bridge-side synthesis pipeline (`retry-tracker.ts` + `usage-limit-orderer.ts`) because pi's `ExtensionAPI` does not surface `auto_retry_*` events ([pi-mono#2073](https://github.com/badlogic/pi-mono/discussions/2073)).

The shipped pipeline has two latent defects discovered in production. Three parallel exploration agents traced both end-to-end against `bridge.ts`, real `~/.pi/agent/sessions/**/*.jsonl` error fixtures, and pi-coding-agent's own `_isRetryableError` regex.

**Current bridge flow (broken)**, from `packages/extension/src/bridge.ts`:

```
   t=0 pi.message_end(error)
       bridge:913  setTimeout(() => { send msg, run synthesis }, 0)   ← QUEUED
       bridge:943  return                                              ← async unwind

   t=0 pi.sessionManager.appendMessage()      (mutates message.id)
   t=0 pi.agent_end                            ← back-to-back, no await
       bridge:839  usageLimitOrderer.maybeSynthesize()  pending? NO
       bridge:844  retryTracker.observeAgentEnd()       attempt? empty
       bridge:967  connection.send(agent_end)           ← SEND #1 → red banner

   t≈1ms (macrotask)
       bridge:926  connection.send(message_end)         ← SEND #2
       bridge:934  retryTracker.observeMessageEnd()     RETRYABLE match → synthesize start
       bridge:936  usageLimitOrderer.noteRetryStart()   (too late)
                   sendSyntheticRetryEvent(auto_retry_start) → SEND #3 → yellow stuck
```

The retry-tracker's `attempt` map and the orderer's `pending` set are STATE used to coordinate ordering, but they're populated from inside the macrotask — after `agent_end` already queried them.

**Real-world fixture** (Gemini, BME session jsonl line 363, HTTP 429):

```
"errorMessage":"{\"error\":{\"message\":\"...Your project has exceeded its
 monthly spending cap...\",\"status\":\"RESOURCE_EXHAUSTED\"},\"code\":429,
 \"status\":\"Too Many Requests\"}"
```

Regex evaluation:
- `RETRYABLE_PATTERN` → ✓ matches (`429`, `too many requests`)
- `USAGE_LIMIT_PATTERN` → ✗ does NOT match (looks for `monthly limit`, not `monthly spending cap`)

So even with bridge ordering fixed, `usageLimitOrderer.maybeSynthesize` returns null on this real error.

## Goals / Non-Goals

**Goals:**
- Eliminate the (yellow + red) banner-overlap state for the single-turn limit-exceeded case.
- Cover the production error strings the dashboard hits today (Gemini monthly cap, OpenAI insufficient_quota, Anthropic credit balance, Copilot daily cap).
- Preserve every existing scenario in `provider-retry-state` and `error-detection` (no behavior regression).
- Document the bridge wire-ordering invariant in spec form so future refactors don't silently re-introduce the race.
- Update `error-detection`'s Retry-button scenario to reflect what the code actually does post `fix-retry-resends-last-user-message`.

**Non-Goals:**
- Broaden `RETRYABLE_PATTERN` (keeping it in lockstep with pi-coding-agent is a separate concern).
- Add `pi-ai/utils/overflow.js` `isContextOverflow` integration in the dashboard's retry-tracker. Worthwhile but out of scope.
- Classify 401/400/404 as terminal-config errors with their own UX. Separate change.
- Modify pi-coding-agent's retry counts or timing.
- Touch the `RetryBanner` / `ErrorBanner` components themselves; the fix is upstream of them.

## Decisions

### D1 — Move synthesis OUT of `setTimeout(0)`, keep `connection.send(message_end)` deferred

**Decision.** In `bridge.ts` `message_end` handler, run `retryTracker.observeMessageEnd(...)` and `usageLimitOrderer.noteRetryStart/End(...)` **synchronously** before the handler returns. The `setTimeout(0)` continues to wrap only the `connection.send(message_end)` body (still required for entryId capture per pi 0.69+). Synthetic `auto_retry_start` events emitted by the synchronous tracker are queued via the same `setTimeout(0)` so they ship AFTER the deferred `message_end` send but BEFORE the next handler's `agent_end` send (because `agent_end` itself isn't called until pi awaits the message_end handler's return — which now still returns sync, the deferral only affects WHEN the bytes hit the socket, but the orderer state is already updated).

```
   AFTER fix:
   t=0 pi.message_end(error)
       sync:  retryTracker.observeMessageEnd → match → return synth
              usageLimitOrderer.noteRetryStart()                     ← STATE SET NOW
              setTimeout(() => {
                connection.send(message_end)
                connection.send(synth auto_retry_start)
              }, 0)
       return
   t=0 pi.agent_end
       sync:  usageLimitOrderer.maybeSynthesize() pending? YES
              if usage-limit error → returns synth auto_retry_end
              connection.send(synth auto_retry_end)   ← shipped sync, but in queue order
              connection.send(agent_end)
```

Wire order ends up: `message_end → auto_retry_start → auto_retry_end → agent_end` (or just `→ agent_end` when no retry was synthesized). The reducer arms are tolerant of a bunched `start→end` sequence: `auto_retry_start` sets `retryState`, `auto_retry_end` clears it and surfaces `lastError` if `success:false` and no prior `lastError`. The user briefly sees yellow then red — the spec-promised transition.

**Alternatives considered:**
- (a) Make `message_end` send fully sync. Reverts the pi 0.69+ entryId workaround (`fix-per-message-fork`). Breaks fork-from-assistant-message UX.
- (b) Defer `agent_end` send too. Risks breaking other agent_end consumers (turn_end stats extraction, `event-status-extraction.ts`). High blast radius.
- (c) Track a "pending synth" flag in `agent_end` handler and run message_end synthesis from there. Couples two handlers, hard to test, easy to re-break.

D1 is the smallest possible change with the lowest blast radius — only the order in which `observeMessageEnd` and `connection.send` are called swaps.

### D2 — Broaden `USAGE_LIMIT_PATTERN` with a fixture-driven test

**Decision.** Add the following alternatives to the regex:

```regex
/usage[_ ]limit[_ ]reached
 |usage_not_included
 |insufficient_quota
 |credit[_ ]balance
 |quota[_ ]exceeded
 |resource[_ ]exhausted
 |monthly[_ ]limit
 |monthly[_ ]spending[_ ]cap
 |hourly[_ ]limit
 |daily[_ ]limit
 |spending[_ ]cap
 |exceeded[^"]{0,40}(quota|cap|spending)
 |reset after \d+[hms]/i
```

Drive coverage with a fixture file containing real strings extracted from `~/.pi/agent/sessions/**/*.jsonl` (anonymized where needed). Unit tests assert each fixture matches.

**Alternatives considered:**
- (a) Use pi-ai's `isContextOverflow` for richer classification. Wider scope; doesn't actually classify quota-exhaustion (it's about context overflow). Out of scope here.
- (b) Switch from regex to a dispatch table with per-provider classifiers. Heavier, premature; current regex approach with broader coverage is sufficient for known error strings.

### D3 — Reducer defensive guard in `auto_retry_start` arm

**Decision.** When `state.lastError` is set AND set within ~1500 ms of the incoming `auto_retry_start` AND `state.isStreaming === false`, the `auto_retry_start` SHALL be dropped (no `retryState` set, no other state change). This is the safety net that guarantees no (yellow + red) wedge for a single-turn terminal failure even if a future ordering bug recurs.

Edge case preserved: the existing test "retry banner and error banner can coexist (retry above error)" simulates a NEW turn that began retrying while a stale red banner from a prior failed turn is still visible. In that case `agent_start` for the new turn already cleared `lastError` — so the guard's "lastError was set" precondition is false, and the test passes unchanged. We codify the timestamp window because if `lastError` is genuinely from a prior turn but the user hasn't dismissed it yet, the timestamp will be much older than 1500 ms and the guard won't trigger.

**Alternatives considered:**
- (a) Strict invariant in reducer: `auto_retry_start` always clears `lastError`. Loses the "stale red carryover" UX where the prior error stays visible while a fresh turn retries.
- (b) Strict invariant in reducer: setting `lastError` always clears `retryState`. Same problem, opposite direction.
- (c) No reducer guard, rely entirely on bridge fix. Riskier; bridge ordering is fragile and depends on pi internals — defense-in-depth is cheap insurance.

### D4 — Update `error-detection` Retry-button requirement

**Decision.** The current spec says Retry sends `resume_session{mode:"continue"}`. The code (`App.tsx:1123`) instead calls `findLastUserPrompt` + `send_prompt`. This was changed by `fix-retry-resends-last-user-message` (referenced in the App.tsx comment) but the spec wasn't updated. Update the requirement and add a scenario covering the actual current behavior.

### D5 — Wire-ordering invariant captured as a normative requirement

**Decision.** Add `provider-retry-state` requirement: "Bridge MUST forward `auto_retry_start` for a `message_end(error)` BEFORE the next `agent_end` for the same session reaches the dashboard wire." Specifies the contract the orderer + tracker depend on. Future refactors that re-introduce a `setTimeout` race will fail the matching test.

## Risks / Trade-offs

- **Risk: D1 changes when synthesizers run, breaking some other deferred ordering invariant.** → Mitigation: add a bridge-level test driving `message_end+agent_end` back-to-back, asserting wire order ⇒ explicit regression guard. Tracker + orderer state inspection covered by their existing unit tests.
- **Risk: D2 false-positives — USAGE_LIMIT matches a transient rate-limit message that just happens to contain "exceeded".** → Mitigation: `exceeded[^"]{0,40}(quota|cap|spending)` requires one of three terminal-meaning words within 40 chars. Fixture tests will surface real strings that match accidentally.
- **Risk: D3 timestamp window (1500 ms) is heuristic; might suppress a legitimate yellow when the prior turn's error is genuinely fresh and user hasn't navigated away.** → Mitigation: existing scenario "retry banner and error banner can coexist" runs after a NEW `agent_start` that clears `lastError`, so the guard never fires there. The only case the guard suppresses is "single-turn red appears, yellow tries to appear after" — which is exactly the bug we want to suppress. If a real product need for "show yellow over fresh red" emerges later, relaxing the window is a one-line change.
- **Risk: D4 spec change but stale code in some other path.** → Mitigation: `error-detection` archive scenario stays valid against `fix-retry-resends-last-user-message`'s own change record; we only update the live spec.
- **Risk: pi-coding-agent's RETRYABLE_PATTERN drifts and our copy goes stale.** → No new mitigation here; this is an existing concern flagged in `retry-tracker.ts` comments. Not introduced by this change.

## Migration Plan

No migration needed. Pure bug-fix:
- No persistent state shape changes.
- No protocol message types changed.
- Existing dashboard sessions reload with no compat layer.
- Existing tests pass; new tests added.
- Roll-forward only — if a regression emerges, revert the bridge-handler reorder commit and the regex commit independently.

## Open Questions

- Is `1500 ms` the right window for D3? Could pick `2000 ms` for safety margin; doesn't materially change behavior. Decide during implementation if the test fixture suggests otherwise.
- Should the bridge-level wire-ordering test live in `packages/extension/src/__tests__/` (closer to `bridge.ts`) or as a new `__tests__/bridge-retry-ordering.test.ts`? Prefer the latter for discoverability — tasks.md calls it out.
