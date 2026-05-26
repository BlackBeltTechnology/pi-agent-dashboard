## ADDED Requirements

### Requirement: Git branch detection
The bridge extension SHALL detect the current git branch by running `git rev-parse --abbrev-ref HEAD` in the session's `cwd`. If the command fails (not a git repo), the branch SHALL be `undefined`. When in detached HEAD state, the extension SHALL detect the short commit SHA via `git rev-parse --short HEAD`.

In the same `gatherGitInfo` pass, the extension SHALL detect whether the cwd is a git worktree by comparing `git rev-parse --git-common-dir` against `git rev-parse --show-toplevel`. If `git-common-dir` resolves to a path outside `show-toplevel` (e.g. `<main-repo>/.git`), the cwd SHALL be classified as a worktree.

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
- **WHEN** `git-common-dir` resolves under `show-toplevel` (typically `<cwd>/.git`)
- **THEN** the extension SHALL emit `gitWorktree: undefined` (or omit the field) on the gathered info

#### Scenario: Session in a git worktree
- **WHEN** `git-common-dir` resolves to a path outside `show-toplevel`
- **THEN** the extension SHALL emit `gitWorktree: { mainPath, name }`
- **AND** `mainPath` SHALL be the absolute directory of the main worktree (the parent of `git-common-dir`)
- **AND** `name` SHALL be the basename of the worktree cwd

#### Scenario: Worktree detection failure
- **WHEN** either `rev-parse` invocation fails (e.g., insufficient git version, permission)
- **THEN** the extension SHALL fall through to `gitWorktree: undefined`
- **AND** SHALL NOT block the branch / remote / PR detection that follows

### Requirement: Worktree identity propagation through session protocol
The bridge SHALL include the `gitWorktree` object on `session_register` and `git_info_update` payloads when the cwd is a worktree. The server SHALL store `gitWorktree` on `DashboardSession` and forward it in `session_added` / `session_updated` browser messages. The field SHALL be optional; clients receiving an older bridge MUST treat its absence as "not a worktree".

#### Scenario: Worktree session register
- **WHEN** a bridge whose cwd is a worktree registers a session
- **THEN** the `session_register` payload SHALL include `gitWorktree: { mainPath, name }`

#### Scenario: Non-worktree session register
- **WHEN** a bridge whose cwd is a main checkout registers a session
- **THEN** the `gitWorktree` field SHALL be absent (not present as `null`)

#### Scenario: Live worktree state update
- **WHEN** a bridge's `gitWorktree` value changes (rare; e.g., user runs `git worktree repair`)
- **THEN** the bridge SHALL emit a `git_info_update` carrying the new value
- **AND** the server SHALL broadcast `session_updated` with the new `gitWorktree`

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
The extension SHALL attempt to detect the current PR/MR number using platform-specific CLI tools. Detection SHALL be best-effort and fail silently.

#### Scenario: GitHub PR detected via gh CLI
- **WHEN** `gh` CLI is available and the current branch has an open PR
- **THEN** the extension SHALL detect the PR number

#### Scenario: CLI tool not available
- **WHEN** the platform CLI tool (gh, glab, etc.) is not installed
- **THEN** the PR number SHALL be `undefined` and no PR link SHALL be generated

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
The extension SHALL poll git info every 30 seconds and send a `git_info_update` message to the server only when the branch or PR number has changed since the last update.

#### Scenario: Branch changes during session
- **WHEN** the user checks out a different branch during a session
- **THEN** the next 30-second poll SHALL detect the change and send updated git info

#### Scenario: No change since last poll
- **WHEN** git info has not changed since the last update
- **THEN** the extension SHALL NOT send a `git_info_update` message

#### Scenario: Initial git info
- **WHEN** a session is registered
- **THEN** the extension SHALL send git info immediately after registration, then poll every 30 seconds

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
