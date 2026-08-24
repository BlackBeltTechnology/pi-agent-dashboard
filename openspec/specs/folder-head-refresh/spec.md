# folder-head-refresh Specification

## Purpose
TBD - created by archiving change refresh-folder-header-branch. Update Purpose after archive.
## Requirements
### Requirement: Server polls resolved folder group keys for git HEAD

The server SHALL maintain a folder-HEAD poll whose work set is the set of paths the client renders as folder groups from live sessions and pinned directories: the union of `resolveSessionGroupPath(session)` over all non-ended sessions and the configured pinned directories, de-duplicated by the shared `pathKey` canonicalization. This set SHALL be recomputed each poll cycle.

The poll set SHALL be computed independently of `computeKnownDirectories()` (the openspec poll set). Specifically it SHALL include a session's `gitWorktree.mainPath` — which `computeKnownDirectories()` (keyed by raw session cwd) omits — so the parent folder of a worktree session is polled.

For each path in the set, the server SHALL call `readHead(cwd)`, derive a display branch (the branch name, or the short commit SHA when HEAD is detached, matching the `detectBranch` rule), and broadcast `git_head_update { cwd, branch }` to all browsers only when the derived value differs from the previously broadcast value for that path (including the first observation). A path that is not a git repository SHALL yield `branch: null`, broadcast once.

When a folder group key enters the set that was not in the previously computed set, the server SHALL refresh that key without waiting for the next periodic cycle. Entry SHALL be detected at session registration, when a session's resolved folder group key changes because its git-worktree identity became known (the parent folder of a worktree session is not derivable at registration time), and when a directory is pinned. Entry detection SHALL NOT be conditioned on the folder being previously unknown to the server, since a folder whose earlier sessions have all ended is absent from the poll set while still being a known cwd. The entry refresh SHALL use the same read → diff → broadcast path as the poll, SHALL NOT form a second broadcast path, and SHALL be bounded by the same read-concurrency cap as the periodic fan-out.

A key leaving the set SHALL NOT have its cached HEAD value discarded: the cache serves the connect snapshot for folders that continue to be rendered without being polled.

Entry SHALL be judged against the most recently computed key set, which SHALL be maintained by a single recompute path shared by the periodic cycle and every entry trigger, so the two cannot interleave into an inconsistent view. A key whose departure has not yet been observed by any recomputation is therefore not treated as re-entering; such a key converges on the next periodic cycle rather than on the trigger, and staleness SHALL remain bounded by one poll interval in that case.

#### Scenario: Worktree parent folder is polled
- **WHEN** a non-pinned session's cwd is a git worktree whose `gitWorktree.mainPath` is `/repo`
- **THEN** the folder-HEAD poll set SHALL include `/repo`
- **AND** the server SHALL call `readHead("/repo")` and broadcast its branch

#### Scenario: Newly seen folder group key refreshes without waiting for the tick
- **WHEN** a session registers whose resolved folder group key is not in the previously computed poll set
- **THEN** the server SHALL read that key's HEAD and broadcast `git_head_update` for it without waiting for the next periodic poll cycle

#### Scenario: Registration into a folder whose earlier sessions all ended refreshes
- **WHEN** a session registers in a folder that is absent from the poll set because every earlier session there has ended
- **THEN** the server SHALL treat that key as entering the set and refresh it without waiting for the next periodic poll cycle

#### Scenario: Pinning a directory refreshes its key
- **WHEN** a directory with no sessions is pinned, so its key enters the poll set
- **THEN** the server SHALL refresh that key without waiting for the next periodic poll cycle

#### Scenario: Worktree parent key entering on git-info update refreshes
- **WHEN** a session's resolved folder group key changes from its own cwd to `gitWorktree.mainPath` because its worktree identity became known after registration
- **AND** that parent key is not being observed
- **THEN** the server SHALL refresh that parent key without waiting for the next periodic poll cycle

#### Scenario: Already-observed folder key is not re-read on entry
- **WHEN** a session registers whose resolved folder group key is already in the poll set
- **THEN** the registration SHALL NOT trigger an additional broadcast for that key

#### Scenario: Re-entering key is re-read rather than served stale
- **WHEN** a folder group key left the poll set, a recomputation observed that departure, its HEAD changed externally while unobserved, and a new session brings the key back into the set
- **THEN** the server SHALL read that key's HEAD and broadcast the current value

#### Scenario: Departure unobserved by any recomputation converges on the next cycle
- **WHEN** a folder group key leaves and re-enters the set between two recomputations, so no recomputation observed the departure
- **THEN** the entry trigger MAY skip the refresh
- **AND** the next periodic cycle SHALL read that key's HEAD and broadcast any change

#### Scenario: Departed folder keeps its cached value for the connect snapshot
- **WHEN** a folder group key leaves the poll set while the client still renders that folder
- **THEN** the server SHALL retain its cached HEAD value
- **AND** a browser connecting afterwards SHALL still receive that folder's entry in the connect snapshot

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

The client SHALL maintain a folder-git map (`cwd → branch | null`) updated from `git_head_update` messages. `GroupGitInfo` SHALL resolve the displayed branch as `folderGitMap[cwd] ?? eligibleChildBranch ?? fetchedBranch`, so a folder's own polled HEAD outranks the branch of any session grouped under it.

A child session SHALL be eligible for the fallback only when its own `cwd` is the folder group's `cwd` under the shared `pathKey` canonicalization. A session rooted in a different directory — such as a worktree session folded into its parent folder's group via `gitWorktree.mainPath` — reports the HEAD of a different checkout and SHALL NOT supply the folder header's git identity under any ordering of the group's sessions. When no child session is eligible, the fallback SHALL yield nothing and resolution SHALL continue to the `GET /api/git/branches` seed.

