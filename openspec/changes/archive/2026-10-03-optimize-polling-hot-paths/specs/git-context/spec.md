## MODIFIED Requirements

### Requirement: Git branch detection
The bridge extension SHALL detect the current git branch for the session's `cwd`. On the first evaluation for a cwd it SHALL use `git rev-parse --abbrev-ref HEAD`. On later evaluations it SHALL read the `<gitDir>/HEAD` file of the cached checkout roots: content `ref: refs/heads/<name>` SHALL yield `<name>`; any other content or a read error SHALL fall back to `git rev-parse --abbrev-ref HEAD` run asynchronously. If detection fails (not a git repo), the branch SHALL be `undefined`. When in detached HEAD state, the extension SHALL detect the short commit SHA via `git rev-parse --short HEAD` (asynchronously after the first evaluation).

On the first evaluation for a cwd, the extension SHALL determine worktree identity via the shared checkout-root resolution (`git-checkout-root-resolution`) and cache it (re-evaluation rules: `bridge-session-state-poll` "Static git facts are cached per working directory"). The cwd SHALL be classified as a worktree when it is a linked worktree (`git rev-parse --git-dir` differs from `git rev-parse --git-common-dir`) AND a main checkout resolves for it. The extension SHALL NOT classify by comparing `--git-common-dir` against `--show-toplevel`, and SHALL NOT derive `mainPath` as the parent of `--git-common-dir`: that comparison reports a submodule as a worktree, and that derivation names a real checkout only when the git dir happens to sit inside one. The resolver returns a repository-local `core.worktree` value VERBATIM and does not judge it, so a resolved main checkout containing an exact `.git` path SEGMENT SHALL be treated as no worktree: the extension is a DISPLAY consumer, and the safe response is to omit `gitWorktree` rather than put a git-internal path on the wire.

#### Scenario: Resolved main checkout inside a git directory
- **GIVEN** a linked worktree whose repository-local `core.worktree` names a path containing a `.git` segment
- **WHEN** the extension gathers git info for that cwd
- **THEN** the extension SHALL emit `gitWorktree: undefined` (or omit the field)
- **AND** SHALL NOT emit the git-internal path as `mainPath`

#### Scenario: Session in a git repository
- **WHEN** the extension gathers git info in a directory that is a git repository
- **THEN** the extension SHALL detect the current branch name

#### Scenario: Branch read from the HEAD file
- **WHEN** a later evaluation runs and `<gitDir>/HEAD` contains `ref: refs/heads/feature/x`
- **THEN** the branch SHALL be `feature/x` without spawning git

#### Scenario: Session not in a git repository
- **WHEN** the extension gathers git info in a directory that is not a git repository
- **THEN** the branch SHALL be `undefined` and no git info SHALL be sent

#### Scenario: Detached HEAD
- **WHEN** the git repository is in a detached HEAD state
- **THEN** `git rev-parse --abbrev-ref HEAD` returns `"HEAD"`
- **AND** the extension SHALL run `git rev-parse --short HEAD` to get the short commit SHA
- **AND** the branch SHALL be the short SHA (e.g., `"abc1234"`)
- **AND** no branch link SHALL be generated

#### Scenario: Session in main repo checkout
- **WHEN** the cwd is not a linked worktree (its `--git-dir` equals its `--git-common-dir`)
- **THEN** the extension SHALL emit `gitWorktree: undefined` (or omit the field) on the gathered info
- **AND** this SHALL hold for a submodule checkout, a `--separate-git-dir` checkout, and a bare repository alike

#### Scenario: Session in a git worktree
- **WHEN** the cwd is a linked worktree and a main checkout resolves for it
- **THEN** the extension SHALL emit `gitWorktree: { mainPath, name }`
- **AND** `mainPath` SHALL be the resolved main checkout — the main working tree for an ordinary worktree, and the submodule's own checkout for a worktree of a submodule
- **AND** `mainPath` SHALL NOT be the parent of `--git-common-dir` when that parent is not a working tree
- **AND** `name` SHALL be the basename of the worktree's own ROOT (`thisCheckout`), NOT of the request cwd, which may be a subdirectory of the worktree

#### Scenario: Worktree detection failure
- **WHEN** either `rev-parse` invocation fails (e.g., insufficient git version, permission)
- **THEN** the extension SHALL fall through to `gitWorktree: undefined`
- **AND** SHALL NOT block the branch / remote / PR detection that follows

### Requirement: Git remote URL detection
The extension SHALL detect the remote URL by running `git remote get-url origin` in the session's `cwd` on the first evaluation for that cwd and SHALL cache it; it SHALL re-detect it (asynchronously) under the re-evaluation rules of `bridge-session-state-poll` "Static git facts are cached per working directory". If the command fails (no origin remote), the remote URL SHALL be `undefined`.

