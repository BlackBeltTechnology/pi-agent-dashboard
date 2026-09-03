# session-card-status delta

## ADDED Requirements

### Requirement: Session card surfaces the in-flight retry attempt

A session card SHALL display the current retry attempt number while a retry is
in flight for that session, so a retrying session is distinguishable from one
that errored and gave up.

The indicator SHALL be rendered as a branch of the card's existing activity
indicator — the same slot that otherwise prints the resuming, needs-you,
current-tool, thinking or idle label — and SHALL NOT introduce a separate
affordance competing with it on the same row.

Within that chain, the retry branch SHALL rank below the needs-you branch and
above the current-tool, streaming and idle branches. A session in a retry
backoff is not executing a tool, so the current-tool and thinking labels SHALL
NOT be shown in preference to it.

The retry set SHALL include a session whenever `retryState` is set, regardless
of whether `lastError` is also set. A provider retry normally carries both, so
gating on the absence of `lastError` would exclude the common case.

The attempt number SHALL be delivered to the card as a number, not inferred from
a boolean.

#### Scenario: Retrying with an error surfaced
- **GIVEN** a session whose state has both `retryState` (attempt 3) and `lastError` set
- **THEN** the session SHALL be a member of the retry set
- **AND** its card's activity indicator SHALL read `Retry 3`

#### Scenario: Retrying with no error surfaced
- **GIVEN** a session whose state has `retryState` (attempt 2) and no `lastError`
- **THEN** its card's activity indicator SHALL read `Retry 2`

#### Scenario: Retry outranks the streaming label
- **GIVEN** a session with `status: "streaming"` and `retryState` set at attempt 2
- **THEN** the activity indicator SHALL read `Retry 2`
- **AND** SHALL NOT read the thinking label

#### Scenario: Retry outranks the current-tool label
- **GIVEN** a session with a `currentTool` set and `retryState` set at attempt 2
- **THEN** the activity indicator SHALL read `Retry 2`
- **AND** SHALL NOT read the tool name

#### Scenario: Needs-you outranks retry
- **GIVEN** a session awaiting input via `ask_user` with no widget-bar prompt
- **AND** `retryState` set at attempt 2
- **THEN** the activity indicator SHALL read the needs-you label

#### Scenario: Errored, not retrying
- **GIVEN** a session with `lastError` set and `retryState` undefined
- **THEN** the activity indicator SHALL NOT show any retry label
- **AND** it SHALL fall through to its existing branch for that session state

#### Scenario: Ended sessions show no retry label
- **GIVEN** a session with `status: "ended"`
- **THEN** the activity indicator SHALL render nothing, as it does today

#### Scenario: Retry label is additive — existing status channels are unchanged
- **GIVEN** a session with both `retryState` and `lastError` set
- **THEN** the card's status dot SHALL use the error color
- **AND** the status shape marker SHALL be the error shape
- **AND** the mosaic rail SHALL use the error tint
- **AND** the folder status capsule SHALL bucket the session as `error`

#### Scenario: Retry label meets the contrast floor
- **WHEN** the retry label is rendered in any supported theme in either light or dark mode
- **THEN** its foreground against the card surface SHALL clear a 3:1 contrast ratio
- **AND** its color SHALL derive from `--severity-warning-fg` rather than a raw status or palette token

#### Scenario: Retry label survives reduced motion and greyscale
- **GIVEN** the user has `prefers-reduced-motion: reduce` set
- **THEN** the retry label and its attempt number SHALL remain legible
- **AND** no animation SHALL run on it
- **AND** the attempt number SHALL be conveyed by text, not by color alone
