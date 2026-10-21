## MODIFIED Requirements

### Requirement: `composer-context-group` slot renders inside the composer context strip

The dashboard SHALL expose a `composer-context-group` slot (multiplicity `many`, payload tier `react-only`, claim `{ component }`) whose contributions render inside the composer dock's Context lane (the successor of the composer context strip, see `composer-dock`), before the Status group, ordered by priority then plugin id. Slot components SHALL receive `{ session, pluginContext }` context props. Contributions SHALL NOT be disabled or dimmed while the session is streaming.

The runtime SHALL export a `ComposerContextGroup` primitive taking `{ label, children, testId? }`. It SHALL render the same group container the dock uses for its own context groups:
- one container with `role="group"` and an accessible name equal to `label`;
- the label as a leading segment, and the children inside the container.

By default the primitive SHALL render the **read-only** appearance (dashed outline, no fill, no group-level hover affordance), which marks the group as status rather than actions. Interactive children SHALL keep their own affordances. When `testId` is given, the container SHALL carry it and the label SHALL carry `<testId>-label`, as before. The primitive's API SHALL stay unchanged, so existing claimants need no code change. The label SHALL never be separated from the start of its content when the Context lane wraps, and long read-only content SHALL wrap inside its container rather than overflow the dock.

Claims MAY carry a `shouldRender` predicate that receives the session, as for other session-scoped slots. A contribution that renders nothing SHALL leave no container or label behind. With no claim, the Context lane SHALL render no extra group.

#### Scenario: Claim renders between Git and Status with session props

- **WHEN** a plugin claims `{ slot: "composer-context-group", component: "X" }` and the chat view is bound to a session
- **THEN** `X` SHALL render in the dock's Context lane: after the Changes lane that holds the Git group, and before the Status group
- **AND** `X` SHALL receive the bound session in its context props

#### Scenario: Primitive renders the shared group container

- **WHEN** a contribution renders `ComposerContextGroup` with label `Quota`
- **THEN** the output SHALL be one element with `role="group"` and accessible name `Quota`
- **AND** it SHALL use the read-only group appearance

#### Scenario: Existing test ids survive

- **WHEN** a contribution renders `ComposerContextGroup` with `testId = "quota-context-group"`
- **THEN** the container SHALL carry `quota-context-group` and the label SHALL carry `quota-context-group-label`

#### Scenario: Group primitive keeps label and content together when the strip wraps

