## ADDED Requirements

### Requirement: Spawn session in git worktree
The server SHALL accept a `spawnMode: "worktree"` field in `POST /api/sessions/spawn` requests. When set, the server SHALL create a git worktree at `<repo-root>/../.pi-worktrees/<branch-slug>-<timestamp>/` using `git worktree add`, then spawn a pi session with the worktree path as `cwd`. The server SHALL validate that `branch` is a non-empty string matching `[a-zA-Z0-9._/-]+` and that `cwd` is an absolute path within a git repository. The server SHALL shell-escape all user-supplied values passed to `git worktree` subcommands.

#### Scenario: Successful worktree spawn
- **WHEN** a `POST /api/sessions/spawn` request includes `spawnMode: "worktree"`, `branch: "feature-x"`, and `cwd: "/repo/main"`
- **THEN** the server SHALL run `git worktree add /repo/.pi-worktrees/feature-x-<ts> feature-x`
- **AND** spawn a pi session with `cwd` set to the worktree path
- **AND** return `{ sessionId, worktreePath }` to the caller

#### Scenario: Worktree spawn fails on dirty working tree
- **WHEN** `git worktree add` fails because the source working tree has uncommitted changes that conflict with the target branch
- **THEN** the server SHALL return `{ success: false, error: "dirty_working_tree" }` via the spawn response

#### Scenario: Worktree spawn fails on invalid branch
- **WHEN** the requested branch does not exist
- **THEN** the server SHALL return `{ success: false, error: "branch_not_found" }` via the spawn response
- **AND** no worktree SHALL be left behind

#### Scenario: Worktree spawn fails when not a git repo
- **WHEN** `cwd` is not inside a git repository
- **THEN** the server SHALL return `{ success: false, error: "not_a_git_repo" }` via the spawn response

#### Scenario: Worktree spawn fails when git binary missing
- **WHEN** `git` is not available on PATH
- **THEN** the server SHALL return `{ success: false, error: "git_unavailable" }` via the spawn response

### Requirement: List git worktrees
The server SHALL expose `GET /api/git/worktrees?cwd=<path>` returning all git worktrees for the repository containing `cwd`, including worktrees created outside the dashboard.

#### Scenario: List worktrees for a repo
- **WHEN** `GET /api/git/worktrees?cwd=/repo/main` is called
- **THEN** the server SHALL run `git worktree list` in the repo
- **AND** return `{ worktrees: [{ path, branch, head, bare, locked }] }`

#### Scenario: List worktrees outside git repo
- **WHEN** `cwd` is not inside a git repository
- **THEN** the server SHALL return `{ worktrees: [] }` with no error

### Requirement: Remove git worktree
The server SHALL expose `DELETE /api/git/worktrees` accepting `{ cwd, path }`. It SHALL run `git worktree remove --force <path>` in the repository identified by `cwd`. The server SHALL refuse to delete worktrees whose path is not under the `.pi-worktrees/` directory managed by the dashboard (external worktrees are list-only).

#### Scenario: Remove a dashboard-managed worktree
- **WHEN** `DELETE /api/git/worktrees` is called with a `path` under `.pi-worktrees/`
- **THEN** the server SHALL run `git worktree remove --force <path>`
- **AND** return `{ removed: true, path }`

#### Scenario: Refuse to remove external worktree
- **WHEN** `DELETE /api/git/worktrees` is called with a `path` not under `.pi-worktrees/`
- **THEN** the server SHALL return `{ removed: false, error: "external_worktree_readonly" }`

#### Scenario: Remove a non-existent path
- **WHEN** `DELETE /api/git/worktrees` is called with a `path` that does not exist or is not a worktree
- **THEN** the server SHALL return `{ removed: false, error: "not_a_worktree" }`

#### Scenario: Refuse to remove main worktree
- **WHEN** `DELETE /api/git/worktrees` is called with `path` equal to the repository's main working tree
- **THEN** the server SHALL return `{ removed: false, error: "cannot_remove_main_worktree" }`

### Requirement: Worktree spawn dialog (mobile-friendly)
The client SHALL provide a spawn-in-worktree dialog accessible from the session spawn controls. On viewports narrower than 768px, the dialog SHALL render as a full-screen sheet sliding up from the bottom. On wider viewports, it SHALL render as a centered modal.

The dialog SHALL include:
- Branch typeahead (via existing `BranchPicker` component)
- Optional label field: a free-text input for a human-readable worktree label
- "Spawn in worktree" primary action button

When a label is provided, it SHALL be slugified and prepended to the branch-slug in the worktree path: `<repo-root>/../.pi-worktrees/<label-slug>-<branch-slug>-<timestamp>/`. When omitted, only the branch-slug and timestamp are used.

#### Scenario: Open worktree spawn dialog
- **WHEN** the user taps/clicks the "Spawn in worktree" action
- **THEN** a dialog SHALL appear containing a branch typeahead and a "Spawn" button

#### Scenario: Mobile full-screen sheet
- **WHEN** the viewport width is less than 768px
- **THEN** the dialog SHALL cover the full screen, anchored to the bottom edge
- **AND** the branch input SHALL be at least 44px tall

#### Scenario: Desktop centered modal
- **WHEN** the viewport width is 768px or greater
- **THEN** the dialog SHALL render as a centered modal with a max-width of 480px

#### Scenario: Select branch via typeahead
- **WHEN** the user types in the branch input
- **THEN** matching branches SHALL appear in a dropdown list
- **AND** the user SHALL be able to select one via tap/click or keyboard (Enter)

#### Scenario: Spawn with selected branch
- **WHEN** the user selects a branch and clicks "Spawn"
- **THEN** the client SHALL call `POST /api/sessions/spawn` with `spawnMode: "worktree"` and the selected branch
- **AND** the dialog SHALL close
- **AND** the new session SHALL appear in the session list

#### Scenario: Cancel closes dialog
- **WHEN** the user taps the backdrop or close button
- **THEN** the dialog SHALL close without spawning

### Requirement: Worktree indicator on session cards
Session cards SHALL display a worktree indicator when the session's `cwd` is inside a git worktree. The indicator SHALL show the worktree branch name and a git-worktree icon.

#### Scenario: Worktree session card
- **WHEN** a session has `cwd` matching a git worktree path (`.git` is a file, not a directory)
- **THEN** the session card SHALL display a worktree indicator with the branch name

#### Scenario: Non-worktree session card
- **WHEN** a session's `cwd` is the main working tree (`.git` is a directory)
- **THEN** the session card SHALL NOT display a worktree indicator

#### Scenario: Unknown git state
- **WHEN** the server cannot determine whether `cwd` is a worktree (e.g., no git repo)
- **THEN** the session card SHALL NOT display a worktree indicator
