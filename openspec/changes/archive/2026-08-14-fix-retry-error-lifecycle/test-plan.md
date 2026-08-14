# Test Plan — fix-retry-error-lifecycle

Stage: design   Generated: 2026-08-14

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Automatic continuation closes observed retry chain | decision-table | L1 | automated | active retry tracker with retained assistant provider error | emit non-error assistant `message_end` without any intervening user message | exactly one `auto_retry_end { success: true }`; tracker becomes inactive |
| E2 | Automatic continuation closes observed retry chain | decision-table | L1 | automated | active retry tracker with retained assistant provider error | emit another assistant `message_end` with `stopReason: "error"` | no successful retry-end; retained failure remains active |
| E3 | Automatic continuation closes observed retry chain | decision-table | L1 | automated | active retry tracker | emit assistant `message_end` with `stopReason: "aborted"` | no success and no new retry is armed |
| E4 | Error state cleared on confirmed-good response | decision-table | L1 | automated | `retryState` plus `lastError` | reduce successful retry-end / non-error completion | both fields clear and derived banner state is `hidden` |
| E5 | Error state cleared on confirmed-good response | decision-table | L1 | automated | `retryState` plus retained provider `lastError` | reduce failed terminal settle with no new assistant disposition | `retryState` clears; `lastError` remains; banner is settled with Retry + X |
| E6 | Error state cleared on confirmed-good response | decision-table | L1 | automated | no `lastError`, active retry state | reduce failed retry-end carrying `finalError: "503 overloaded"` | retry clears; `lastError.message` becomes `503 overloaded`; settled actions include Retry + X |
| E7 | Retry action on every settled provider error | equivalence-partitioning | L1 | automated | settled provider error with prior user messages on an active session | activate Retry twice before state changes | one hidden internal retry command reaches the active bridge; one non-user custom turn starts; control disables; messages unchanged |
| E8 | Retry action on every settled provider error | equivalence-partitioning | L1 | automated | settled provider error with no prior user message | activate Retry | the same non-user custom turn starts; Retry does not depend on prompt lookup or process-level resume |
| E9 | Retry action on every settled provider error | state-transition | L1 | automated | failed one-shot Retry returns the same provider error text with a newer timestamp | rerender terminal state | Retry + Copy + X are available again from lifecycle revision; no dashboard retry loop or second process is armed |

### Performance

No performance scenarios. The change adds no timed contract or unbounded data path.

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Trailing control states its own action | decision-table | L1 | automated | retry waiting, retry in-flight, settled error, hidden state | render `SessionBanner` for each state | waiting/in-flight show Collapse not X/Retry; settled shows Retry + Copy + X; hidden renders no banner |
| F2 | Trailing control states its own action | state-transition | L1 | automated | banner collapsed during active retry with retained error | terminal failed settle clears retry state | banner re-expands and exposes Retry + X; no collapse-only terminal card remains |
| F3 | Trailing control states its own action | state-convergence | L1 | automated | visible pending banner | non-error automatic continuation completes | banner converges to absent without a dismiss click |
| F4 | Banner is observe-only | state-transition | L1 | automated | active retry banner | activate Collapse then Expand | no dismiss, abort, Retry, or stop command fires; retry state is unchanged |
| F5 | Banner is observe-only | decision-table | L1 | automated | settled error with and without `onRetry` callback | render banner | callback present: Retry + Copy + X; absent: Copy + X only; banner never contains Stop retrying |
| F6 | Confirmed full session termination | state-convergence | L1 | automated | session map status active and session state has `retryState` and `lastError` | dispatch browser `session_removed` | session status becomes ended; retry/error fields clear; derived banner state is hidden |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Automatic continuation closes observed retry chain | fault-injection (provider error) | L1 | automated | typed sequence `message_end(error) → agent_end(error) → agent_start → message_end(success)` | feed sequence through tracker/reducer without user message | pending retry appears, then successful completion clears retry and error; no stuck banner |
| X2 | Automatic continuation closes observed retry chain | fault-injection (exhaustion) | L1 | automated | typed repeated errored assistant/attempt events ending in `agent_settled` | feed final settle | retained provider error becomes settled Retry + X; no pending retry control remains |
| X3 | Bridge synthesizes retry-end on user abort | fault-injection (abort) | L1 | automated | active tracker and visible retry/error state | invoke abort command | bridge emits `{ success:false, attempt:-1 }` without `finalError`; client clears retry/error; banner hides |
| X4 | Bridge synthesizes retry-end on user abort | illegal state-transition | L1 | automated | abort tombstone active | emit delayed retry-start, waiting, assistant error, attempt end, and settle from cancelled chain | no retry/error banner reopens and no successful retry-end is emitted |
| X5 | Confirmed full session termination | fault-injection (process kill) | L1 | automated | visible retry/error state | dispatch confirmed `session_removed` after force-kill | state clears and banner hides even when no assistant completion or `agent_settled` arrived |
| X6 | Confirmed full session termination | fault-injection (orphan) | L1 | automated | visible retry/error state | dispatch `session_orphaned { pid }` then `session_removed` | orphan error toast fires; retry/error banner clears on removal |
| X7 | Temporary disconnect does not fake termination | fault-injection (disconnect) | L1 | automated | visible retry/error state | dispatch connection/bridge disconnect without `session_removed` | retry/error state remains for reconnect; no terminal outcome is synthesized |
| X8 | Error state cleared on confirmed-good response | illegal state-transition | L1 | automated | no active retry state and no error | reduce duplicate/late retry-end | reducer remains idempotent and hidden; no synthetic error is created without a non-empty provider `finalError` |
| X9 | Automatic continuation closes observed retry chain | state-transition | L1 | automated | floor-pi failed `agent_end` with compatibility settle | classify pending settle, then exercise matching-start and no-start deadline branches | pending settle preserves retry state; matching start cancels fallback; still-armed no-start chain converges failed with retained error |

## Coverage summary

- Requirements covered: 6/6
- Scenarios by class: edge 9 · perf 0 · frontend 6 · error 9
- Scenarios by level: L1 24 · L2 0 · L3 0
- Scenarios by disposition: automated 24 · manual-only 0

## New infra needed

- None. Use existing Vitest retry-tracker, event-reducer, SessionBanner RTL, bridge command-handler, and `useMessageHandler` test harnesses with synthetic typed events.
