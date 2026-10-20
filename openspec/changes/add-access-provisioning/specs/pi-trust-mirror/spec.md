## MODIFIED Requirements

### Requirement: Trust mirror settings and per-entry choice

The dashboard config SHALL hold `piTrustMirror` with `enabled` (default true), `coverInteractive` (default false) and `sources.<id>`, defaulting to true for worktree-init, workflow, pinned folders and folder-workspaces, and to false for access grants. Every dialog that creates a mirrorable entry (worktree-init trust "Always trust", workflow trust, pin folder, "Add Folder" into a workspace, access-grant prompt "always", a provisioning-dialog line whose folder is a project root) SHALL show an "Also trust this folder in pi" checkbox pre-set from the source default, SHALL state that trusting lets every project extension and MCP server in the folder and below — including ones added later — start with pi, which is wider than approving one hook script, and SHALL store the operator's choice for that entry together with the entry. Entries created before this change, or without a dialog (moving a folder between workspaces keeps its choice), follow the source default; the Access page SHALL mark them "by default". Storing a choice SHALL NOT change the format existing readers of the source store rely on.

#### Scenario: Checkbox follows the source default
- **WHEN** `sources.worktreeInit` is true and the worktree-init trust dialog opens
- **THEN** "Also trust this folder in pi" SHALL be checked

#### Scenario: Access-grant prompt is unchecked by default
- **WHEN** an access-grant prompt opens with default settings
- **THEN** "Also trust this folder in pi" SHALL be unchecked

#### Scenario: Unchecking stores the choice
- **WHEN** the operator unchecks it and chooses "Always trust"
- **THEN** the choice `false` SHALL be stored for that entry and dashboard trust SHALL NOT cover the repo through it
- **AND** the worktree-init trust store SHALL still read the hook as trusted

#### Scenario: Provisioning line is unchecked by default

- **WHEN** a provisioning dialog shows a grantable project-root line with default settings
- **THEN** "Also trust this folder in pi" SHALL be unchecked for that line, with the consequence statement shown
