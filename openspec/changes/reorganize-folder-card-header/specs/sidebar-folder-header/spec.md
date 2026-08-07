## ADDED Requirements

### Requirement: Folder card assigns one job per tier

A directory card SHALL separate its content into tiers with distinct responsibilities:
identity and urgency (the name row), git facts, structural calls to action, and directory
state pills. A tier SHALL NOT mix responsibilities.

The git-facts tier SHALL contain no action controls beyond the affordances on the facts
themselves (branch, dirty count). Every directory mutation SHALL be reachable from the
folder actions menu, and SHALL NOT be duplicated as a standalone control elsewhere on the
card.

#### Scenario: Git-facts tier holds no action controls

- **WHEN** an expanded directory card renders
- **THEN** the git-facts row SHALL NOT contain a settings control, an initialize control, or a cleanup control
- **AND** it SHALL NOT contain a standalone commit button separate from the dirty-count affordance

#### Scenario: The dirty-count affordance is the only commit entry point on the row

- **GIVEN** a directory with uncommitted changes
- **WHEN** the git-facts row renders
- **THEN** activating the dirty-count affordance SHALL open the commit surface
- **AND** no second control on that row SHALL open the same surface

#### Scenario: State pills never mutate

- **WHEN** the directory state pill grid renders
- **THEN** every pill SHALL present a count or status
- **AND** no pill SHALL open a mutation menu or perform a directory mutation

#### Scenario: Mutations have exactly one home

- **GIVEN** a directory mutation exposed by the card
- **WHEN** the card renders
- **THEN** that mutation SHALL be reachable from the folder actions menu
- **AND** SHALL NOT also render as a standalone control in the name row or git-facts row

### Requirement: Folder actions menu groups directory mutations

The folder header's trailing cluster SHALL be a single overflow-menu control. Activating it
SHALL open a menu whose items are grouped by concern.

The trigger's glyph SHALL NOT be a glyph already used as a menu trigger elsewhere on the same
card. In particular it SHALL NOT reuse the worktree actions menu's glyph, because a worktree
session card renders inside the folder body and the two triggers would otherwise be visually
identical with different scopes.

Menu contents SHALL respect the folder's existing placement gating rather than silently
widening it: an add-to-workspace item SHALL appear only where the affordance renders today
(top-level rows), a remove-from-workspace item only for workspace-owned folders, and a pin
item only where pinning is meaningful (outside a workspace container).

The control SHALL expose `aria-haspopup="menu"` and an `aria-expanded` state bound to
whether its menu is open. Menu items SHALL expose `role="menuitem"`. Activating the control
SHALL stop click propagation so it neither navigates to the directory home page nor toggles
the folder's collapsed state.

Menu open state SHALL be keyed per folder so that opening one folder's menu does not open
another's.

#### Scenario: Cluster is a single control

- **WHEN** a folder header renders its trailing cluster
- **THEN** exactly one control SHALL render in the cluster
- **AND** the urgency-sort, pin, add-to-workspace and remove-from-workspace controls SHALL NOT render as separate cluster buttons

#### Scenario: Menu is grouped by concern

- **WHEN** the folder actions menu opens for a top-level folder outside any workspace
- **THEN** it SHALL present a workspace group containing add-to-workspace
- **AND** a directory group containing project setup, pin, urgency sort, and directory settings

#### Scenario: Workspace-owned folder omits the items that do not apply to it

- **WHEN** the folder actions menu opens for a folder inside a workspace container
- **THEN** the workspace group SHALL contain remove-from-workspace
- **AND** it SHALL NOT contain add-to-workspace
- **AND** the directory group SHALL NOT contain a pin item

#### Scenario: Menu trigger glyph does not collide with the worktree menu

- **GIVEN** a folder containing a worktree session card, which renders its own actions menu trigger
- **WHEN** the folder header and that session card are both visible
- **THEN** the folder actions trigger and the worktree actions trigger SHALL render different glyphs

#### Scenario: Opening the menu does not navigate or collapse

- **GIVEN** an expanded folder
- **WHEN** the user activates the folder actions control
- **THEN** the menu SHALL open
- **AND** the client SHALL NOT navigate to the directory home page
- **AND** the folder SHALL remain expanded

## MODIFIED Requirements

### Requirement: Folder header uses gutter + content two-column layout