#### Scenario: SSH remote URL
- **WHEN** the origin remote URL is in SSH format (e.g., `git@github.com:user/repo.git`)
- **THEN** the extension SHALL parse it to extract the host, user, and repo

#### Scenario: HTTPS remote URL
- **WHEN** the origin remote URL is in HTTPS format (e.g., `https://github.com/user/repo.git`)
- **THEN** the extension SHALL parse it to extract the host, user, and repo

#### Scenario: No origin remote
- **WHEN** the repository has no "origin" remote configured
- **THEN** the remote URL SHALL be `undefined` and no links SHALL be generated

#### Scenario: Remote URL reused between re-evaluations
- **WHEN** ticks run for the same cwd between re-evaluation points
- **THEN** `git remote get-url origin` SHALL NOT be spawned by those ticks

### Requirement: Periodic git info refresh
The extension SHALL run a git-info tick every 30 seconds. It SHALL send a `git_info_update` message only when the branch, worktree identity, git status or any PR field has changed since the last update. Every `git_info_update` the extension sends SHALL carry its current PR fields, so a poll that skips PR detection never clears them.

No recurring git work SHALL run synchronously on pi's event loop. The only synchronous git work SHALL be the first evaluation for a cwd — at registration, on a session change (new/fork/resume), and after a cwd change — which SHALL send its `git_info_update` immediately with branch and worktree identity and with `gitStatus` omitted, and SHALL request a fast-lane probe whose result carries the status. A first evaluation SHALL reset every git diff cache, including the last-sent status, so the following probe result is never suppressed as unchanged.

Working-tree status (`git status`) SHALL be probed asynchronously. Apart from the first-evaluation update and PR-only re-sends, every `git_info_update` carrying a branch, worktree or status change SHALL be sent from the settled result of a probe. A probe SHALL read the branch before it starts and again when it settles; when they differ, or when the session's working directory changed meanwhile, the result SHALL be discarded and one further probe requested. A failed or timed-out probe SHALL still send branch/worktree changes, with `gitStatus` omitted. The probe SHALL NOT take git's optional locks (`--no-optional-locks`), so it never rewrites the index it is watching.

Probes SHALL be requested in two lanes:
- **fast lane** — a first evaluation; a change to `HEAD`, `packed-refs`, `ORIG_HEAD`, `FETCH_HEAD` or `MERGE_HEAD` in the session's git directory (or the common git directory, when different) observed by a non-recursive filesystem watch; a `git_info_refresh` message; a reconnect. Fast-lane probes SHALL start at least 2 seconds apart.
- **slow lane** — every tick; the end of any tool execution whose tool name is not, compared case-insensitively, one of `read`, `grep`, `find`, `ls`, `glob`; a change to `index` or a watch event without a filename. Slow-lane probes SHALL start at least 10 seconds apart.

Requests SHALL coalesce with a 750 ms trailing debounce; a request inside its lane's spacing window SHALL be deferred to the end of that window, never dropped; a pending fast-lane request supersedes a pending slow-lane one. At most one probe SHALL be in flight; a request arriving during a probe SHALL cause exactly one further probe after it settles. The git-directory watch SHALL be re-attached when the session's working directory changes; when it cannot be attached, the tick and tool triggers still apply.

PR detection SHALL be told the current branch whenever the branch is resolved — on the first evaluation, on every tick, and on every settled probe (including a failed one) — independent of whether `git status` succeeds. A PR-status change SHALL be re-sent from cached state without spawning git.

PR detection SHALL run asynchronously, never delaying the poll, and on a slower cadence than the rest of git info:
- on the first poll;
- on any poll at least 120 seconds after the last PR detection;
- when the branch changes: immediately, except that detections caused by branch changes SHALL start at most once per 30 seconds, the latest branch winning (a session or working-directory change is not rate-limited);
- immediately on an explicit refresh request.

At most one PR detection per session SHALL be in flight. A forced request that arrives while a detection is in flight SHALL run once that detection settles; it SHALL NOT be dropped. A forced detection SHALL start at most once per 30 seconds; further forced requests in that window SHALL coalesce into it. A result for a session, working directory or branch that is no longer current SHALL be discarded. When the session identity or working directory changes, PR fields SHALL be treated as unknown until detection completes. When the branch changes, the extension SHALL immediately report every PR field as known-absent until detection for the new branch completes.

When PR detection fails:
- the extension SHALL keep reporting the last known PR values for the same branch;
- it SHALL back off between detections, doubling from 120 seconds up to a 10-minute cap;
- it SHALL log once when entering the failing state and once on recovery.

