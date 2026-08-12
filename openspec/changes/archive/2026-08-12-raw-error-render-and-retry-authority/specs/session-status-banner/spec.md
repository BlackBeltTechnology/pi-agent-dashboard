# session-status-banner delta

## MODIFIED Requirements

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
  text (or `retryState.reason`); the same card shows the waiting sub-line — a spinner plus the
  attempt number and a countdown or elapsed suffix — plus Copy. The surface renders no Stop.
- **retry in flight** (one card): `retryState` set with `waiting: false`. As above with the
  animated indicator; the spinner carries the in-flight signal and the suffix is omitted.
- **retry collapsed** (one compact row): the user collapsed the surface while a retry is
  pending. Shows the spinner and attempt status only, plus a control to re-expand.
- **error only** (one card, settled): `lastError` set, `retryState` undefined. Shows message +
  Copy + state-clearing dismiss.
- **hidden**: neither field set → nothing rendered.

A collapsed one-line row SHALL exist ONLY while a retry is pending, and SHALL be entered only
by explicit user action. It is component-local view state; see *Trailing control states its own
action*.

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
- **AND** the card SHALL NOT render a Stop retrying control

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

## REMOVED Requirements

### Requirement: Banner is observe-only: no abort control, no collapse

**Reason.** Renamed and narrowed. The blanket "no collapse" prohibition is superseded: a
collapsed row is now the mechanism that keeps `retryState` — and therefore the session abort
control — alive while a retry runs. The no-abort-control rule itself is unchanged.

**Migration.** Replaced by *Banner is observe-only: no abort control*, which keeps every
scenario except the clause asserting that no collapse control renders while retrying.

### Requirement: Dismiss control is always present and clear-only

**Reason.** Two problems. (1) The handler cleared `retryState`, which `CommandInput` derives
`isWorking` from, so dismissing during a retry unmounted the session abort control and left an
invisible, unstoppable loop. (2) While retrying an ✕ does not meaningfully close anything — the
next attempt re-opens the surface — so the icon promised an outcome it did not deliver.

**Migration.** Replaced by *Trailing control states its own action*, which keeps the control
present in every state and keeps it non-aborting, but makes its icon, label and test id match
the actual effect: collapse while retrying, dismiss once settled.

## ADDED Requirements

### Requirement: Banner is observe-only: no abort control

The banner SHALL NOT render any session-abort control. The always-present session Stop (outside
the banner) is the sole abort entry point, and it ends pi's retry chain. There SHALL be NO
"Stop retrying" control in the banner.

A trailing control SHALL be present in every visible state, but WHICH control is offered depends
on whether a retry is pending — see *Trailing control states its own action*. A state-clearing
dismiss (`error-banner-dismiss`, `mdiClose`, invoking the clear-only `onDismiss`) SHALL be
offered ONLY when no retry is pending (`retryState` undefined). While a retry IS pending the
trailing control collapses the surface instead; collapse is view-only and SHALL NOT invoke
`onDismiss`, write `SessionState`, or influence the retry loop. The surface ALSO clears via its
own lifecycle: when `retryState` clears and `lastError` clears (a confirmed-good resume).

An earlier revision withheld the dismiss control during a retry while ALSO removing the collapse
pill, leaving the surface with NEITHER affordance. The fix is the phase-appropriate control above
— collapse while retrying, dismiss once settled — NOT a dismiss in every state: a dismiss that
clears `retryState` unmounts the session Stop and strands the user in a retry they can neither
see nor stop.

The settled surface SHALL NOT render a Retry control. The removed `findLastUserPrompt` →
`send_prompt` re-send SHALL NOT return, and no replacement re-drive SHALL be introduced: the
dashboard has no mechanism to re-run a settled turn without appending input.

#### Scenario: No abort control in the banner while retrying

- **GIVEN** the surface carries a `retry` sub-status
- **THEN** the banner SHALL NOT render a Stop retrying control
- **AND** the banner SHALL render the retry status sub-line, Copy, and a collapse control

#### Scenario: Session Stop ends a pending retry

- **GIVEN** a retry is pending
- **WHEN** the user activates the always-present session Stop (outside the banner)
- **THEN** pi's retry chain SHALL be ended

#### Scenario: Settled error offers a state-clearing dismiss

- **GIVEN** `lastError` is set AND `retryState` is undefined
- **WHEN** the user activates the dismiss control
- **THEN** `onDismiss` SHALL fire, clearing `lastError`
- **AND** NO `abort` message SHALL be dispatched

