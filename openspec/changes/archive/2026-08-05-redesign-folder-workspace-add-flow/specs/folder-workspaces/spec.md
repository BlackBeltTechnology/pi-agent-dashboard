## ADDED Requirements

### Requirement: Add-to-workspace affordance

The add-to-workspace gesture SHALL be presented as a labelled pill — an `mdiViewGridPlus` glyph plus the visible
text label "Workspace" — rendered inside the row's action cluster and padded to a ≥44 px touch target at mobile
breakpoints. It SHALL carry an accessible name conveying the full verb (e.g. "Add to workspace") via
`aria-label` and `title`, so the visible noun never becomes the sole cue, and SHALL expose `aria-haspopup` with
`aria-expanded` reflecting popover state. The prior 10px `+ws` text token, positioned in its own
absolutely-placed layer outside the cluster, SHALL be removed.

NOTE — presentation reconciled with `add-to-workspace-affordance` (archived
`2026-08-04-enlarge-add-to-workspace-button`), which landed on `develop` while this change was unmerged and
promoted the labelled pill to a main spec. This change's original compact `mdiFolderPlus` + `mdiMenuDown`
disclosure-caret icon button is SUPERSEDED; the a11y contract and the scope-keyed popover state below are not.

The affordance SHALL be present in BOTH surfaces where it exists today: the sidebar folder-group header and the
session card header (where it targets the session's cwd).

#### Scenario: Folder row renders the labelled pill, not the text token

- **WHEN** a top-level folder group header renders and at least one workspace exists or workspace creation is available
- **THEN** a pill carrying a glyph, the visible label "Workspace", and an accessible name for adding to a workspace SHALL render inside the header's icon cluster
- **AND** no element with the literal text `+ws` SHALL render

#### Scenario: Session card renders the same affordance

- **WHEN** a session card header renders
- **THEN** the same labelled pill, with an accessible name for adding the session's cwd to a workspace, SHALL render in the card's header cluster

#### Scenario: Disclosure state is exposed

- **WHEN** the user activates the add-to-workspace button
- **THEN** `aria-expanded` SHALL become `true` while the popover is open
- **AND** SHALL return to `false` when the popover closes via outside click or Escape

### Requirement: Add-to-workspace popover offers no pin destination

The add-to-workspace popover SHALL list existing workspaces, a `+ New workspace…` entry, and — when the folder
already belongs to a workspace — a remove-from-workspace entry. It SHALL NOT offer a "Pin to dashboard" entry:
a folder rendered in the sidebar is already visible, so pinning is not a destination the popover can meaningfully
offer. When no workspaces exist the popover SHALL state that plainly rather than rendering an empty list.

#### Scenario: No pin entry in the popover

- **WHEN** the add-to-workspace popover renders
- **THEN** it SHALL NOT contain a "Pin to dashboard" menu item

#### Scenario: Popover with no workspaces

- **WHEN** the popover renders and zero workspaces exist
- **THEN** a "no workspaces yet" statement SHALL render
- **AND** a `+ New workspace…` entry SHALL render

#### Scenario: Popover for a folder already in a workspace

- **GIVEN** the folder belongs to workspace `Frontend`
- **WHEN** the popover renders
- **THEN** `Frontend` SHALL be indicated as the current workspace and SHALL NOT be selectable as a new target
- **AND** a remove-from-workspace entry SHALL render
