# Git Context

## Purpose

Detect and propagate per-session git context — branch, detached HEAD SHA, worktree identity, remote URL, PR number, hosting-platform links, worktree base ref, cwd-missing state, and the persistent is-git-repo tri-state — from the bridge extension through the session protocol into `DashboardSession` and `.meta.json`, so the dashboard can render branch/PR affordances and gate worktree actions accurately across live, cold, and restarted sessions.

## Requirements

### Requirement: Git branch detection
The bridge extension SHALL detect the current git branch by running `git rev-parse --abbrev-ref HEAD` in the session's `cwd`. If the command fails (not a git repo), the branch SHALL be `undefined`. When in detached HEAD state, the extension SHALL detect the short commit SHA via `git rev-parse --short HEAD`.

In the same `gatherGitInfo` pass, the extension SHALL determine worktree identity via the shared checkout-root resolution (`git-checkout-root-resolution`). The cwd SHALL be classified as a worktree when it is a linked worktree (`git rev-parse --git-dir` differs from `git rev-parse --git-common-dir`) AND a main checkout resolves for it. The extension SHALL NOT classify by comparing `--git-common-dir` against `--show-toplevel`, and SHALL NOT derive `mainPath` as the parent of `--git-common-dir`: that comparison reports a submodule as a worktree, and that derivation names a real checkout only when the git dir happens to sit inside one. The resolver returns a repository-local `core.worktree` value VERBATIM and does not judge it, so a resolved main checkout containing an exact `.git` path SEGMENT SHALL be treated as no worktree: the extension is a DISPLAY consumer, and the safe response is to omit `gitWorktree` rather than put a git-internal path on the wire.

#### Scenario: Resolved main checkout inside a git directory
- **GIVEN** a linked worktree whose repository-local `core.worktree` names a path containing a `.git` segment
- **WHEN** the extension gathers git info for that cwd
- **THEN** the extension SHALL emit `gitWorktree: undefined` (or omit the field)
- **AND** SHALL NOT emit the git-internal path as `mainPath`

#### Scenario: Session in a git repository
- **WHEN** the extension gathers git info in a directory that is a git repository
- **THEN** the extension SHALL detect the current branch name

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

### Requirement: Worktree identity propagation through session protocol
The bridge SHALL include the `gitWorktree` object on `git_info_update` payloads when the cwd is a worktree — the first such update is sent immediately after `session_register`, so the server learns worktree identity within the same registration handshake. The server SHALL store `gitWorktree` on `DashboardSession` and forward it in `session_added` / `session_updated` browser messages. The field SHALL be optional; clients receiving an older bridge MUST treat its absence as "not a worktree".

Once a session's worktree parentage has been resolved, it SHALL be treated as immutable while the session's cwd is unchanged. A re-register with the SAME cwd SHALL carry the in-memory `gitWorktree` over (so a server restart or bridge reconnect during the removal window cannot re-open the clear); a re-register with a DIFFERENT cwd SHALL discard it and start from "unresolved". A `git_info_update` carrying `gitWorktree: null` for a session whose `gitWorktree` is already set means the worktree directory was removed underneath the still-running session (e.g. `git worktree remove` executed from inside it), NOT that the session moved to a plain checkout; the server SHALL keep the existing parentage in that case. A `null` for a session with no parentage set SHALL clear as before.

#### Scenario: Worktree session register
- **WHEN** a bridge whose cwd is a worktree registers a session
- **THEN** the `git_info_update` that immediately follows `session_register` SHALL include `gitWorktree: { mainPath, name }`

#### Scenario: Non-worktree session register
- **WHEN** a bridge whose cwd is a main checkout registers a session
- **THEN** the `gitWorktree` field SHALL be absent from the register payload (not present as `null`)

#### Scenario: Reattach in the same cwd preserves parentage
- **WHEN** a session with `gitWorktree` set re-registers (server restart, bridge reconnect, resume) with the same `cwd`
- **THEN** the session's `gitWorktree` SHALL be unchanged after registration
- **AND** a subsequent `git_info_update { gitWorktree: null }` SHALL leave it unchanged

#### Scenario: Reattach in a different cwd resets parentage
- **WHEN** a session with `gitWorktree` set re-registers with a different `cwd`
- **THEN** `gitWorktree` SHALL be absent after registration until the bridge reports it again

