## ADDED Requirements

### Requirement: Pre-spawn hook support
The `spawnPiSession` function SHALL accept an optional `preSpawnHook` callback parameter. When provided, the hook SHALL be invoked with `{ cwd, branch, label }` before any process is spawned. If the hook returns a string, it SHALL be used as the new `cwd` for the spawn. If the hook throws, the spawn SHALL fail with the hook's error message and no process SHALL be created.

#### Scenario: Pre-spawn hook changes cwd
- **WHEN** `spawnPiSession(cwd, { preSpawnHook: async ({cwd, branch}) => { ...; return newPath; } })` is called
- **THEN** the hook SHALL be invoked before process creation
- **AND** the returned `newPath` SHALL be used as the spawn `cwd`

#### Scenario: Pre-spawn hook failure prevents spawn
- **WHEN** `spawnPiSession(cwd, { preSpawnHook })` is called and the hook throws `new Error("dirty working tree")`
- **THEN** no pi process SHALL be spawned
- **AND** `spawnPiSession` SHALL return `{ success: false, error: "dirty working tree" }`

#### Scenario: Spawn without pre-spawn hook (backward compatible)
- **WHEN** `spawnPiSession(cwd, { strategy: "headless" })` is called without `preSpawnHook`
- **THEN** existing spawn behavior SHALL be preserved unchanged

### Requirement: Worktree pre-spawn hook
When the server receives a spawn request with `spawnMode: "worktree"`, it SHALL construct a pre-spawn hook that:
1. Resolves the repository root from the spawn `cwd`
2. Creates the directory `<repo-root>/../.pi-worktrees/` if it doesn't exist
3. Appends `.pi-worktrees/` to the repository's `.gitignore` if not already present
4. Generates a worktree path: `<repo-root>/../.pi-worktrees/<branch-slug>-<timestamp>/`
5. Runs `git worktree add <path> <branch>`
6. Returns the worktree path as the new spawn `cwd`

#### Scenario: Worktree hook creates worktree and returns path
- **WHEN** the hook is invoked with `{ cwd: "/repo/main", branch: "feature-x" }`
- **THEN** it SHALL resolve repo root from `cwd` and construct path `<repoRoot>/../.pi-worktrees/feature-x-<ts>`
- **AND** run `git worktree add <path> feature-x` from the repo root
- **AND** return the worktree path

#### Scenario: Worktree hook creates .pi-worktrees directory
- **WHEN** `.pi-worktrees/` does not exist
- **THEN** the hook SHALL create it before running `git worktree add`

#### Scenario: Worktree hook adds .gitignore entry
- **WHEN** `.gitignore` in the repo root does not contain `.pi-worktrees/`
- **THEN** the hook SHALL append `.pi-worktrees/` to `.gitignore`

#### Scenario: Worktree hook on dirty tree
- **WHEN** `git worktree add` fails because the working tree has uncommitted changes that conflict with the target branch checkout
- **THEN** the hook SHALL throw with an error containing `"dirty_working_tree"` and the git error message as detail
