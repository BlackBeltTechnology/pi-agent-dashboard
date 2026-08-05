## MODIFIED Requirements

### Requirement: Banner actions dispatch through existing handlers

The **"Stop retrying"** action SHALL abort the session — which ends pi's retry chain — by
invoking the same `wrappedHandleAbort` callback the main Stop button uses (snapshotting queues
into draft before dispatching the WS `abort`). It SHALL be present whenever a `retry`
sub-status is carried, in both the waiting and in-flight sub-states. The banner SHALL NOT
render any second session-abort control: the always-present session Stop is the other entry
point and has identical effect.

The **dismiss control SHALL degrade to collapse while a retry is pending.** While the surface
carries a `retry` sub-status, the control SHALL collapse the card to a one-line pill and SHALL
NOT clear state. The pill SHALL carry the error text, the bare attempt number, the countdown
(when known), a Stop retrying control, and an expand control. A state-clearing dismiss SHALL be
offered ONLY when no `retry` sub-status is carried. Consequently a pending retry SHALL always
have an on-screen handle, and dismissing SHALL never leave a running retry chain invisible.

Collapse SHALL be sticky **for the current failure chain only**: once collapsed, subsequent
attempts of the same chain SHALL remain collapsed; a later failure that begins a new chain
SHALL render expanded.

The settled surface SHALL NOT render a Retry control. The removed `findLastUserPrompt` →
`send_prompt` re-send SHALL NOT return, and no replacement re-drive SHALL be introduced: the
dashboard has no mechanism to re-run a settled turn without appending input.

#### Scenario: Stop retrying ends the retry chain

- **GIVEN** the surface carries a `retry` sub-status
- **WHEN** the user clicks "Stop retrying"
- **THEN** the client SHALL invoke `wrappedHandleAbort()` for the selected session
- **AND** an `abort` message SHALL be dispatched for the session

#### Scenario: Dismiss on a retrying surface collapses instead of clearing

- **GIVEN** the surface carries a `retry` sub-status
- **WHEN** the user activates the dismiss control
- **THEN** the card SHALL collapse to the one-line pill
- **AND** `SessionState.lastError` and `SessionState.retryState` SHALL NOT be cleared
- **AND** NO `abort` message SHALL be dispatched

#### Scenario: Collapsed pill retains status and Stop

- **GIVEN** the surface is collapsed while a retry is pending
- **THEN** the pill SHALL show the error text, the bare attempt number, and the countdown when
  known
- **AND** the pill SHALL render a Stop retrying control and an expand control

#### Scenario: Session Stop overrules retry even while the card is collapsed

- **GIVEN** a retry is pending AND the user has collapsed the surface to the pill
- **WHEN** the user activates the always-present session Stop (outside the banner)
- **THEN** pi's retry chain SHALL be ended, identically to the pill's own Stop retrying
- **AND** the collapsed state SHALL NOT prevent or delay that abort

#### Scenario: Collapse is sticky within the failure chain

- **GIVEN** the user collapsed the surface at attempt 3
- **WHEN** attempts 4 and 5 of the same chain fail
- **THEN** the surface SHALL remain collapsed without re-expanding

#### Scenario: A new failure chain renders expanded

- **GIVEN** the user collapsed the surface and the retry chain then ended
- **WHEN** a later, separate turn fails and a new chain begins
- **THEN** the surface SHALL render expanded

#### Scenario: Dismiss clears only once retrying has stopped

- **GIVEN** the surface carries no `retry` sub-status
- **WHEN** the user activates the dismiss control
- **THEN** `SessionState.lastError` SHALL be cleared
- **AND** no abort SHALL be dispatched

#### Scenario: Settled surface offers no Retry control

- **GIVEN** the surface is settled `error`-only
- **THEN** no Retry control SHALL be rendered
- **AND** no `send_prompt` or `resume` SHALL be dispatchable from the banner

#### Scenario: Banner renders no second session-abort control

- **WHEN** the surface is rendered in any state
- **THEN** the only abort-capable control SHALL be "Stop retrying"
- **AND** no separate "Stop session" pill SHALL be rendered

### Requirement: Single banner component with composed error-lifecycle surface

The dashboard SHALL render exactly one banner component (`SessionBanner`) per selected session,
mounted sticky above the `CommandInput`. The banner is a single **error-lifecycle surface**
whose contents are derived from a single selector over `SessionState`. Two banner components
SHALL NEVER be visible simultaneously for the same session, AND the surface SHALL render as ONE
card (a single bordered element), NOT two stacked blocks. The surface SHALL be rendered via the
shared `InlineMessage` primitive with `severity="error"`, so its colors resolve from
`--severity-error-*` theme tokens (NOT raw `red-500` literals); the in-flight retry indicator
SHALL be the primitive's `animate` top accent-bar sweep.

The surface composes an optional **error anchor** (from `lastError`) with an optional **live
retry sub-line** (from `retryState`) WITHIN the same card body. There SHALL NOT be a separate
red card and a separate amber card for one failure. There SHALL be NO `limit-exceeded` surface
state.

