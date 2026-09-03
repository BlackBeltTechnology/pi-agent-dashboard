## MODIFIED Requirements

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

- **WHEN** the folder actions menu opens for a top-level folder outside any workspace
- **THEN** the workspace group SHALL contain an add-to-workspace item
- **AND** the directory group SHALL contain pin, urgency sort, directory settings, and manage worktrees

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