The folder header's git identity SHALL be taken as a unit from a single eligible session: the branch, its branch URL, the PR number and the PR URL SHALL NOT be sourced from different sessions. When no child session is eligible, the header SHALL render no branch link and no PR affordance from child sessions.

The one-shot `GET /api/git/branches` result (`branchCache`) SHALL remain as a first-paint seed only; a subsequent `git_head_update` for the same cwd SHALL overwrite the displayed value. When the folder-git map entry is `null`, the header SHALL render the existing non-git / "Init git" state.

#### Scenario: Folder HEAD outranks a leaked worktree branch
- **WHEN** a folder group contains a worktree session whose `gitBranch` is `os/foo` and the folder-git map has `develop` for that folder's cwd
- **THEN** `GroupGitInfo` SHALL render `develop`

#### Scenario: WS update overwrites the stale REST seed
- **WHEN** `GroupGitInfo` first paints with a seeded `branchCache` value `os/foo` and later receives `git_head_update { branch: "develop" }`
- **THEN** the header SHALL update to `develop`

#### Scenario: No folder-git entry excludes children rooted elsewhere
- **WHEN** no `git_head_update` has been received for a folder's cwd
- **AND** the group's first-ordered session is a worktree session whose own cwd is `<folder>/.worktrees/os-foo` with `gitBranch` `os/foo`
- **AND** a later-ordered session in the same group has its cwd equal to the folder's cwd with `gitBranch` `develop`
- **THEN** `GroupGitInfo` SHALL render `develop`

#### Scenario: Folder with no eligible child falls through to the REST seed
- **WHEN** no `git_head_update` has been received for a folder's cwd
- **AND** no session in the group has its own cwd equal to the folder's cwd
- **THEN** `GroupGitInfo` SHALL NOT render any of those sessions' branches
- **AND** resolution SHALL fall through to the `GET /api/git/branches` seed for that cwd

#### Scenario: Pinned worktree folder renders its own session's branch
- **WHEN** a worktree directory is pinned, so its session is grouped under its own cwd rather than `gitWorktree.mainPath`
- **AND** no `git_head_update` has been received for that cwd
- **THEN** that session SHALL be eligible and `GroupGitInfo` SHALL render its branch

#### Scenario: Child rooted at the folder still seeds the header
- **WHEN** no `git_head_update` has been received for a folder's cwd
- **AND** the group contains a session whose own cwd equals the folder's cwd with `gitBranch` `develop`
- **THEN** `GroupGitInfo` SHALL render `develop`

#### Scenario: Branch link and PR affordance follow the same eligible session
- **WHEN** the fallback supplies the folder header's git identity
- **THEN** the branch, branch URL, PR number and PR URL SHALL all come from that one eligible session
- **AND** when no child session is eligible, the header SHALL render no branch link and no PR affordance from child sessions

#### Scenario: Null folder HEAD renders non-git state
- **WHEN** the folder-git map entry for a folder's cwd is `null`
- **THEN** the header SHALL render the dimmed / "Init git" affordance

### Requirement: Newly connected browsers receive the cached folder-HEAD map

The folder-HEAD broadcast is change-triggered: `git_head_update` is emitted only on a first observation or a differing value. A browser that connects after a folder has been cached therefore receives no `git_head_update` for it and would hold no authoritative branch for that folder for an unbounded period.

The server SHALL therefore deliver its cached folder-HEAD map (`cwd → branch | null`) to each newly connected browser as part of its initial state, using the same `{ cwd, branch }` shape the client already applies to the folder-git map. Delivery SHALL be scoped to the connecting browser and SHALL NOT rebroadcast to already-connected browsers, and SHALL NOT mutate or invalidate the server-side diff cache.

The snapshot SHALL degrade to an empty set when no folder-HEAD cache exists — for example when a browser connects before folder polling has started or after it has stopped — rather than failing the connection.

#### Scenario: Fresh browser receives cached folder heads on connect
- **WHEN** the server has cached `develop` for `/repo` and a new browser connects
- **THEN** that browser SHALL receive the folder-HEAD entry `{ cwd: "/repo", branch: "develop" }` as part of its initial state
- **AND** its folder-git map SHALL contain `/repo → develop` without waiting for a HEAD change

#### Scenario: Connect snapshot does not disturb the diff cache
- **WHEN** a new browser connects and receives the folder-HEAD snapshot
- **THEN** the server's per-cwd diff cache SHALL be unchanged
- **AND** already-connected browsers SHALL NOT receive a duplicate `git_head_update`

#### Scenario: Empty cache sends no folder-HEAD entries
- **WHEN** a browser connects before any folder HEAD has been read
- **THEN** the initial state SHALL carry no folder-HEAD entries
- **AND** the client SHALL fall back to the ELIGIBLE-child-session and REST-seed resolution defined above (a child rooted at the folder's own cwd; never a child rooted elsewhere)

#### Scenario: Connect before polling starts yields no entries
- **WHEN** a browser connects while no folder-HEAD poll exists
- **THEN** the initial state SHALL carry no folder-HEAD entries and the connection SHALL succeed

#### Scenario: Cached non-git folder is delivered as null
- **WHEN** the server has cached `null` for a non-git folder and a new browser connects
- **THEN** that browser SHALL receive `{ cwd, branch: null }` and render the non-git / "Init git" state

