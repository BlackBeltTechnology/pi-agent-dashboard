# session-status-banner (delta)

## REMOVED Requirements

### Requirement: Single banner component with composed error-lifecycle surface

**Reason**: Renamed + reduced to the observe-only surface in ADDED
("Single-card error-lifecycle surface (observe-only)"). The collapsed one-line pill state is
removed, dropping the "Collapsed surface is a single line" scenario; the waiting scenario no
longer asserts a Stop retrying control.

### Requirement: Banner actions dispatch through existing handlers

**Reason**: Renamed + reduced to the observe-only control model in ADDED
("Banner is observe-only: no abort control, no collapse"). The "Stop retrying" control and the
dismiss→collapse degradation are removed, dropping the Stop / collapse / sticky-collapse
scenarios.

## ADDED Requirements

### Requirement: Single-card error-lifecycle surface (observe-only)

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

- **retry pending** (one card): `retryState` set with `waiting: true`. Header shows the error
  text (or `retryState.reason`); the same card shows the waiting sub-line — bare attempt
  number, countdown or elapsed — plus Copy. The surface renders no Stop and no collapse control.
- **retry in flight** (one card): `retryState` set with `waiting: false`. As above with the
  animated indicator and an in-flight sub-line.
- **error only** (one card, settled): `lastError` set, `retryState` undefined. Shows message +
  Copy + state-clearing dismiss.
- **hidden**: neither field set → nothing rendered.

There SHALL be NO collapsed one-line pill state.

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
- **THEN** the card SHALL render the waiting sub-line
- **AND** the card SHALL NOT render a Stop retrying control or a collapse control

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

### Requirement: Banner is observe-only: no abort control, no collapse

The banner SHALL NOT render any session-abort control. The always-present session Stop (outside
the banner) is the sole abort entry point, and it ends pi's retry chain. There SHALL be NO
"Stop retrying" control in the banner.

While a `retry` sub-status is carried, the surface SHALL NOT render a dismiss control — it
offers Copy only. The surface clears only via its own lifecycle: when `retryState` clears and
`lastError` clears (a confirmed-good resume). A state-clearing dismiss (`error-banner-dismiss`,
`mdiClose`, invoking the clear-only `onDismiss`) SHALL be offered ONLY when no `retry`
sub-status is carried. There SHALL be NO collapse control and NO collapsed pill.

The settled surface SHALL NOT render a Retry control. The removed `findLastUserPrompt` →
`send_prompt` re-send SHALL NOT return, and no replacement re-drive SHALL be introduced: the
dashboard has no mechanism to re-run a settled turn without appending input.

#### Scenario: No abort control in the banner while retrying

- **GIVEN** the surface carries a `retry` sub-status
- **THEN** the banner SHALL NOT render a Stop retrying control
- **AND** the banner SHALL NOT render a dismiss control or a collapse control
- **AND** the banner SHALL render the retry status sub-line and Copy

#### Scenario: Session Stop ends a pending retry

- **GIVEN** a retry is pending
- **WHEN** the user activates the always-present session Stop (outside the banner)
- **THEN** pi's retry chain SHALL be ended

#### Scenario: Settled error offers a state-clearing dismiss

- **GIVEN** `lastError` is set AND `retryState` is undefined
- **WHEN** the user activates the dismiss control
- **THEN** `onDismiss` SHALL fire, clearing `lastError`
- **AND** NO `abort` message SHALL be dispatched
