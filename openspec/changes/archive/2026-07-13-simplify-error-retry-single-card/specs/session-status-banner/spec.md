## MODIFIED Requirements

### Requirement: Single banner component with composed error-lifecycle surface

The dashboard SHALL render exactly one banner component (`SessionBanner`) per selected session, mounted sticky above the `CommandInput` (between `ChatView` and `CommandInput`). The banner is a single **error-lifecycle surface** whose contents are derived from a single selector over `SessionState`. Two banner components SHALL NEVER be visible simultaneously for the same session, AND the surface SHALL render as ONE card (a single bordered element), NOT two stacked blocks.

The surface composes an optional **error anchor** (from `lastError`) with an optional **live retry sub-line** (from `retryState`) WITHIN the same card body: the error message is the header row, the retry status is a sub-line beneath it, and a thin animated indicator on the same card conveys the retrying state. There SHALL NOT be a separate red card and a separate amber card for one failure.

There SHALL be NO `limit-exceeded` surface state. Billing / quota failures render identically to any other error (ordinary error state); no `USAGE_LIMIT_PATTERN` classification is performed.

Surface states:

- **error + retrying** (one card): `lastError` set AND `retryState` set. Header shows the error message; the same card shows a "retrying… (attempt N)" sub-line + the animated indicator + a "Stop (ends the session)" action.
- **retrying only** (one card): `retryState` set, `lastError` undefined. Shows `retryState.reason` sub-line + animated indicator + "Stop (ends the session)".
- **error only** (one card, settled): `lastError` set, `retryState` undefined. Shows message + Dismiss + copy. No Stop (pi already stopped) and NO manual retry (pi's in-flight auto-retry is the only retry path).
- **hidden**: neither field set → nothing rendered.

The error anchor SHALL persist while a retry runs on top of it; the surface SHALL clear only when `lastError` clears (per `error-detection` "Error state cleared on confirmed-good response") and `retryState` is undefined.

#### Scenario: Error and retry render in a single card
- **WHEN** `SessionState.lastError = { message: "overloaded_error", timestamp: 0 }` AND `SessionState.retryState = { attempt: 2, maxAttempts: -1, delayMs: -1, reason: "overloaded", startedAt: 0 }`
- **THEN** the surface SHALL render exactly ONE card element containing the error message "overloaded_error"
- **AND** the SAME card SHALL contain the "retrying… (attempt 2)" sub-line
- **AND** the surface SHALL NOT render two separate sibling card elements

#### Scenario: Retrying-only when no terminal error yet
- **WHEN** `SessionState.retryState` is set AND `SessionState.lastError` is undefined
- **THEN** the surface SHALL render the single card with the retrying sub-line and `reason`
- **AND** a "Stop (ends the session)" action SHALL be present

#### Scenario: Billing error renders as an ordinary error (no limit-exceeded variant)
- **WHEN** `SessionState.lastError = { message: "usage_limit_reached", timestamp: 1 }` AND `retryState` is undefined
- **THEN** the surface SHALL render the ordinary settled-error card with message + Dismiss + copy
- **AND** the surface SHALL NOT render any `limit-exceeded` / 💳 variant
- **AND** no `USAGE_LIMIT_PATTERN` test SHALL be performed

#### Scenario: Hidden when neither field is set
- **WHEN** `SessionState.retryState` is undefined AND `SessionState.lastError` is undefined
- **THEN** the `SessionBanner` SHALL render nothing (no DOM)

### Requirement: Banner-state selector is a pure function

A helper `deriveBannerState(state: SessionState): BannerState` SHALL be exported from `packages/client/src/lib/event-reducer.ts`. The selector SHALL be pure (no side effects, deterministic on its input) and SHALL be the sole determinant of what the `SessionBanner` renders. The host component SHALL NOT compute composition or precedence inline.

The selector's return shape SHALL carry BOTH the optional error anchor and the optional retry sub-status (composition). The error kind is a single value `"error"` — there is NO `"limit-exceeded"` kind and the selector SHALL NOT import or reference `USAGE_LIMIT_PATTERN`:

```ts
type BannerState =
  | { variant: "hidden" }
  | {
      // present iff lastError set
      error?: { kind: "error"; message: string };
      // present iff retryState set
      retry?: { attempt: number; maxAttempts: number; delayMs: number; startedAt: number; reason: string };
    };
```

The selector SHALL return `{ variant: "hidden" }` only when BOTH `lastError` and `retryState` are undefined.

#### Scenario: Selector returns hidden for empty state
- **WHEN** `deriveBannerState({ retryState: undefined, lastError: undefined, … })` is called
- **THEN** the return SHALL be `{ variant: "hidden" }`

#### Scenario: Selector composes error + retry when both set
- **WHEN** `deriveBannerState({ retryState: { attempt: 2, maxAttempts: -1, delayMs: -1, reason: "overloaded", startedAt: 0 }, lastError: { message: "overloaded_error", timestamp: 1 }, … })` is called
- **THEN** the return SHALL include `error: { kind: "error", message: "overloaded_error" }`
- **AND** the return SHALL include `retry: { attempt: 2, … reason: "overloaded" }`

#### Scenario: Selector never marks limit-exceeded
- **WHEN** `deriveBannerState({ retryState: undefined, lastError: { message: "quota_exceeded for org x", timestamp: 1 }, … })` is called
- **THEN** the return SHALL include `error: { kind: "error", message: "quota_exceeded for org x" }`
- **AND** the return SHALL NOT include any `limit-exceeded` kind

### Requirement: Banner actions dispatch through existing handlers

The "Stop (ends the session)" action SHALL be the SINGLE control that aborts the session. It SHALL invoke the same `wrappedHandleAbort` callback the main Stop button uses (snapshotting queues into draft before dispatching the WS `abort`). Its label SHALL make clear it ends the session, so the user is aware the action stops the session. Stop SHALL be present only while a retry is live (`retryState` set); on a settled error-only surface Stop SHALL be omitted (pi has already stopped).

There SHALL be NO manual retry control on the settled error surface. pi's in-flight auto-retry is the only retry path; once a turn has terminally errored the session is idle and the user starts a fresh turn by typing a new prompt. The faulty `findLastUserPrompt` → `send_prompt` re-send is removed (it appended a duplicate user turn).

The "Dismiss" (✕) action SHALL be **clear-only in every state**. It SHALL clear `lastError` and `retryState` locally and SHALL NEVER dispatch an abort. Dismissing a retrying surface hides the card while pi continues its own retry/turn in the background; it does NOT stop the session.

#### Scenario: Stop ends the session
- **GIVEN** the surface carries a `retry` sub-status
- **WHEN** the user clicks "Stop (ends the session)"
- **THEN** the client SHALL invoke `wrappedHandleAbort()` for the selected session
- **AND** an `abort` message SHALL be dispatched for the session

#### Scenario: Dismiss on a retrying surface clears only and does NOT abort
- **GIVEN** the surface carries a `retry` sub-status (pi is mid-retry)
- **WHEN** the user clicks Dismiss (✕)
- **THEN** `SessionState.lastError` AND `SessionState.retryState` SHALL be cleared locally
- **AND** the client SHALL NOT invoke `wrappedHandleAbort()`
- **AND** NO `abort` message SHALL be dispatched
- **AND** pi SHALL continue its in-flight retry/turn uninterrupted

#### Scenario: Dismiss on a settled error clears only
- **GIVEN** the surface is settled `error`-only (pi already stopped)
- **WHEN** the user clicks Dismiss (✕)
- **THEN** `SessionState.lastError` SHALL be cleared
- **AND** no abort SHALL be dispatched

#### Scenario: Settled error surface offers no manual retry
- **GIVEN** the surface is settled `error`-only
- **THEN** the card SHALL render the message + copy + clear-only Dismiss
- **AND** the card SHALL NOT render any "Retry" / "Try again" control
- **AND** no `send_prompt` re-send path SHALL exist for the banner

## REMOVED Requirements

### Requirement: Manual retry hides duplicate user bubble in chat view

**Reason**: The manual retry no longer re-sends the last user prompt via `send_prompt` — it re-drives the request via `resume mode:"continue"`, which produces no duplicate user message. The `retriedFrom` de-dup flag for manually-retried prompts is therefore obsolete for this path.

**Migration**: Manual retry now uses continue-resume (see "Banner actions dispatch through existing handlers"). No transcript de-dup is needed because no duplicate user message is created. The `retriedFrom` flag remains valid for any other re-send path that still appends a user message (none in this surface).
