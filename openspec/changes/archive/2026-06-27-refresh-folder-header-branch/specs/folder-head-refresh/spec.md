## ADDED Requirements

### Requirement: Server polls resolved folder group keys for git HEAD

The server SHALL maintain a folder-HEAD poll whose work set is the set of paths the client renders as folder groups: the union of `resolveSessionGroupPath(session)` over all non-ended sessions and the configured pinned directories, de-duplicated by the shared `pathKey` canonicalization. This set SHALL be recomputed each poll cycle.

The poll set SHALL be computed independently of `computeKnownDirectories()` (the openspec poll set). Specifically it SHALL include a session's `gitWorktree.mainPath` — which `computeKnownDirectories()` (keyed by raw session cwd) omits — so the parent folder of a worktree session is polled.

For each path in the set, the server SHALL call `readHead(cwd)`, derive a display branch (the branch name, or the short commit SHA when HEAD is detached, matching the `detectBranch` rule), and broadcast `git_head_update { cwd, branch }` to all browsers only when the derived value differs from the previously broadcast value for that path (including the first observation). A path that is not a git repository SHALL yield `branch: null`, broadcast once.

#### Scenario: Worktree parent folder is polled
- **WHEN** a non-pinned session's cwd is a git worktree whose `gitWorktree.mainPath` is `/repo`
- **THEN** the folder-HEAD poll set SHALL include `/repo`
- **AND** the server SHALL call `readHead("/repo")` and broadcast its branch

#### Scenario: Unchanged HEAD suppresses rebroadcast
- **WHEN** a folder's HEAD is unchanged between two poll cycles
- **THEN** the server SHALL NOT broadcast a second `git_head_update` for that folder

#### Scenario: External checkout converges within one tick
- **WHEN** a folder's HEAD changes from `os/foo` to `develop` via an external `git checkout`
- **THEN** the next poll cycle SHALL broadcast `git_head_update { cwd, branch: "develop" }`

#### Scenario: Non-git folder reports null
- **WHEN** a polled path is not a git repository
- **THEN** the server SHALL broadcast `git_head_update { cwd, branch: null }` once and cache the null value

#### Scenario: Ended-only folder leaves the set
- **WHEN** a folder's only sessions are all ended and it is not pinned
- **THEN** the recomputed poll set SHALL NOT include that folder

### Requirement: Folder-HEAD filesystem watcher provides instant updates with a poll fallback

The server SHALL attach a filesystem watcher per folder group key over the directory containing that folder's git `HEAD` file, providing near-instant `git_head_update` broadcasts on checkout without waiting for the poll tick. The HEAD directory SHALL be resolved via `git rev-parse --git-dir` run in the folder's cwd, so worktrees (whose `.git` is a file pointing at a per-worktree gitdir) are handled as well as main checkouts.

The watcher SHALL be trigger-only: a `HEAD`-file event SHALL invoke the same read → diff → broadcast path used by the poll, and SHALL NOT bypass the diff cache or form a second broadcast path. The periodic poll SHALL remain the correctness fallback: if `fs.watch` is unavailable or throws (e.g. ENOENT, EMFILE, EACCES), the folder SHALL silently degrade to poll-only and the system SHALL still converge on the next poll cycle.

Watcher lifecycle SHALL mirror the poll set: attach folders entering the group-key set, detach folders leaving it, and detach all watchers on shutdown.

#### Scenario: HEAD change broadcasts before the next poll tick
- **WHEN** a watched folder's `HEAD` changes via an external `git checkout`
- **THEN** the server SHALL broadcast `git_head_update` for that folder without waiting for the periodic poll tick

#### Scenario: Worktree HEAD directory resolved via git
- **WHEN** a watched folder is a git worktree whose `.git` is a file pointing at a per-worktree gitdir
- **THEN** the watcher SHALL watch the gitdir reported by `git rev-parse --git-dir`, not `<cwd>/.git`

#### Scenario: Non-HEAD events ignored
- **WHEN** a file other than `HEAD` changes in the watched directory
- **THEN** the watcher SHALL NOT trigger a `git_head_update`

#### Scenario: Watcher unavailable degrades to poll-only
- **WHEN** `fs.watch` throws while attaching a folder's HEAD watcher
- **THEN** the failure SHALL be logged once and SHALL NOT propagate
- **AND** the periodic poll SHALL still broadcast that folder's HEAD changes on the next cycle

### Requirement: Folder header renders the folder's own HEAD with precedence over child-session branches

The client SHALL maintain a folder-git map (`cwd → branch | null`) updated from `git_head_update` messages. `GroupGitInfo` SHALL resolve the displayed branch as `folderGitMap[cwd] ?? session?.gitBranch ?? fetchedBranch`, so a folder's own polled HEAD outranks the branch of any session grouped under it (including a worktree child grouped via `gitWorktree.mainPath`).

The one-shot `GET /api/git/branches` result (`branchCache`) SHALL remain as a first-paint seed only; a subsequent `git_head_update` for the same cwd SHALL overwrite the displayed value. When the folder-git map entry is `null`, the header SHALL render the existing non-git / "Init git" state.

#### Scenario: Folder HEAD outranks a leaked worktree branch
- **WHEN** a folder group contains a worktree session whose `gitBranch` is `os/foo` and the folder-git map has `develop` for that folder's cwd
- **THEN** `GroupGitInfo` SHALL render `develop`

#### Scenario: WS update overwrites the stale REST seed
- **WHEN** `GroupGitInfo` first paints with a seeded `branchCache` value `os/foo` and later receives `git_head_update { branch: "develop" }`
- **THEN** the header SHALL update to `develop`

#### Scenario: No folder-git entry preserves prior behavior
- **WHEN** no `git_head_update` has been received for a folder's cwd
- **THEN** `GroupGitInfo` SHALL fall back to `session?.gitBranch`, then `fetchedBranch`

#### Scenario: Null folder HEAD renders non-git state
- **WHEN** the folder-git map entry for a folder's cwd is `null`
- **THEN** the header SHALL render the dimmed / "Init git" affordance