#### Scenario: Branch changes during session
- **WHEN** the user checks out a different branch in a terminal during a session and the git-directory watch is attached
- **THEN** the extension SHALL send updated git info, branch and status together, within about three seconds (debounce, lane interval, probe), then detect the PR for the new branch
- **AND** no git info sent after the change SHALL carry the previous branch's PR

#### Scenario: Branch change without a watch
- **WHEN** the git-directory watch could not be attached and the branch changes
- **THEN** the next 30-second tick SHALL detect the change

#### Scenario: Agent edit marks the tree dirty
- **WHEN** an `edit` tool execution ends in a clean repository and no slow-lane probe started in the last 10 seconds
- **THEN** a status probe SHALL run after the debounce and a `git_info_update` with the dirty status SHALL be sent

#### Scenario: External edit still seen within a tick
- **WHEN** a file is modified by an editor outside pi and no git metadata changes
- **THEN** the next tick's slow-lane probe SHALL report the dirty status

#### Scenario: Read-only tool does not probe
- **WHEN** a `read` (or `Read`) tool execution ends
- **THEN** no status probe SHALL be triggered by it

#### Scenario: Rate-limited request is deferred
- **WHEN** a slow-lane probe started 9 seconds before a tick and a file was meanwhile edited outside pi
- **THEN** the tick's request SHALL run about 1 second later, at the end of the spacing window, and report the dirty status

#### Scenario: Trigger burst coalesces
- **WHEN** mutating tool executions end continuously for one minute
- **THEN** at most six slow-lane status probes SHALL start in that minute

#### Scenario: Tick never blocks
- **WHEN** a tick runs after the first evaluation
- **THEN** it SHALL NOT spawn any git process synchronously

#### Scenario: HEAD changes during a probe
- **WHEN** the branch read when a probe settles differs from the branch read when it started
- **THEN** that probe's result SHALL NOT be sent and one further probe SHALL run

#### Scenario: Stale status discarded
- **WHEN** the session's working directory changes while a status probe for the old directory is in flight
- **THEN** that probe's result SHALL NOT be sent

#### Scenario: Status failure does not stop PR detection
- **WHEN** `git status` fails on every probe for a repository on a branch with an open PR
- **THEN** PR detection SHALL still run on the first poll and on its cadence
- **AND** a `git_info_refresh` SHALL still force a detection

#### Scenario: Rebase does not churn PR detection
- **WHEN** HEAD moves across five different branches within one minute
- **THEN** at most two branch-change PR detections SHALL start in that minute, the last one for the final branch

#### Scenario: Session change resets status diff
- **WHEN** a session is resumed in the same clean repository the previous session reported as clean
- **THEN** the git info for the resumed session SHALL carry `gitStatus` once its probe settles

#### Scenario: Reconnect restores status
- **WHEN** the bridge reconnects after a server restart
- **THEN** a fast-lane probe SHALL run and the re-sent git info SHALL carry `gitStatus`

#### Scenario: No change since last poll
- **WHEN** git info and PR fields have not changed since the last update
- **THEN** the extension SHALL NOT send a `git_info_update` message

#### Scenario: PR detection skipped between cadence points
- **WHEN** a poll runs 30 seconds after the last PR detection and the branch is unchanged
- **THEN** the extension SHALL NOT invoke the PR CLI on that poll
- **AND** any `git_info_update` sent by that poll SHALL still carry the last known PR fields

#### Scenario: Slow PR CLI does not delay the poll
- **WHEN** the PR CLI takes 10 seconds to respond and the branch changed
- **THEN** the branch change SHALL be sent without waiting for the PR CLI
- **AND** the PR fields SHALL follow in a later update

#### Scenario: PR detection backs off on failure
- **WHEN** the PR CLI fails with an authentication or network error on consecutive detections
- **THEN** the interval between detections SHALL grow, capped at 10 minutes
- **AND** the last known PR values SHALL keep being reported
- **AND** exactly one failure log line SHALL be written until detection recovers

#### Scenario: Initial git info
- **WHEN** a session is registered
- **THEN** the extension SHALL send git info carrying branch and worktree identity (from the synchronous first evaluation) immediately after registration, start an immediate status probe whose result follows, start PR detection immediately (not at the first 30-second poll), and run the tick every 30 seconds

#### Scenario: Hung CLI counts as failure
- **WHEN** the PR CLI does not respond within 20 seconds
- **THEN** the detection SHALL be treated as a failure and the next forced request SHALL NOT wait on it

#### Scenario: Forked session does not inherit a PR
- **WHEN** a session is forked in the same working directory and branch while a PR is cached
- **THEN** the new session SHALL report its PR only after its own detection completes

#### Scenario: Forced refresh during an in-flight detection
- **WHEN** a refresh request arrives while a PR detection is still running
- **THEN** a second detection SHALL run as soon as the first settles
