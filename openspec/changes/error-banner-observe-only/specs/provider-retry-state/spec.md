# provider-retry-state (delta)

## REMOVED Requirements

### Requirement: Retry banner in chat view

**Reason**: Renamed + reduced to the observe-only version in ADDED
("Retry banner in chat view is observe-only"). pi owns the retry loop; the banner no longer
offers a "Stop retrying" control (the always-present session Stop is the sole abort entry
point), so the "Stop retrying aborts the session" scenario is dropped.

## ADDED Requirements

### Requirement: Retry banner in chat view is observe-only

The dashboard SHALL surface retries via the unified `SessionBanner` component (see capability
`session-status-banner`) whenever `SessionState.retryState` is set, covering both the waiting
and in-flight sub-states.

The surface SHALL display:

- **Attempt phrasing.** The attempt number SHALL be rendered bare ("attempt 7"). The surface
  SHALL NEVER render "of N": `maxRetries` is user-configurable and typically large, so a
  denominator is noise rather than information.
- **Countdown.** When `nextAttemptAt` is known the surface SHALL render a live countdown to it,
  refreshed at least once per second and never below 0. When only `delayMs > 0` is known the
  surface SHALL render a countdown to `startedAt + delayMs`, and SHALL switch to
  "still waiting… (N s elapsed)" once that instant has passed while the retry is still pending.
  When `delayMs` is 0 the surface SHALL render elapsed-only.
- The originating `reason` string.

The surface SHALL NOT render a "Stop retrying" control. Ending pi's retry chain is done through
the always-present session Stop, not through the banner.

#### Scenario: Waiting state shows an exact countdown

- **WHEN** `retryState = { attempt: 7, maxAttempts: 100, delayMs: 60000, nextAttemptAt: <now + 42s>, waiting: true, reason: "overloaded", startedAt: <now> }`
- **THEN** the surface SHALL show a countdown of 42 s decreasing at least once per second
- **AND** the surface SHALL show "attempt 7" without "of"

#### Scenario: Overrun countdown degrades to elapsed

- **GIVEN** a `waiting: true` record whose countdown target has passed
- **WHEN** the retry is still pending
- **THEN** the surface SHALL render "still waiting… (N s elapsed)" instead of a zeroed countdown

#### Scenario: Zero delay renders elapsed-only

- **WHEN** `retryState.delayMs` is 0 and `nextAttemptAt` is absent
- **THEN** the surface SHALL render an elapsed-only waiting line with no countdown

#### Scenario: No Stop retrying control in the banner

- **GIVEN** the surface carries any `retryState`
- **THEN** the banner SHALL NOT render a "Stop retrying" control

#### Scenario: Surface persists across attempts

- **GIVEN** the surface is rendering a waiting retry for attempt 3
- **WHEN** attempt 4 starts and then fails
- **THEN** the surface SHALL remain visible throughout
- **AND** the attempt counter SHALL advance rather than resetting