#### Scenario: Live worktree state update
- **WHEN** a bridge's `gitWorktree` value changes from one worktree object to another (rare; e.g., user runs `git worktree repair`)
- **THEN** the bridge SHALL emit a `git_info_update` carrying the new value
- **AND** the server SHALL broadcast `session_updated` with the new `gitWorktree`

#### Scenario: Worktree removed underneath a live session
- **WHEN** a session has `gitWorktree = { mainPath: "/repo", name: "feat-x" }` and `cwd = "/repo/.worktrees/feat-x"`
- **AND** a `git_info_update` arrives with `gitWorktree: null`
- **THEN** the server SHALL keep `gitWorktree = { mainPath: "/repo", name: "feat-x" }`
- **AND** the session SHALL still be marked as having reported worktree state
- **AND** the session's persisted `.meta.json` SHALL retain `gitWorktree.mainPath` / `gitWorktree.name` when the session ends

#### Scenario: Null clears when no parentage was set
- **WHEN** a session has no `gitWorktree`
- **AND** a `git_info_update` arrives with `gitWorktree: null`
- **THEN** `gitWorktree` SHALL remain absent
- **AND** the session SHALL be marked as having reported worktree state

#### Scenario: Backward compatibility with older bridges
- **WHEN** a client receives a session payload without the `gitWorktree` field
- **THEN** the client SHALL treat the session as a plain checkout (no worktree pill, no group collapse)

### Requirement: Worktree base ref persisted in session meta
When a session is spawned by the dashboard via the worktree dialog (post `POST /api/git/worktree`), the server SHALL persist the base ref used to create the worktree into the session's `.meta.json` as `gitWorktreeBase: string`. Sessions spawned by any other channel (CLI `pi`, manual `git worktree add`, etc.) SHALL NOT have this field.

The server SHALL include `gitWorktree.base` on browser-facing session payloads when both:
- `session.gitWorktree` is present (cwd is a worktree), AND
- `gitWorktreeBase` is set in `.meta.json` for this session.

#### Scenario: Dialog-spawned worktree session
- **WHEN** the dashboard spawns a session via the worktree dialog with `base: "develop"`
- **THEN** the session's `.meta.json` SHALL contain `gitWorktreeBase: "develop"`
- **AND** subsequent `session_added` payloads SHALL include `gitWorktree: { mainPath, name, base: "develop" }`

#### Scenario: Session in worktree spawned by other means
- **WHEN** a session is registered for a worktree cwd but no `gitWorktreeBase` exists in `.meta.json`
- **THEN** the `gitWorktree` object SHALL include `mainPath` and `name` only (no `base`)

### Requirement: Git remote URL detection
The extension SHALL detect the remote URL by running `git remote get-url origin` in the session's `cwd`. If the command fails (no origin remote), the remote URL SHALL be `undefined`.

#### Scenario: SSH remote URL
- **WHEN** the origin remote URL is in SSH format (e.g., `git@github.com:user/repo.git`)
- **THEN** the extension SHALL parse it to extract the host, user, and repo

#### Scenario: HTTPS remote URL
- **WHEN** the origin remote URL is in HTTPS format (e.g., `https://github.com/user/repo.git`)
- **THEN** the extension SHALL parse it to extract the host, user, and repo

#### Scenario: No origin remote
- **WHEN** the repository has no "origin" remote configured
- **THEN** the remote URL SHALL be `undefined` and no links SHALL be generated

### Requirement: PR number detection
The extension SHALL attempt to detect the current branch's PR/MR using platform-specific CLI tools. Detection SHALL be best-effort. It SHALL NOT block the bridge's git polling, and SHALL fail without surfacing an error to the session.

For GitHub (`gh`), detection SHALL distinguish three outcomes:
- **a PR exists** — report:
  - the PR number and URL;
  - its state, normalized to lowercase `open`, `closed` or `merged`;
  - whether it is a draft;
  - a checks summary: `failing` if any check failed, errored, timed out, was cancelled, requires action, or is stale; otherwise `pending` if any check is not yet complete or reports an unrecognized result; otherwise `passing` when at least one check exists (neutral and skipped checks count as non-blocking); otherwise `none`. CI provider checks and commit-status contexts SHALL both be interpreted. The same summary SHALL be used wherever the dashboard shows a PR's checks.
- **no PR for the branch** — the CLI reports that no pull request exists. All PR fields SHALL be reported as known-absent.
- **failure** — any other error, a detection taking longer than 20 seconds, or a missing tool. See the refresh requirement for how last-known values are kept.

