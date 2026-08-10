# chat-view Specification (delta)

## ADDED Requirements

### Requirement: Notify visibility SHALL be applied at both virtualization gate sites

The chat view derives `displayRows` by filtering grouped messages through
`isRowVisible`, and the virtualizer's `count` is `displayRows.length`; a separate
render branch then produces each row's element. The `notifyMinLevel` gate SHALL
be applied at BOTH sites, using the same shared predicate, so the two never
disagree.

The two sites are not symmetric. Gating only the render branch is a defect even
though the row appears to disappear: `count` still counts a row that renders
`null`, drifting measurement and clipping the transcript tail. Gating only
`isRowVisible` is functionally sufficient on its own — a filtered row is neither
counted nor mounted — so the render-branch gate is defensive, matching the
established `rawEvent` precedent in the same file.

Because of that asymmetry, the row-count invariant SHALL NOT be treated as
coverage of both sites: it is satisfied when either site alone is gated. The
render-branch site SHALL be pinned by a direct assertion that a sub-floor notify
contributes no rendered element and no measured height.

The gate SHALL be display-only. A hidden notify SHALL remain in session state so
that lowering the floor re-reveals it without a reload or refetch.

#### Scenario: Row count matches rendered rows
- **GIVEN** a transcript containing notify rows at each of `info`, `success`, `warning` and `error`
- **WHEN** the chat view renders at `notifyMinLevel = "warnings"`
- **THEN** the number of rows the virtualizer counts SHALL equal the number of rows that render a non-null element
- **AND** no blank measured gap SHALL appear where a hidden notify was

#### Scenario: Render branch independently drops a sub-floor notify
- **GIVEN** `notifyMinLevel = "errors"`
- **WHEN** the render branch is evaluated for an `info`-level notify row
- **THEN** it SHALL produce no element
- **AND** no measured height SHALL be reserved for that row
- **AND** this SHALL hold independently of whether `isRowVisible` already filtered it

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
