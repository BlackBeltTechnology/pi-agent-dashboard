## ADDED Requirements

### Requirement: Composer mounts a session-action strip above the textarea
The chat view's composer (`CommandInput`) SHALL render a `ComposerSessionActions` strip between the existing model/level row and the textarea, when and only when the chat view is bound to a session (i.e. a session is selected and its details have loaded).

The strip SHALL render four logical groups, each separated by a vertical divider:

1. **Strip header** — gradient dot + label `session actions · <session-name>` + refresh button.
2. **OpenSpec group** — compact 7-node stepper (variant `compact` per the openspec-attach-combo capability) followed by the same action buttons that render inside the sidebar card's OPENSPEC subcard (`Explore`, `Apply` / `Continue` / `FF` / `Verify` by state, `Tasks N/M`, `Archive`, overflow `⋯`).
3. **Git group** — same actions as the sidebar card's GIT subcard (`Push`, `Open PR` / `View PR`, `Merge`, `Close`). The git group SHALL render only when its predicate is true (same predicate the GIT subcard uses).
4. **JJ group** — same actions as the sidebar card's JJ subcard, sourced from the `workspace-action-bar` slot, prefixed by the `jj:<workspace>` pill from the `session-card-badge` slot's jj claim. The jj group SHALL render only when its predicate is true (same predicate the JJ subcard uses).

The strip SHALL apply identical action gating to the sidebar card: `Explore` enabled only when `!attachedProposal`; `Archive` enabled only when `attachedProposal`; all actions disabled when `status === "streaming"`; the OpenSpec group hidden entirely when `OpenSpecData.hasOpenspecDir === false && pending === false`.

The strip SHALL share the `onSendPrompt`, `onAttachProposal`, `onDetachProposal`, `onReadArtifact`, and `onBulkArchive` callbacks with the sidebar surface. Firing an action from the strip SHALL produce the same effect as firing the equivalent action from the sidebar card; both surfaces SHALL stay in sync without additional state plumbing.

#### Scenario: Strip renders with attached implementing change
- **WHEN** the chat view is bound to session `"s1"` with `attachedProposal = "add-auth"` and `deriveChangeState` returns `IMPLEMENTING`
- **THEN** the composer SHALL render a `ComposerSessionActions` strip element between the model/level row and the textarea
- **AND** the strip SHALL contain a compact stepper with the correct node states (`Specs` done, `Tasks` current with `4/12`)
- **AND** the strip SHALL contain a disabled `Explore` button and an enabled `Archive` button (gating matches the sidebar)

#### Scenario: Strip hidden when no session selected
- **WHEN** the chat view has no session selected (e.g. on an empty initial view)
- **THEN** the composer SHALL NOT render the `ComposerSessionActions` strip
- **AND** the model/level row and textarea SHALL render in their existing layout

#### Scenario: OpenSpec group hidden when cwd is not OpenSpec-applicable
- **WHEN** the chat view is bound to a session whose cwd has `OpenSpecData.hasOpenspecDir === false && pending === false`
- **THEN** the strip SHALL render with the strip header and any active VCS groups
- **AND** the strip SHALL NOT render the OpenSpec stepper or OpenSpec action buttons

#### Scenario: Git and JJ groups follow sidecard predicates
- **WHEN** the chat view is bound to a session in a colocated git+jj repo
- **THEN** the strip SHALL render both the Git group and the JJ group, in that order

#### Scenario: Pure-git repo strip shows only Git group
- **WHEN** the chat view is bound to a session in a pure-git repo (no jj plugin claims)
- **THEN** the strip SHALL render the Git group
- **AND** the strip SHALL NOT render the JJ group

#### Scenario: Firing Apply from strip dispatches the skill prompt
- **WHEN** the user clicks the `Apply` button inside the composer strip for session `"s1"` with attached change `"add-auth"`
- **THEN** the strip SHALL invoke `onSendPrompt` with the same prompt the sidebar card's Apply button would send (`/skill:openspec-apply-change add-auth`)
- **AND** the session card's OPENSPEC subcard SHALL reflect the same `streaming` state without additional state propagation

#### Scenario: Streaming session disables all strip actions
- **WHEN** the chat view is bound to a session with `status = "streaming"`
- **THEN** every action button inside the strip SHALL render in a disabled state
- **AND** the refresh button SHALL remain enabled (refresh is a read-only action)

#### Scenario: Strip refresh re-fetches OpenSpec data
- **WHEN** the user clicks the refresh button inside the strip header
- **THEN** the system SHALL re-fetch the cwd's OpenSpec data
- **AND** the stepper and action gating SHALL re-render with the fresh data