The raw per-check list SHALL NOT be sent to the server. The values SHALL be exposed on sessions as the optional fields `gitPrState`, `gitPrDraft`, `gitPrChecks` and `gitPrCheckedAt` (time of the last successful detection), alongside `gitPrNumber` / `gitPrUrl`.
- A consumer SHALL treat absent fields as unknown.
- A known-absent PR SHALL clear previously reported PR fields.
- A session reported by a bridge that never sends the new fields SHALL keep them absent.

#### Scenario: GitHub PR detected via gh CLI
- **WHEN** `gh` CLI is available and the current branch has an open PR #747 with all checks succeeded
- **THEN** the session SHALL report `gitPrNumber = 747`, `gitPrState = "open"`, `gitPrDraft = false`, `gitPrChecks = "passing"`

#### Scenario: Failing check dominates
- **WHEN** a PR has one failed check and one pending check
- **THEN** `gitPrChecks` SHALL be `"failing"`

#### Scenario: Timed-out check counts as failing
- **WHEN** a PR's only non-successful check timed out and another check succeeded
- **THEN** `gitPrChecks` SHALL be `"failing"`

#### Scenario: Only skipped checks
- **WHEN** every check on a PR was skipped or neutral
- **THEN** `gitPrChecks` SHALL be `"passing"`

#### Scenario: Successful commit status is not pending
- **WHEN** a PR's only check is a commit-status context in state `SUCCESS`
- **THEN** `gitPrChecks` SHALL be `"passing"`

#### Scenario: No checks at all
- **WHEN** a PR has no checks
- **THEN** `gitPrChecks` SHALL be `"none"`

#### Scenario: Merged PR still reported
- **WHEN** the current branch's latest PR is merged
- **THEN** the session SHALL report its number with `gitPrState = "merged"`

#### Scenario: No PR clears previous values
- **WHEN** a session previously reported PR #747 and the CLI now reports that no pull request exists for the branch
- **THEN** the session's PR fields SHALL be cleared

#### Scenario: CLI tool not available
- **WHEN** the platform CLI tool (gh, glab, etc.) is not installed
- **THEN** the PR number SHALL be `undefined` and no PR link SHALL be generated

#### Scenario: Older bridge omits status fields
- **WHEN** the server receives git info carrying `gitPrNumber` but no `gitPrState` / `gitPrDraft` / `gitPrChecks`
- **THEN** it SHALL forward the session without those fields and SHALL NOT substitute defaults

### Requirement: Hosting platform link building
The extension SHALL build clickable URLs for the git branch and PR based on the detected hosting platform.

Supported platforms and their URL patterns:
- **GitHub**: branch → `/tree/{branch}`, PR → `/pull/{number}`
- **GitLab**: branch → `/-/tree/{branch}`, MR → `/-/merge_requests/{number}`
- **Bitbucket**: branch → `/src/{branch}`, PR → `/pull-requests/{number}`
- **Gitea**: branch → `/src/branch/{branch}`, PR → `/pulls/{number}`
- **Codeberg**: branch → `/src/branch/{branch}`, PR → `/pulls/{number}`
- **SourceHut**: branch → `/tree/{branch}`, patches → `/patches/{number}`

#### Scenario: GitHub repository with PR
- **WHEN** the remote is `git@github.com:user/repo.git`, branch is `feat/foo`, PR is #42
- **THEN** the branch URL SHALL be `https://github.com/user/repo/tree/feat%2Ffoo` and PR URL SHALL be `https://github.com/user/repo/pull/42`

#### Scenario: GitLab repository
- **WHEN** the remote is `https://gitlab.com/user/repo.git` and branch is `main`
- **THEN** the branch URL SHALL be `https://gitlab.com/user/repo/-/tree/main`

#### Scenario: Unknown hosting platform
- **WHEN** the remote host does not match any known platform
- **THEN** no URLs SHALL be generated and branch/PR SHALL be shown as plain text

#### Scenario: Branch with special characters
- **WHEN** the branch name contains `/` or other URL-unsafe characters
- **THEN** the branch name SHALL be URL-encoded in the generated URL

### Requirement: Periodic git info refresh
The extension SHALL poll git info every 30 seconds. It SHALL send a `git_info_update` message only when the branch, worktree identity, git status or any PR field has changed since the last update. Every `git_info_update` the extension sends SHALL carry its current PR fields, so a poll that skips PR detection never clears them.