Surface states:

- **retry pending, expanded** (one card): `retryState` set with `waiting: true`. Header shows
  the error text (or `retryState.reason`); the same card shows the waiting sub-line — bare
  attempt number, countdown or elapsed — plus Stop retrying, Copy, and a collapse control.
- **retry in flight, expanded** (one card): `retryState` set with `waiting: false`. As above
  with the animated indicator and an in-flight sub-line.
- **retry pending or in flight, collapsed** (one pill): the same state reduced to a single line
  carrying error text, attempt, countdown, Stop retrying, and expand.
- **error only** (one card, settled): `lastError` set, `retryState` undefined. Shows message +
  Copy + state-clearing dismiss.
- **hidden**: neither field set → nothing rendered.

The error anchor SHALL persist while a retry runs on top of it; the surface SHALL clear only
when `lastError` clears and `retryState` is undefined.

#### Scenario: Error and retry render in a single card

- **WHEN** `SessionState.lastError = { message: "overloaded_error", timestamp: 0 }` AND
  `SessionState.retryState = { attempt: 2, waiting: false, delayMs: 4000, reason: "overloaded", startedAt: 0, maxAttempts: 3 }`
- **THEN** the surface SHALL render exactly ONE card element containing the error message
- **AND** the SAME card SHALL contain the retry sub-line for attempt 2
- **AND** the surface SHALL NOT render two separate sibling card elements

#### Scenario: Waiting sub-state renders as a pending retry

- **WHEN** `retryState.waiting` is `true`
- **THEN** the card SHALL render the waiting sub-line and a Stop retrying control

#### Scenario: Collapsed surface is a single line

- **GIVEN** the surface is collapsed while a retry is pending
- **THEN** the rendered DOM SHALL contain exactly one status element for the session
- **AND** it SHALL occupy a single line

#### Scenario: Surface uses severity tokens via InlineMessage

- **WHEN** the settled-error surface is rendered
- **THEN** its background, border, and foreground SHALL resolve from `--severity-error-*`
  tokens through the shared `InlineMessage` primitive
- **AND** the surface SHALL NOT apply raw `red-500`/`amber-500` color literals

#### Scenario: Billing error renders as an ordinary error

- **WHEN** `SessionState.lastError = { message: "usage_limit_reached", timestamp: 1 }` AND
  `retryState` is undefined
- **THEN** the surface SHALL render the ordinary settled-error card
- **AND** the surface SHALL NOT render any `limit-exceeded` variant

#### Scenario: Hidden when neither field is set

- **WHEN** `SessionState.retryState` is undefined AND `SessionState.lastError` is undefined
- **THEN** the `SessionBanner` SHALL render nothing (no DOM)

### Requirement: Banner-state selector is a pure function

A helper `deriveBannerState(state: SessionState): BannerState` SHALL be exported from the
client's event-reducer module. The selector SHALL be pure and SHALL be the sole determinant of
what the `SessionBanner` renders. The host component SHALL NOT compute composition or
precedence inline.

The selector's return shape SHALL carry BOTH the optional error anchor and the optional retry
sub-status, and the retry sub-status SHALL carry the waiting flag and the next-attempt time so
the component renders the countdown without deriving it:

```ts
type BannerState =
  | { variant: "hidden" }
  | {
      error?: { kind: "error"; message: string };
      retry?: {
        attempt: number;
        maxAttempts: number;
        delayMs: number;
        nextAttemptAt?: number;
        waiting: boolean;
        startedAt: number;
        reason: string;
      };
    };
```

The selector SHALL return `{ variant: "hidden" }` only when BOTH `lastError` and `retryState`
are undefined. Collapse is presentation state owned by the component and SHALL NOT appear in
the selector's output.

#### Scenario: Selector returns hidden for empty state

- **WHEN** `deriveBannerState({ retryState: undefined, lastError: undefined, … })` is called
- **THEN** the return SHALL be `{ variant: "hidden" }`

#### Scenario: Selector composes error + retry when both set

- **WHEN** `deriveBannerState({ retryState: { attempt: 2, maxAttempts: 3, delayMs: 4000, waiting: true, reason: "overloaded", startedAt: 0 }, lastError: { message: "overloaded_error", timestamp: 1 }, … })` is called
- **THEN** the return SHALL include `error: { kind: "error", message: "overloaded_error" }`
- **AND** the return SHALL include `retry` carrying `attempt: 2` and `waiting: true`

#### Scenario: Selector propagates the next-attempt time

- **WHEN** the state carries a `waiting: true` retry record with `nextAttemptAt`
- **THEN** the returned `retry` SHALL carry the same `nextAttemptAt`

#### Scenario: Selector never marks limit-exceeded

- **WHEN** `deriveBannerState({ retryState: undefined, lastError: { message: "quota_exceeded for org x", timestamp: 1 }, … })` is called
- **THEN** the return SHALL include `error: { kind: "error", message: "quota_exceeded for org x" }`
- **AND** the return SHALL NOT include any `limit-exceeded` kind