### Requirement: Trailing control states its own action

The surface's trailing control SHALL be present in every visible state, and its icon, accessible
label and test id SHALL identify the action it actually performs. A control that does not close
the surface SHALL NOT be rendered as a close (✕) affordance.

| Phase | Icon | Label | Test id | Effect |
|---|---|---|---|---|
| retry pending, expanded | `mdiChevronUp` | Collapse | `error-banner-collapse` | collapse to the compact row |
| retry pending, collapsed | `mdiChevronDown` | Show error | `error-banner-expand` | restore the full card |
| settled (no retry) | `mdiClose` | Dismiss | `error-banner-dismiss` | clear the surface |

While a retry is pending the control SHALL collapse the surface using component-local state. It
SHALL NOT invoke the dismiss callback and SHALL NOT mutate `SessionState` — in particular it
SHALL NOT clear `retryState`, on which the session abort control's visibility depends.

Once retrying stops, the surface SHALL re-expand automatically if it was collapsed, and the
control SHALL become a real dismiss that clears the surface.

The surface SHALL clear itself with no user action on a confirmed-good resume. The banner SHALL
NOT offer any control that purports to stop retrying; the session abort already ends the chain.

#### Scenario: Collapse control while a retry is waiting
- **GIVEN** `retryState` is set with `waiting: true`
- **THEN** the surface SHALL render `error-banner-collapse`
- **AND** it SHALL NOT render `error-banner-dismiss`

#### Scenario: Collapse control while an attempt is in flight
- **GIVEN** `retryState` is set with `waiting: false`
- **THEN** the surface SHALL render `error-banner-collapse`
- **AND** it SHALL NOT render `error-banner-dismiss`

#### Scenario: Collapsing does not clear retry state
- **GIVEN** a retry is pending
- **WHEN** the user activates the collapse control
- **THEN** the dismiss callback SHALL NOT be invoked
- **AND** no abort, cancel or stop command SHALL be dispatched

#### Scenario: Collapsed row keeps the attempt status and can be re-expanded
- **GIVEN** the surface was collapsed while retrying attempt 2
- **THEN** the collapsed row SHALL show the attempt status
- **AND** it SHALL render `error-banner-expand`
- **WHEN** a waiting signal for attempt 3 arrives
- **THEN** the row SHALL remain collapsed
- **AND** the attempt status SHALL read attempt 3

#### Scenario: Dismiss control on a settled error
- **GIVEN** `lastError` is set AND `retryState` is undefined
- **THEN** the surface SHALL render `error-banner-dismiss`
- **AND** it SHALL NOT render `error-banner-collapse`
- **WHEN** the user activates it
- **THEN** the dismiss callback SHALL be invoked

#### Scenario: A collapsed surface re-expands when retrying stops
- **GIVEN** the surface is collapsed while a retry is pending
- **WHEN** `retryState` clears while `lastError` remains
- **THEN** the surface SHALL render expanded
- **AND** it SHALL render `error-banner-dismiss`

#### Scenario: No stop-retrying affordance exists
- **WHEN** the surface is rendered in any state
- **THEN** no control labelled or acting as "stop retrying" SHALL be present

### Requirement: Retry status is a spinner plus a short label

The retry sub-line SHALL lead with an animated spinner (`mdiLoading`) coloured from
`--severity-warning-fg`, followed by a short label.

The label SHALL read `Retry {attempt}` with a countdown or elapsed suffix while waiting, and
`Retry {attempt}` with no suffix while an attempt is in flight — the spinner carries the
in-flight signal. It SHALL NOT spell out "attempt", "next attempt in" or "retrying now".

The attempt number SHALL be conveyed as text, never by motion or colour alone, so the state
survives `prefers-reduced-motion` and greyscale.

#### Scenario: Waiting shows the spinner, attempt and countdown
- **GIVEN** `retryState` is set with `waiting: true` and a `nextAttemptAt` 12 seconds away
- **THEN** the sub-line SHALL render a spinner
- **AND** it SHALL read the attempt number and a 12-second suffix

#### Scenario: In flight shows the spinner and attempt only
- **GIVEN** `retryState` is set with `waiting: false`
- **THEN** the sub-line SHALL render a spinner
- **AND** it SHALL NOT render a countdown suffix

#### Scenario: Attempt number survives without motion
- **GIVEN** the user has `prefers-reduced-motion: reduce` set
- **THEN** the attempt number SHALL remain readable as text