PR detection SHALL run asynchronously, never delaying the poll, and on a slower cadence than the rest of git info:
- on the first poll;
- on any poll at least 120 seconds after the last PR detection;
- immediately when the branch changes;
- immediately on an explicit refresh request.

At most one PR detection per session SHALL be in flight. A forced request that arrives while a detection is in flight SHALL run once that detection settles; it SHALL NOT be dropped. A forced detection SHALL start at most once per 30 seconds; further forced requests in that window SHALL coalesce into it. A result for a session, working directory or branch that is no longer current SHALL be discarded. When the session identity or working directory changes, PR fields SHALL be treated as unknown until detection completes. When the branch changes, the extension SHALL immediately report every PR field as known-absent until detection for the new branch completes.

When PR detection fails:
- the extension SHALL keep reporting the last known PR values for the same branch;
- it SHALL back off between detections, doubling from 120 seconds up to a 10-minute cap;
- it SHALL log once when entering the failing state and once on recovery.

#### Scenario: Branch changes during session
- **WHEN** the user checks out a different branch during a session
- **THEN** the next 30-second poll SHALL detect the change, detect the PR for the new branch, and send updated git info
- **AND** no git info sent after the change SHALL carry the previous branch's PR

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
- **THEN** the extension SHALL send git info immediately after registration, start PR detection immediately (not at the first 30-second poll), and poll every 30 seconds

#### Scenario: Hung CLI counts as failure
- **WHEN** the PR CLI does not respond within 20 seconds
- **THEN** the detection SHALL be treated as a failure and the next forced request SHALL NOT wait on it

#### Scenario: Forked session does not inherit a PR
- **WHEN** a session is forked in the same working directory and branch while a PR is cached
- **THEN** the new session SHALL report its PR only after its own detection completes

#### Scenario: Forced refresh during an in-flight detection
- **WHEN** a refresh request arrives while a PR detection is still running
- **THEN** a second detection SHALL run as soon as the first settles

### Requirement: cwdMissing flag on DashboardSession
`DashboardSession` SHALL carry an optional `cwdMissing?: boolean` field set by any of three probe sites: (1) the bridge's 30 s VCS tick, (2) the server's session scanner on boot, (3) the `worktree/remove` lifecycle endpoint. The field is purely computed and SHALL NOT be persisted.

#### Scenario: Bridge probe flips on deletion
- **WHEN** the bridge's 30 s tick discovers `existsSync(ctx.cwd) === false` for the first time
- **THEN** the bridge SHALL send `{ type: "cwd_missing", sessionId }` to the server
- **AND** the server SHALL stamp `cwdMissing: true` and broadcast `session_updated`

#### Scenario: Scanner re-probes ended sessions
- **WHEN** the server's session scanner enumerates an ended session whose `cwd` no longer exists on disk
- **THEN** the scanner SHALL stamp `cwdMissing: true` on the in-memory `DashboardSession` before adding it to the manager

#### Scenario: Optimistic stamp on lifecycle remove
- **WHEN** `POST /api/git/worktree/remove` succeeds
- **THEN** every session whose `cwd` was inside the removed path SHALL receive `cwdMissing: true` via `session_updated`

#### Scenario: Backward compatibility with older bridges
- **WHEN** a bridge older than this change is connected
- **THEN** the field SHALL remain `undefined` for every session managed by that bridge
- **AND** the client SHALL treat `undefined` as "not missing"

### Requirement: Stable error code cwd_missing
The server's spawn / resume preflight SHALL return error `code: "cwd_missing"` (replacing the older `cwd_invalid`) when the session's cwd no longer exists. For one release the response envelope SHALL include both keys to preserve compatibility with older clients reading `cwd_invalid`.

#### Scenario: Resume fails with cwd_missing
- **WHEN** a client attempts to resume a session whose cwd has been deleted
- **THEN** the server SHALL respond with `{ success: false, error: "cwd_missing", stderr: "<path>" }`

### Requirement: Persistent is-git-repo tri-state
The system SHALL expose a per-session `isGitRepo` tri-state describing whether the session's cwd is a git repository, independent of branch-info arrival. The value SHALL be one of: `true` (confirmed git repo), `false` (confirmed non-git), or `undefined` (unknown — probe inconclusive or legacy session).

