## MODIFIED Requirements

### Requirement: Trailing control states its own action

The surface's trailing control SHALL be present in every visible state, and its icon, accessible label, and test id SHALL identify the action it performs. A control that does not close the surface SHALL NOT be rendered as a close affordance.

| Phase | Icon | Label | Test id | Effect |
|---|---|---|---|---|
| retry pending, expanded | `mdiChevronUp` | Collapse | `error-banner-collapse` | collapse to the compact row |
| retry pending, collapsed | `mdiChevronDown` | Show error | `error-banner-expand` | restore the full card |
| settled provider error | `mdiClose` | Dismiss | `error-banner-dismiss` | clear the settled error surface |

While a retry is pending the trailing control SHALL collapse the surface using component-local state. It SHALL NOT invoke the dismiss callback or mutate retry/error state. The surface SHALL clear automatically when a resumed attempt produces a confirmed non-error assistant completion.

Once retrying stops with a provider error, the surface SHALL re-expand, render Retry plus the trailing dismiss X, and retain Copy. Retry SHALL disable after its first activation and remain disabled until error/retry lifecycle state changes, preventing duplicate turn requests. When the user aborts an active retry chain or the session is confirmed terminated, the entire surface SHALL hide; no X-only post-abort or post-termination card SHALL remain. Every terminal state SHALL therefore be either dismissible (provider error) or hidden (success/abort/termination); the component SHALL NOT render a terminal banner with only a retry-phase control or no closing path.

#### Scenario: Collapse control while retry is waiting

- **GIVEN** a retry sub-status is waiting
- **THEN** the surface SHALL render `error-banner-collapse`
- **AND** it SHALL not render `error-banner-dismiss` or Retry

#### Scenario: Collapse control while retry attempt is in flight

- **GIVEN** a retry sub-status is in flight
- **THEN** the surface SHALL render `error-banner-collapse`
- **AND** it SHALL not render `error-banner-dismiss` or Retry

#### Scenario: Collapsing does not change lifecycle state

- **GIVEN** a retry is pending
- **WHEN** the user activates Collapse
- **THEN** no dismiss, abort, Retry, or stop command SHALL be dispatched
- **AND** the attempt status SHALL remain available in the compact row

#### Scenario: Settled provider error shows Retry and X

- **GIVEN** `lastError` is set and no retry sub-status is active
- **THEN** the expanded surface SHALL render Retry, Copy, and `error-banner-dismiss`
- **AND** the trailing icon SHALL be `mdiClose`

#### Scenario: Successful automatic continuation removes the surface

- **GIVEN** the surface is visible for a pending retry
- **WHEN** the resumed attempt produces a confirmed non-error assistant completion
- **THEN** the surface SHALL become hidden without user action

#### Scenario: User abort removes the surface

- **GIVEN** the surface is visible for a pending retry
- **WHEN** the user activates the session Stop control
- **THEN** the surface SHALL become hidden
- **AND** it SHALL not reappear as a settled or X-only card for the cancelled chain

#### Scenario: Confirmed session termination removes the surface

- **GIVEN** the surface is visible for retry or error state
- **WHEN** the session is confirmed removed after clean shutdown or process kill
- **THEN** the surface SHALL become hidden
- **AND** no X-only post-termination card SHALL remain

#### Scenario: Terminal provider error cannot remain stuck in retry presentation

- **GIVEN** the surface was expanded or collapsed while retrying
- **WHEN** retrying stops and the provider error remains
- **THEN** the surface SHALL re-expand with Retry, Copy, and `error-banner-dismiss`
- **AND** no collapse-only terminal presentation SHALL remain

### Requirement: Banner is observe-only: no abort control

The banner SHALL NOT render a session-abort control. The always-present session Stop outside the banner is the sole abort entry point and ends pi's retry chain. A trailing state-clearing dismiss SHALL be offered only for a settled provider error. While a retry is active, the trailing control SHALL be view-only Collapse/Expand.

A settled provider error SHALL offer a one-shot Retry action through the supplied retry callback. Retry SHALL continue the session without replaying input. The banner SHALL hide after confirmed recovery or user abort.

#### Scenario: Pending retry uses external session Stop

- **GIVEN** the surface carries a retry sub-status
- **THEN** the banner SHALL not render an abort or Stop retrying control
- **AND** the external session Stop SHALL remain available

#### Scenario: Settled error actions are Retry, Copy, and Dismiss

- **GIVEN** `lastError` is set and no retry sub-status is active
- **THEN** the banner SHALL render Retry and Copy actions
- **AND** it SHALL render the state-clearing dismiss X
- **AND** no abort command SHALL be dispatched by Dismiss

#### Scenario: Missing retry callback omits Retry only

- **GIVEN** a settled provider error is rendered without a retry callback
- **THEN** Retry SHALL be absent
- **AND** Copy and the dismiss X SHALL remain available