The folder header SHALL use a two-column layout:

1. **Left gutter** (fixed narrow column): the collapse chevron at the top, with the surrounding gutter area acting as the drag handle.
2. **Content column** (`flex-1 min-w-0`): folder icon + name + status capsule + folder actions menu trigger on the first row; branch (`GroupGitInfo`) on the second row; the directory call-to-action banner (when the folder needs one) below that; `SidebarFolderSectionSlot` and the OpenSpec slot below.

The content column SHALL NOT contain a `FolderActionBar` row — that container is removed, its
controls having moved to the folder actions menu and the call-to-action banner.

#### Scenario: Content column rows are ordered identity, git, banner, slots

- **WHEN** an expanded folder header renders
- **THEN** the first content row SHALL carry the folder icon, name, status capsule and actions menu trigger
- **AND** the git info row SHALL follow it
- **AND** no `FolderActionBar` row SHALL render

#### Scenario: Gutter holds the chevron and the drag handle

- **WHEN** a folder header renders
- **THEN** the collapse chevron SHALL live in the left gutter
- **AND** the surrounding gutter area SHALL act as the drag handle

### Requirement: Chevron toggles collapse; surrounding gutter area is the drag handle

Collapse SHALL be toggled solely by the chevron in the left gutter. The folder-name row SHALL
NOT toggle collapse — it navigates to the directory home page instead.

Interactive controls within the header (the status capsule segments, the folder actions menu
trigger) and on subsequent rows (branch `GroupGitInfo`, the call-to-action banner's action, the
slot pills) MUST stop click propagation, or live outside the clickable row, so they perform
their own action and MUST NOT collapse the folder or trigger row navigation.

#### Scenario: Chevron toggles collapse

- **WHEN** the user activates the chevron in the left gutter
- **THEN** the folder's collapsed state SHALL toggle

#### Scenario: Child controls neither collapse nor navigate

- **GIVEN** an expanded folder header
- **WHEN** the user activates the folder actions menu trigger, a status capsule segment, the branch control, or a banner action
- **THEN** that control's own action SHALL fire
- **AND** the folder SHALL NOT collapse
- **AND** the client SHALL NOT navigate to the directory home page

### Requirement: Header icon cluster stays in the top-right at any width

The folder header's trailing action cluster SHALL remain on a single line anchored to the top-right of the header
at every sidebar width, and SHALL NOT wrap to a second row or be pushed out of the card. The cluster SHALL be
non-shrinking (`flex: none`) with non-wrapping content (`white-space: nowrap`); the horizontal squeeze SHALL be
absorbed by the folder-name region, which SHALL be shrinkable (`min-width: 0`) and clipped with an ellipsis.

Name truncation SHALL be prioritised so the folder's own name survives longest: the leading parent-path segment
SHALL shrink first and MAY collapse entirely, while the final path segment (the folder name) SHALL retain a
legible minimum before it ellipses.

The status capsule sits between the name region and the cluster. Under horizontal pressure its idle-count segment
SHALL be dropped before the name region is squeezed further, and its leading alert segment SHALL never be dropped.

#### Scenario: The cluster control remains visible when the sidebar is narrow

- **GIVEN** a folder header rendering the trailing cluster
- **WHEN** the sidebar is narrowed to 220 px
- **THEN** the folder actions control SHALL remain rendered in the top-right
- **AND** the cluster SHALL NOT wrap to a second row

#### Scenario: Parent path collapses before the folder name

- **GIVEN** a folder whose path is `/home/user/Documents/general`
- **WHEN** available width is insufficient for the whole path
- **THEN** the `/home/user/Documents/` parent portion SHALL be truncated or collapsed first
- **AND** the `general` segment SHALL remain at least partially legible

#### Scenario: Long folder name does not displace the cluster

- **GIVEN** a folder whose final path segment is very long
- **WHEN** the header renders
- **THEN** the name SHALL be clipped with an ellipsis
- **AND** the cluster SHALL stay fully within the header's right edge

#### Scenario: Idle count yields before the alert segment

- **GIVEN** a folder with blocked sessions and a narrow sidebar
- **WHEN** the header cannot fit the full status capsule
- **THEN** the idle-count segment SHALL be dropped first
- **AND** the leading alert segment SHALL remain visible
