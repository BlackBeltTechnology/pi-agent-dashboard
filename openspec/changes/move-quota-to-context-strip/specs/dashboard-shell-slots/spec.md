## ADDED Requirements

### Requirement: `composer-context-group` slot renders inside the composer context strip

The dashboard SHALL expose a `composer-context-group` slot (multiplicity `many`, payload tier `react-only`, claim `{ component }`) whose contributions render inside the chat view's composer context strip after the Git group and before the Status group, ordered by priority then plugin id. Slot components SHALL receive `{ session, pluginContext }` context props. Contributions SHALL NOT be disabled or dimmed while the session is streaming. The runtime SHALL export a `ComposerContextGroup` primitive taking `{ label, children, testId? }` that renders a divider, the uppercase label and the children as one non-shrinking unit, visually matching the strip's own groups. Claims MAY carry a `shouldRender` predicate that receives the session, as for other session-scoped slots. A contribution that renders nothing SHALL leave no divider or label behind. With no claim, the strip SHALL render exactly as before.

#### Scenario: Claim renders between Git and Status with session props

- **WHEN** a plugin claims `{ slot: "composer-context-group", component: "X" }` and the chat view is bound to a session
- **THEN** `X` SHALL render in the context strip after the Git group and before the Status group
- **AND** `X` SHALL receive the bound session in its context props

#### Scenario: Group primitive keeps label and content together when the strip wraps

- **WHEN** a contribution renders `ComposerContextGroup` with label `Quota` and the strip's available width forces wrapping
- **THEN** the `QUOTA` label SHALL land on the same line as the start of its content, never orphaned at the end of the previous line

#### Scenario: Streaming does not gate the contribution

- **WHEN** the bound session has `status = "streaming"`
- **THEN** the contribution SHALL render at full opacity and its interactive children SHALL remain enabled

#### Scenario: Empty contribution leaves no trace

- **WHEN** the claimed component returns nothing
- **THEN** no divider or label SHALL render for that claim

#### Scenario: Contribution shows even when no host group does

- **WHEN** a plugin claims `composer-context-group` and the bound session has no OpenSpec directory, no worktree and no `session-card-badge` claim
- **THEN** the strip SHALL still render and show the contribution

#### Scenario: No claim leaves the strip unchanged

- **WHEN** no plugin claims `composer-context-group`
- **THEN** no extra divider or label SHALL render in the strip

## MODIFIED Requirements

### Requirement: Slot taxonomy is a frozen, named list

The dashboard SHALL expose a fixed set of named slots, defined as a TypeScript union in `@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-types.ts`. Each slot SHALL have a stable string id and a typed payload contract. Slot ids SHALL NOT be renamed or removed within a major version.

The slot taxonomy SHALL include at minimum:

```ts
type SlotId =
  // first-party React-targeted slots
  | "sidebar-folder-section"
  | "session-card-badge"
  | "session-card-action-bar"
  | "session-card-flows"
  | "session-card-memory"
  | "workspace-action-bar"
  | "composer-context-group"
  | "content-view"
  | "content-header-sticky"
  | "content-inline-footer"
  | "anchored-popover"
  | "command-route"
  | "settings-section"
  | "tool-renderer"
  // descriptor-renderable slots (shared with extension-ui-system)
  | "management-modal"
  | "footer-segment"
  | "agent-metric"
  | "breadcrumb"
  | "gate"
  | "toast"
  | "rjsf-form";
```

Each slot id SHALL be associated with a payload type and a `multiplicity` (`one` | `many` | `one-active`).

#### Scenario: Slot id is referenced via type import

- **WHEN** a plugin or shell component declares a claim on a slot
- **THEN** the slot id SHALL be passed as a typed `SlotId` value, not as a free string, so renames produce TypeScript errors.

#### Scenario: Adding a new slot is a minor version bump

- **WHEN** a new slot id is added to the union
- **THEN** the change SHALL be a minor (non-breaking) version of `pi-dashboard-shared`, since existing plugins that don't reference the new slot are unaffected.

#### Scenario: Removing a slot is a major version bump

- **WHEN** a slot id is removed
- **THEN** the change SHALL be a major version, and plugins claiming that slot fail to load with an explicit error.
