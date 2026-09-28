## MODIFIED Requirements

### Requirement: `composer-context-group` slot renders inside the composer context strip

The dashboard SHALL expose a `composer-context-group` slot (multiplicity `many`, payload tier `react-only`, claim `{ component }`) whose contributions render inside the chat view's composer context strip after the Git group and before the Status group, ordered by priority then plugin id. Slot components SHALL receive `{ session, pluginContext }` context props. Contributions SHALL NOT be disabled or dimmed while the session is streaming.

The runtime SHALL export a `ComposerContextGroup` primitive taking `{ label, children, testId? }`. It SHALL render the same group container the strip uses for its own host groups:
- one container with `role="group"` and an accessible name equal to `label`;
- the label as a leading segment, and the children inside the container.

By default the primitive SHALL render the **read-only** appearance (dashed outline, no fill, no group-level hover affordance), which marks the group as status rather than actions. Interactive children SHALL keep their own affordances. When `testId` is given, the container SHALL carry it and the label SHALL carry `<testId>-label`, as before. The primitive's API SHALL stay unchanged, so existing claimants need no code change. The label SHALL never be separated from the start of its content when the strip wraps, and long read-only content SHALL wrap inside its container rather than overflow the strip.

Claims MAY carry a `shouldRender` predicate that receives the session, as for other session-scoped slots. A contribution that renders nothing SHALL leave no container or label behind. With no claim, the strip SHALL render no extra group.

#### Scenario: Claim renders between Git and Status with session props

- **WHEN** a plugin claims `{ slot: "composer-context-group", component: "X" }` and the chat view is bound to a session
- **THEN** `X` SHALL render in the context strip after the Git group and before the Status group
- **AND** `X` SHALL receive the bound session in its context props

#### Scenario: Primitive renders the shared group container

- **WHEN** a contribution renders `ComposerContextGroup` with label `Quota`
- **THEN** the output SHALL be one element with `role="group"` and accessible name `Quota`
- **AND** it SHALL use the strip's read-only group appearance

#### Scenario: Existing test ids survive

- **WHEN** a contribution renders `ComposerContextGroup` with `testId = "quota-context-group"`
- **THEN** the container SHALL carry `quota-context-group` and the label SHALL carry `quota-context-group-label`

#### Scenario: Group primitive keeps label and content together when the strip wraps

- **WHEN** a contribution renders `ComposerContextGroup` with label `Quota` and the strip's available width forces wrapping
- **THEN** the `QUOTA` label SHALL land on the same line as the start of its content, never orphaned at the end of the previous line
- **AND** no part of the group SHALL overflow the strip horizontally

#### Scenario: Streaming does not gate the contribution

- **WHEN** the bound session has `status = "streaming"`
- **THEN** the contribution SHALL render at full opacity and its interactive children SHALL remain enabled

#### Scenario: Empty contribution leaves no trace

- **WHEN** the claimed component returns nothing
- **THEN** no container or label SHALL render for that claim

#### Scenario: Contribution shows even when no host group does

- **WHEN** a plugin claims `composer-context-group` and the bound session has no OpenSpec directory, no worktree and no `session-card-badge` claim
- **THEN** the strip SHALL still render and show the contribution

#### Scenario: No claim leaves the strip unchanged

- **WHEN** no plugin claims `composer-context-group`
- **THEN** no extra group container or label SHALL render in the strip
