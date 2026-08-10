# chat-view Specification (delta)

## ADDED Requirements

### Requirement: Notify visibility SHALL be applied at both virtualization gate sites

The chat view derives `displayRows` by filtering grouped messages through
`isRowVisible`, and the virtualizer's `count` is `displayRows.length`; a separate
render branch then produces each row's element. The `notifyMinLevel` gate SHALL
be applied at BOTH sites, using the same shared predicate, so the two never
disagree.

Applying it at only one site is a defect even though the row appears to
disappear: gating only `isRowVisible` leaves a counted row whose branch returns
an element that is never reached, and gating only the render branch leaves
`count` counting rows that render `null`, drifting measurement and clipping the
transcript tail.

The gate SHALL be display-only. A hidden notify SHALL remain in session state so
that lowering the floor re-reveals it without a reload or refetch.

#### Scenario: Row count matches rendered rows
- **GIVEN** a transcript containing notify rows at each of `info`, `success`, `warning` and `error`
- **WHEN** the chat view renders at `notifyMinLevel = "warnings"`
- **THEN** the number of rows the virtualizer counts SHALL equal the number of rows that render a non-null element
- **AND** no blank measured gap SHALL appear where a hidden notify was

#### Scenario: Raising and lowering the floor is reversible without reload
- **GIVEN** a transcript whose `info`-level notifies are hidden at `notifyMinLevel = "errors"`
- **WHEN** the user changes the preference to `"all"`
- **THEN** the previously hidden notify rows SHALL render again in their original positions
- **AND** no session reload or history refetch SHALL be required

#### Scenario: Per-session override applies without touching global
- **GIVEN** global `notifyMinLevel = "all"`
- **WHEN** the user sets `"errors"` from the chat View popover for one session
- **THEN** only that session's transcript SHALL hide sub-error notifies
- **AND** the popover SHALL show its modified marker for the session