The bridge SHALL compute `isGitRepo` from `git rev-parse --is-inside-work-tree` (the `git.isGitRepo()` `Result`): a successful result SHALL yield its boolean value; a process exit with code `128` (git ran and definitively reported "not a repository") SHALL yield `false`; any other failure (spawn error such as missing git binary, timeout, or termination signal) SHALL yield `undefined`. A failed or timed-out probe SHALL NEVER yield `false` — inconclusive is not negative.

The bridge SHALL include `isGitRepo` on the `session_register` payload (computed synchronously at register time, so browsers receive it without the race that affects `git_info_update`) and MAY refresh it on `git_info_update`. The field SHALL be optional; a client or server receiving an older bridge MUST treat its absence as `undefined` (unknown).

The server SHALL store `isGitRepo` on `DashboardSession`, forward it in `session_added` / `session_updated` browser messages, and persist it into the session's `.meta.json` as `isGitRepo: boolean`. On cold start, `sessionFromMeta` SHALL restore `meta.isGitRepo` so ended/cold sessions in a git repo retain a truthy signal across server restarts without a live bridge.

#### Scenario: Confirmed git repo on register
- **WHEN** the bridge registers a session whose cwd is inside a git work tree
- **THEN** the `session_register` payload SHALL include `isGitRepo: true`
- **AND** the server SHALL persist `isGitRepo: true` to the session's `.meta.json`

#### Scenario: Confirmed non-git on register
- **WHEN** the bridge registers a session whose cwd is not a git repository (git exits `128`)
- **THEN** the `session_register` payload SHALL include `isGitRepo: false`

#### Scenario: Inconclusive probe yields unknown, never false
- **WHEN** the git probe fails to run or times out (missing binary, permission error, ≥15s timeout, killed by signal)
- **THEN** `isGitRepo` SHALL be `undefined`
- **AND** SHALL NOT be reported as `false`

#### Scenario: Survives server restart for cold sessions
- **WHEN** the server restarts and rebuilds an ended session from `.meta.json` where `meta.isGitRepo === true`, with no live bridge reconnected
- **THEN** the restored `DashboardSession.isGitRepo` SHALL be `true`

#### Scenario: Legacy bridge / session
- **WHEN** a session is registered by a bridge that does not send `isGitRepo`, or restored from a `.meta.json` lacking the field
- **THEN** `DashboardSession.isGitRepo` SHALL be `undefined`

### Requirement: Worktree actions trigger an immediate git info refresh
After a worktree Push or Open PR request succeeds, the server SHALL send a `git_info_refresh` message stating which action caused it to every connected bridge whose session cwd is the worktree root or a directory inside it, with both paths compared after resolving symlinks. On receiving `git_info_refresh`, a bridge SHALL run PR detection immediately, regardless of cadence and back-off, and SHALL send `git_info_update` if anything changed. Only when the refresh was caused by Open PR and detection still finds no PR, the bridge SHALL retry detection twice more within 20 seconds. Bridges that do not recognize `git_info_refresh` SHALL be unaffected.

#### Scenario: Open PR updates the segment without waiting for the cadence
- **WHEN** `POST /api/git/worktree/pr` succeeds for worktree `/repo/.worktrees/x`
- **THEN** the server SHALL send `git_info_refresh` to each bridge whose session cwd is `/repo/.worktrees/x` or inside it
- **AND** each such bridge SHALL detect the PR and send `git_info_update` carrying the new `gitPrNumber`

#### Scenario: Session in a worktree subdirectory is refreshed
- **WHEN** a session's cwd is `/repo/.worktrees/x/packages/client` and Push succeeds for `/repo/.worktrees/x`
- **THEN** that session's bridge SHALL receive `git_info_refresh`

#### Scenario: GitHub lag after Open PR
- **WHEN** the first detection after a successful Open PR still reports no PR
- **THEN** the bridge SHALL retry detection twice within 20 seconds

#### Scenario: Push refresh does not retry
- **WHEN** a refresh caused by Push finds no PR for the branch
- **THEN** the bridge SHALL NOT retry detection

#### Scenario: Failed action sends no refresh
- **WHEN** a worktree Push request fails
- **THEN** the server SHALL NOT send `git_info_refresh`

#### Scenario: Local merge does not trigger a PR refresh
- **WHEN** a worktree Merge request succeeds
- **THEN** the server SHALL NOT send `git_info_refresh` on account of the merge
