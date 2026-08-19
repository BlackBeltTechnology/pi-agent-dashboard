# folder-actions-menu Specification

## Purpose
TBD - created by archiving change add-folder-actions-menu. Update Purpose after archive.
## Requirements
### Requirement: Folder actions menu replaces the header action cluster

The folder header SHALL expose exactly one trailing control: a folder actions menu trigger.

Every directory mutation that renders in the **header row** SHALL be reachable from that menu
and SHALL NOT also render as a standalone control in the header row.

This requirement is scoped to the header row. Controls that live elsewhere on the card — the
init and cleanup controls on `FolderActionBar`, and the slot pills' own action buttons — are
outside its scope and continue to render; consolidating those is the subject of separate
changes. The menu SHALL be extensible so those controls can join it later without restructuring
its groups.

**Accepted duplication.** The `AddToWorkspaceMenu` popover already offers its own
remove-from-workspace entry. After this change the gesture is reachable both from that popover
and from the folder actions menu's workspace group. Both SHALL continue to work and SHALL have
identical effect. This is a deliberate trade-off, not an oversight: collapsing it would require
reworking the popover, which this change does not touch.

Activating the trigger SHALL stop click propagation so it neither navigates to the directory
home page nor toggles the folder's collapsed state.

Menu open state SHALL be keyed per folder scope so opening one folder's menu never opens
another's.

#### Scenario: Cluster is a single control

- **WHEN** a folder header renders its trailing cluster
- **THEN** exactly one control SHALL render in the cluster
- **AND** the urgency-sort, pin, add-to-workspace, remove-from-workspace and directory-settings controls SHALL NOT render as separate cluster buttons

#### Scenario: Controls outside the header row are unaffected

- **WHEN** an expanded folder card renders while `FolderActionBar` holds an Initialize or cleanup control
- **THEN** those controls SHALL continue to render on their own row
- **AND** their presence SHALL NOT be treated as a violation of this requirement

#### Scenario: Opening the menu neither navigates nor collapses

- **GIVEN** an expanded folder
- **WHEN** the user activates the folder actions trigger
- **THEN** the menu SHALL open
- **AND** the client SHALL NOT navigate to the directory home page
- **AND** the folder SHALL remain expanded

#### Scenario: Menus are scoped per folder

- **GIVEN** two folder cards rendered in the sidebar
- **WHEN** the user opens one folder's actions menu
- **THEN** the other folder's menu SHALL remain closed

### Requirement: Menu groups are a fixed host-owned taxonomy

Menu items SHALL be grouped by concern under host-defined headings, rendered in a stable
order. A group SHALL render only when it contains at least one item.

Group membership SHALL respect the folder's existing placement gating rather than widening it:
an add-to-workspace item SHALL appear only where that affordance renders today, a
remove-from-workspace item only for workspace-owned folders, and a pin item only where pinning
is meaningful.

The `directory` group SHALL additionally contain a **manage-worktrees** item,
opening the shared worktree list in `manage` mode for that folder's `cwd`. It is
the only session-independent entry point to worktree removal, so it SHALL be
gated on the folder being a git repository rather than on any session state.

#### Scenario: Top-level folder outside a workspace

- **WHEN** the folder actions menu opens for a top-level folder outside any workspace **that is a git repository**
- **THEN** the workspace group SHALL contain an add-to-workspace item
- **AND** the directory group SHALL contain pin, urgency sort, directory settings, and manage worktrees
- **AND** for a folder that is NOT a git repository the same groups SHALL appear WITHOUT the manage-worktrees item

#### Scenario: Workspace-owned folder omits what does not apply

- **WHEN** the folder actions menu opens for a folder inside a workspace container
- **THEN** the workspace group SHALL contain a remove-from-workspace item
- **AND** it SHALL NOT contain an add-to-workspace item
- **AND** the directory group SHALL NOT contain a pin item

#### Scenario: Manage worktrees is gated on the folder being a git repository

- **WHEN** the folder actions menu opens for a folder that is not a git repository
- **THEN** the directory group SHALL NOT contain a manage-worktrees item

#### Scenario: Manage worktrees does not depend on session state

- **WHEN** the folder actions menu opens for a git repository with no live sessions
- **THEN** the directory group SHALL still contain a manage-worktrees item

#### Scenario: Empty group does not render

- **GIVEN** a folder for which no workspace-group item applies
- **WHEN** the menu opens
- **THEN** the workspace group heading SHALL NOT render

### Requirement: Menu trigger glyph is unique on the rendered card

The trigger's glyph SHALL NOT be a glyph already rendered as a menu trigger elsewhere on the
same card. In particular it SHALL NOT reuse the worktree actions menu's glyph, because a
worktree session card renders inside the folder body and the two triggers would otherwise be
visually identical with different scopes.

Glyph uniqueness SHALL be assessed against what the **rendered card** displays, not against
the set of glyphs used across the repository.

#### Scenario: Folder and worktree triggers are distinguishable

- **GIVEN** a folder containing a worktree session card, which renders its own actions menu trigger
- **WHEN** the folder header and that session card are both visible
- **THEN** the two triggers SHALL render different glyphs

### Requirement: Menu is accessible and adapts to viewport

The trigger SHALL expose `aria-haspopup="menu"` and an `aria-expanded` state bound to whether
its menu is open. Items SHALL expose `role="menuitem"`.

The menu SHALL support keyboard operation: opening, moving between items, dismissing with
Escape, and returning focus to the trigger on dismissal.

The menu SHALL present as a full-width sheet rather than a floating popover whenever the
application's existing mobile predicate is true. That predicate is compound — viewport width
below 768px **or** viewport height below 600px — and SHALL be reused verbatim rather than
re-derived, so a short-but-wide window also gets the sheet. In the sheet form every item SHALL
remain reachable and meet the platform touch-target minimum.

The trigger SHALL expose the test id `folder-actions-menu-<cwd>`, and each item SHALL expose a
test id derived from its stable item id so automation need not depend on labels.

#### Scenario: Trigger exposes menu semantics

- **WHEN** the folder actions trigger renders
- **THEN** it SHALL expose `aria-haspopup="menu"`
- **AND** `aria-expanded` SHALL reflect whether the menu is open

#### Scenario: Escape closes and restores focus

- **GIVEN** an open folder actions menu
- **WHEN** the user presses Escape
- **THEN** the menu SHALL close
- **AND** focus SHALL return to the trigger

#### Scenario: Narrow viewport presents a sheet

- **GIVEN** a viewport 375px wide and 900px tall
- **WHEN** the folder actions menu opens
- **THEN** it SHALL present as a full-width sheet, not a floating popover
- **AND** every item SHALL be reachable without horizontal scrolling

#### Scenario: Short-but-wide viewport also presents a sheet

- **GIVEN** a viewport 1200px wide and 560px tall, for which the mobile predicate is true on height
- **WHEN** the folder actions menu opens
- **THEN** it SHALL present as a full-width sheet

#### Scenario: Desktop viewport presents a popover

- **GIVEN** a viewport 1200px wide and 900px tall
- **WHEN** the folder actions menu opens
- **THEN** it SHALL present as a floating popover, not a sheet