- **WHEN** a contribution renders `ComposerContextGroup` with label `Quota` and the Context lane (the strip's successor) is narrow enough to force wrapping
- **THEN** the `QUOTA` label SHALL land on the same line as the start of its content, never orphaned at the end of the previous line
- **AND** no part of the group SHALL overflow the dock horizontally

#### Scenario: Streaming does not gate the contribution

- **WHEN** the bound session has `status = "streaming"`
- **THEN** the contribution SHALL render at full opacity and its interactive children SHALL remain enabled

#### Scenario: Empty contribution leaves no trace

- **WHEN** the claimed component returns nothing
- **THEN** no container or label SHALL render for that claim

#### Scenario: Contribution shows even when no host group does

- **WHEN** a plugin claims `composer-context-group` and the bound session has no OpenSpec directory, no worktree, no changed files, no running work and no `session-card-badge` claim
- **THEN** the dock SHALL still render and its Context lane SHALL show the contribution

#### Scenario: No claim leaves the strip unchanged

- **WHEN** no plugin claims `composer-context-group`
- **THEN** no extra group container or label SHALL render in the Context lane

### Requirement: Slot taxonomy SHALL classify each slot id by predicate input shape

The shared package `@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-types.js` SHALL export a public type `SlotPredicateInput<S extends SlotId>` that maps every `SlotId` to the input shape its registered predicates receive at runtime. The mapping SHALL reflect the actual filter helpers in the plugin runtime:

| Slot category | Slot ids | `SlotPredicateInput<S>` |
|---|---|---|
| Session-scoped | `session-card-badge`, `session-card-action-bar`, `session-card-flows`, `session-card-memory`, `workspace-action-bar`, `content-view`, `content-header-sticky`, `content-inline-footer`, `composer-context-group`, `composer-dock-process-group`, `command-route`, `shell-overlay-route` | `DashboardSession \| null \| undefined` |
| Folder-scoped | `sidebar-folder-section`, `worktree-card-section` | `FolderDescriptor` |
| Predicate-irrelevant | every other `SlotId` (`settings-section`, `tool-renderer`, `anchored-popover`, all descriptor-only slots) | `never` |

The classification SHALL be expressed as a single conditional type. The file SHALL include a compile-time exhaustiveness assertion (analogous to the existing `_AssertAllSlotsCovered` pattern for `SlotPropsMap`) that fails type-checking if any `SlotId` is left unclassified.

The `never` value for predicate-irrelevant slots is documentation-only: under the bivariant method-shorthand contract used by `ClaimEntry`, predicates can still be registered against `never`-input slots without a type error, but the registered function is never invoked at runtime because filter helpers only target session- and folder-scoped slots. Plugins SHOULD NOT rely on `never`-typed slots rejecting predicates at compile time.

#### Scenario: Session-scoped slot maps to DashboardSession input

- **WHEN** type-checking `SlotPredicateInput<"session-card-badge">`
- **THEN** the resolved type SHALL be `DashboardSession | null | undefined`.

#### Scenario: New session-card-flows slot is session-scoped

- **WHEN** type-checking `SlotPredicateInput<"session-card-flows">`
- **THEN** the resolved type SHALL be `DashboardSession | null | undefined`.

#### Scenario: Composer dock process group is session-scoped

- **WHEN** type-checking `SlotPredicateInput<"composer-dock-process-group">`
- **THEN** the resolved type SHALL be `DashboardSession | null | undefined`.

#### Scenario: Folder-scoped slot maps to FolderDescriptor input

- **WHEN** type-checking `SlotPredicateInput<"sidebar-folder-section">`
- **THEN** the resolved type SHALL be `FolderDescriptor`.

#### Scenario: Predicate-irrelevant slot maps to `never`

- **WHEN** type-checking `SlotPredicateInput<"settings-section">`
- **THEN** the resolved type SHALL be `never`.
- **AND** registering a predicate on such a slot SHALL compile (method bivariance) but the predicate SHALL NOT be invoked at runtime.

#### Scenario: Adding a new slot id without classification is a compile error

- **WHEN** a new entry is added to the `SlotId` union but is not assigned a classification in `SlotPredicateInput`
- **THEN** the compile-time exhaustiveness assertion in `slot-types.ts` SHALL fail with a TypeScript error pointing at the unclassified slot.

## ADDED Requirements

### Requirement: `composer-dock-process-group` slot

The dashboard SHALL expose a session-scoped `composer-dock-process-group` slot (multiplicity `many`, payload tier `react-only`, claim `{ component }`) whose contributions render as groups inside the composer dock's Processes lane, before the core Commands and Background groups, ordered by priority then plugin id. Slot components SHALL receive `{ session, pluginContext, mode, reportSummary }`, where `mode` is `"summary"` or `"rows"`.

#### Scenario: Claim renders in the Processes lane
- **WHEN** a plugin claims `{ slot: "composer-dock-process-group", component: "Subagents" }` and the bound session has running subagents
- **THEN** `Subagents` SHALL render inside the expanded Processes lane, before the Commands and Background groups
- **AND** it SHALL receive the bound session and its plugin context

#### Scenario: Declared like every other slot
- **WHEN** the slot registry, the slot props map and the manifest validator are inspected
- **THEN** `composer-dock-process-group` SHALL be declared in all three, and a manifest claiming it SHALL validate

### Requirement: Process group contributions report a summary

In `"summary"` mode a `composer-dock-process-group` component SHALL render nothing and report `reportSummary({ count, noun })`, or `reportSummary(null)` when nothing runs. In `"rows"` mode it SHALL render its rows. The dock SHALL sum reported counts into the lane header and compact chip, render the lane for a positive count, and drop a summary when its component unmounts.

#### Scenario: Summary mode renders no DOM
- **WHEN** the dock mounts a contribution in `"summary"` mode while the Processes lane is collapsed
- **THEN** the contribution SHALL add no element to the document and SHALL still report its count

#### Scenario: Reported count reaches the header
- **WHEN** a contribution reports `{ count: 3, noun: "subagents" }` and the session has no other running work
- **THEN** the Processes lane SHALL render and its header SHALL name 3 subagents

#### Scenario: Null summary hides the group from the header
- **WHEN** the contribution reports `null`
- **THEN** the Processes lane header SHALL NOT name that contribution's noun

#### Scenario: Unmount drops the summary
- **WHEN** the contributing plugin is disabled while its summary reports 3
- **THEN** the Processes lane header SHALL stop counting those 3 rows

### Requirement: Process group rows use the dock row primitive

The runtime SHALL export a `ComposerDockRow` primitive taking `{ icon, title, detail?, meta?, startedAt?, actions? }` that renders one Processes-lane row with the dock's spacing and truncation, and renders the elapsed time since `startedAt` itself. The primitive SHALL give every action a target of at least 24×24 CSS px (44×44 at phone width) without help from the contribution. Contributions SHALL render their rows with it; a row's elapsed time SHALL NOT be inside a live region.

#### Scenario: Plugin row matches core rows
- **WHEN** a contribution renders a row through `ComposerDockRow` beside a core background-process row
- **THEN** both rows SHALL share the same height, icon size, truncation and action target sizes

#### Scenario: Phone-width plugin row targets
- **WHEN** a contribution passes a 16 px icon button as a row action and the dock renders at a 375 px viewport
- **THEN** that action's target SHALL measure at least 44×44 CSS px

#### Scenario: Plugin elapsed time is silent
- **WHEN** a contributed row's elapsed time advances
- **THEN** no live region SHALL change its content
