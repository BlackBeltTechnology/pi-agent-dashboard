## ADDED Requirements

### Requirement: Worktree cleanup option in archive flow
The OpenSpec archive dialog SHALL include an optional "Remove associated worktree" checkbox. When checked and the archive operation succeeds, the server SHALL remove all dashboard-managed git worktrees under `.pi/worktrees/` for the repository.

#### Scenario: Checkbox visible in bulk archive dialog
- **WHEN** the bulk archive confirmation dialog opens
- **THEN** a "Remove associated worktrees" checkbox SHALL be visible

Note: The checkbox is always shown for simplicity. It is a no-op when no worktrees exist.

### Requirement: Server-side worktree matching
The server SHALL find dashboard-managed worktrees by matching worktree directory paths against the pattern `.pi/worktrees/<change-name>-*` using exact prefix match (case-sensitive). The matching SHALL only consider worktrees whose absolute path starts with `<repo-root>/.pi/worktrees/<change-name>-`.

#### Scenario: Matching worktree found by path prefix
- **WHEN** archiving change "fix-auth-bug" and a worktree exists at `.pi/worktrees/fix-auth-bug-1234567890/`
- **THEN** the server SHALL identify this worktree as a match

#### Scenario: Partial prefix does not match different change
- **WHEN** archiving change "fix-auth" and a worktree exists at `.pi/worktrees/fix-auth-bug-1234567890/`
- **THEN** the server SHALL NOT match this worktree ("fix-auth-bug" does not equal "fix-auth")

#### Scenario: No matching worktree
- **WHEN** archiving change "add-feature" and no worktree path matches `.pi/worktrees/add-feature-*`
- **THEN** the server SHALL return `{ cleanedUpWorktrees: [] }` and complete the archive successfully

### Requirement: Worktree removal during archive
When `cleanupWorktree: true` is passed in the `openspec_bulk_archive` WebSocket message, the server SHALL, after successful archiving, remove all dashboard-managed worktrees under `.pi/worktrees/` using `git worktree remove --force`. Worktree removal failure SHALL NOT fail the archive operation. Results SHALL be broadcast as `openspec_update` with `data.worktreeCleanup`.

#### Scenario: Successful archive with cleanup
- **WHEN** `openspec_bulk_archive` is sent with `cleanupWorktree: true` and worktrees exist under `.pi/worktrees/`
- **THEN** the change SHALL be archived
- **AND** the worktrees SHALL be removed
- **AND** an `openspec_update` message SHALL be broadcast with `data.worktreeCleanup: { cleanedUpWorktrees: [...], cleanupErrors: [] }`

#### Scenario: Successful archive with no worktrees
- **WHEN** `openspec_bulk_archive` is sent with `cleanupWorktree: true` and no `.pi/worktrees/` exist
- **THEN** the change SHALL be archived
- **AND** an `openspec_update` message SHALL be broadcast with `data.worktreeCleanup: { cleanedUpWorktrees: [], cleanupErrors: [] }`

#### Scenario: Archive succeeds even if worktree removal fails
- **WHEN** `openspec_bulk_archive` is sent with `cleanupWorktree: true` and worktree removal fails (e.g., locked worktree)
- **THEN** the change SHALL still be archived successfully
- **AND** an `openspec_update` message SHALL be broadcast with `data.worktreeCleanup: { cleanedUpWorktrees: [], cleanupErrors: ["..."] }`

#### Scenario: Archive without cleanup flag
- **WHEN** `openspec_bulk_archive` is sent without `cleanupWorktree` or with `cleanupWorktree: false`
- **THEN** the change SHALL be archived
- **AND** no worktrees SHALL be removed
- **AND** no `worktreeCleanup` field SHALL be in the response
