## Context

See `proposal.md` for motivation. The extension API does not expose pi's native `auto_retry_start` / `auto_retry_end` events, so the bridge reconstructs retry lifecycle from typed `message_end`, `agent_end`, `agent_start`, and `agent_settled` events. Pi usually continues automatically after backoff without a new user message. The client independently carries `lastError` and `retryState`, which allows event-order gaps to leave a stale banner.

Two typed paths can establish a dashboard error: an errored assistant turn and a failed retry-end carrying `finalError`. Transcript JSON and provider-error text are not valid lifecycle sources. User abort is terminal and must never arm another retry.

## Goals / Non-Goals

**Goals:**

- Make every retry chain converge to a deterministic terminal UI state.
- Recognize pi-owned continuation and clear the banner on its first confirmed non-error assistant completion.
- Preserve the provider error when retries exhaust or no automatic retry occurs.
- Hide the banner on user abort and suppress late events from the cancelled chain.
- Offer one-shot Retry plus X on every settled provider error.
- Prove every transition with focused synthetic typed-event tests.

**Non-Goals:**

- Changing pi's retry classifier, retry count, delays, or abort behavior.
- Adding a dashboard-owned repeated-retry scheduler.
- Parsing session transcript JSON or duplicating pi's provider-error regexes.
- Testing against the live dashboard or adding broad end-to-end coverage for pure lifecycle logic.

## Decisions

### D1 · Classify completion from assistant events, not turn ownership

The retry tracker will treat a non-error, non-aborted assistant completion as recovery whenever a retry chain is active. It will not require a preceding user message. An errored assistant completion retains the chain; an aborted completion is terminal but never successful.

Pi's automatic continuation and user-started continuation therefore share the same success criterion. Alternative rejected: infer recovery from user messages, because pi usually resumes itself after backoff. Alternative rejected: infer from transcript JSON, because persisted transcript shape is not a live lifecycle contract.

### D2 · Converge every stop through one terminal outcome table

The bridge/reducer boundary will preserve enough disposition to apply this table:

| Retry stops because | Retry state | Error state | Banner |
|---|---|---|---|
| non-error assistant completion | clear | clear | hidden |
| provider error after exhaustion or no retry | clear | retain/set provider error | settled Retry + Copy + X |
| settle with no new assistant disposition but retained provider error | clear | retain provider error | settled Retry + Copy + X |
| user abort | clear | clear for cancelled chain | hidden |
| confirmed session termination (`session_removed`) | clear | clear | hidden; session marked ended |

No terminal row retains a waiting/in-flight retry presentation. A failed retry-end with `finalError` establishes the provider error when the turn-end path did not already retain one. A raw WebSocket disconnect is not a terminal row because the bridge/session can reconnect.

Alternative rejected: clear all errors on settle, because exhaustion would lose the actionable provider failure. Alternative rejected: retain all errors on settle, because success and abort would leave a stuck banner.

### D3 · Treat abort and confirmed removal as cancellation tombstones

The existing synthesized `auto_retry_end { success:false, attempt:-1 }` identifies user abort without inventing an error message. The bridge will clear its active retry tracker immediately. Client lifecycle reduction will clear retry/error presentation for the cancelled chain and ignore delayed retry/error events until that chain settles or a new explicit run begins.

`session_removed` is the browser's confirmed termination boundary for clean shutdown and force-kill. Its handler will mark the session ended and clear retry/error state. `session_orphaned` continues to emit its separate error toast; the following removal still clears the banner. Raw bridge/browser disconnect does not clear lifecycle state because reconnect is valid.

Suppression is scoped to the cancelled or removed chain; it must not hide a provider error from a later user-started run. Only an observed user `message_start` releases it—prompt dispatch is too early because a streaming follow-up may only be buffered. Alternative rejected: render the last provider error after abort/termination, because the confirmed UX decision is to hide the banner when execution was stopped. Alternative rejected: clear on disconnect, because a transient network failure would falsely erase a live retry.

### D4 · Manual Retry is a one-shot non-user turn on the active bridge

A settled provider error cannot use process-level `resume_session`: the session process remains active and that path correctly rejects live carriers. The client sends one hidden internal retry command through the existing bridge. The command handler calls pi's public `sendMessage(..., { triggerTurn: true })` with a non-displayed custom message, starting a turn without replaying a user message or spawning a second process.

The Retry control disables after its first click until error/retry lifecycle state changes. If pi retries internally, the observed pending lifecycle appears normally; if the turn settles with another error, Retry + X returns.

Alternatives rejected: process-level continue-resume, because it rejects or risks duplicating a live carrier; re-sending the prior prompt, because it duplicates user input; an empty user message, because it still changes user-authored history.

### D5 · Derive controls only from terminal versus active state

`retryState` present selects the pending presentation and a local Collapse/Expand control. `retryState` absent with `lastError` selects the settled presentation with Retry, Copy, and X. Neither state present hides the banner. Local collapse state resets when retrying stops so a terminal error cannot remain collapsed behind a retry-only affordance.

The banner remains observe-only: session Stop outside the banner owns abort.

### D6 · Floor compatibility settles preserve pending retry state

Pi versions without native `agent_settled` receive a bridge-synthesized compatibility settle after every `agent_end`. When `agent_end` armed another attempt, the bridge marks the compatibility settle `retryPending:true`; the client may settle per-attempt streaming status but preserves retry/cancellation state. The bridge schedules one expected-attempt reconciliation at observed retry delay plus a grace period. A matching `agent_start` consumes the armed attempt and makes the fallback a no-op. If no start arrives, the still-matching tracker chain closes failed with its retained provider error and the bridge sends an unmarked terminal settle. This handles floor-pi non-retryable errors that the observer cannot classify without duplicating pi's provider regexes.

### D7 · Use a synthetic event decision table as the regression boundary

Focused Vitest suites will emit typed event objects directly through retry-tracker, bridge/reducer, server routing, and banner surfaces. Fixtures will cover both error-entry paths and every terminal row, including automatic continuation without a user message, repeated error, missing terminal assistant disposition, exhaustion, one-shot active-bridge Retry dispatch/success/failure, floor-pi multi-attempt sequencing, abort, late events after abort, buffered follow-up non-release, confirmed clean shutdown/force-kill, orphan notification followed by removal, and temporary disconnect without removal.

Tests will assert state and controls, not timers or transcript files. No new test harness is required.

## Risks / Trade-offs

- **[Late events from an aborted chain are indistinguishable from a later run]** → Scope cancellation suppression to settle or the next explicit run-start boundary and cover both edges with synthetic tests.
- **[Disconnect can mean transient network loss or process death]** → Clear only on the existing confirmed `session_removed` boundary, never on socket close alone.
- **[Bridge and reducer clear in different event order]** → Make terminal operations idempotent and test successful retry-end before/after related completion events where the reducer can observe both.
- **[Missing assistant disposition at settle could be misclassified as success]** → Retain the last failed disposition in the retry tracker and default an active unresolved chain to failure, never success.
- **[Manual Retry overlaps pi automatic retry]** → Render Retry only when no retry sub-status exists and disable it after one click until lifecycle state changes.
- **[Process-level resume rejects a live settled session]** → Route Retry to pi's in-process custom trigger-turn API through the existing bridge.
- **[Floor-pi compatibility settle fires per attempt]** → Mark it `retryPending:true`; reconcile only the same still-armed attempt after delay + grace; cover retry-start cancellation and no-start terminal fallback in focused tests.

## Migration Plan

No persisted schema or protocol migration is required. Deploy extension and client changes together. Rollback restores prior lifecycle reduction and banner behavior; no data migration is needed.
