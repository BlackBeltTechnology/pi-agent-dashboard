## MODIFIED Requirements

### Requirement: Chat view indicates an unfinished replay

The chat view SHALL render an indeterminate in-flight indicator while the
selected session's replay-in-flight flag is set, so a partially replayed session
is never presented as complete. The indicator SHALL be anchored to the bottom of
the message list, visually where the not-yet-delivered events will land, and
SHALL overlay rather than occupy list space so it cannot displace or reflow the
rendered messages. The indicator SHALL NOT express a count, a total, or a
percentage. The indicator and the history-loading skeleton SHALL NOT render at
the same time.

The indicator SHALL NOT occlude, overlap, or otherwise obstruct any other
interactive control rendered in the chat view, at any supported viewport width.
Where the indicator and another overlay control would share a bottom anchor,
their positions SHALL be separated by layout — not left to paint order — and the
indicator SHALL declare a stacking order above the scroll controls so the
resolution is explicit rather than incidental.

The indicator's visual boundary against the transcript background SHALL meet a
contrast ratio of at least 3:1, in both the dark and light themes, satisfying
WCAG 2.1 SC 1.4.11 Non-text Contrast. A drop shadow SHALL NOT be relied on as
the sole means of separating the indicator from the transcript, because it
carries no contrast over a near-black background.

The indicator SHALL suppress its animation when the user agent reports
`prefers-reduced-motion: reduce`. The indicator SHALL remain visible in that
state, so the status is conveyed without motion.

The indicator SHALL carry `data-testid="replay-in-flight-pill"`, `role="status"`,
and `aria-busy="true"`, mirroring the history-loading skeleton's contract. Its
accessible name SHALL be derived from its visible text content; a redundant
`aria-label` duplicating that text SHALL NOT be set.

#### Scenario: Indicator exposes a stable test and accessibility handle

- **GIVEN** the in-flight indicator is rendered
- **WHEN** the chat view is queried
- **THEN** the indicator SHALL be reachable by `data-testid="replay-in-flight-pill"`
- **AND** it SHALL expose `role="status"`, `aria-busy="true"`, and a non-empty accessible name.

#### Scenario: Indicator never obstructs the scroll-to-bottom control

- **GIVEN** a session whose replay-in-flight flag is set and whose scroll-to-bottom control is rendered
- **WHEN** the chat view is rendered at a narrow viewport width of 375 CSS pixels
- **THEN** the indicator's bounding box SHALL NOT intersect the scroll-to-bottom control's bounding box
- **AND** the scroll-to-bottom control SHALL remain clickable for the whole time the indicator is showing.

#### Scenario: Indicator boundary is perceivable in both themes

- **GIVEN** the in-flight indicator is rendered over the message transcript
- **WHEN** its background and border are measured against the transcript background
- **THEN** the contrast ratio SHALL be at least 3:1 in the dark theme
- **AND** the contrast ratio SHALL be at least 3:1 in the light theme.

#### Scenario: Indicator honours reduced motion

- **GIVEN** the user agent reports `prefers-reduced-motion: reduce`
- **WHEN** the in-flight indicator is rendered
- **THEN** the indicator SHALL NOT animate
- **AND** the indicator SHALL still be rendered and still expose `role="status"` and `aria-busy="true"`.

#### Scenario: Indicator shows between the first and last batch

- **GIVEN** a session whose first `event_replay` batch has been rendered and whose replay-in-flight flag is set
- **WHEN** the chat view renders
- **THEN** the chat view SHALL render the in-flight indicator at the end of the message list.

#### Scenario: Indicator disappears on replay completion

- **GIVEN** the in-flight indicator is showing for a session
- **WHEN** the terminal `event_replay { isLast: true }` is received
- **THEN** the chat view SHALL stop rendering the in-flight indicator.

#### Scenario: Indicator is independent of the empty-session placeholder

- **GIVEN** a session with no persisted history
- **WHEN** the only `event_replay` received is `{ events: [], isLast: true }`
- **THEN** the chat view SHALL render "No messages yet"
- **AND** the chat view SHALL NOT render the in-flight indicator.

#### Scenario: Indicator does not double up with the loading skeleton

- **GIVEN** a cold session whose replay-in-flight flag is set, whose history-loading flag is still set, and whose message list is still empty
- **WHEN** the delay threshold elapses before the first content batch arrives
- **THEN** the chat view SHALL render the history-loading skeleton
- **AND** the chat view SHALL NOT render the in-flight indicator
- **AND** once the first content batch renders, the skeleton SHALL be replaced by the in-flight indicator.
