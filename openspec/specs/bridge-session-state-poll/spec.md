# bridge-session-state-poll Specification

## Purpose

Define a single, shared poll-tick body that periodically re-detects a pi session's git state (branch, remote-derived platform links, PR, worktree), working-tree dirtiness, session name, active model/thinking level, and pi version, and forwards each of these to the dashboard server ONLY when its value changes since the last send. One implementation backs both the session-start and session-change timers so the two loops can never drift and drop a signal (e.g. renames or model changes ceasing to propagate after a new/fork/resume).

## Requirements

### Requirement: Shared poll-tick gating and cwd handling

The poll-tick SHALL be one function that both the session-start and session-change timers invoke, and it SHALL gate its work on session activity and current-working-directory availability.

#### Scenario: Inactive tick is a no-op
- **WHEN** the poll-tick runs and the session is not active (`isActive()` returns false)
- **THEN** the tick returns immediately and performs no git, name, model, or version checks

#### Scenario: Active tick with a cwd runs all checks
- **WHEN** the poll-tick runs, the session is active, and a cached cwd is present
- **THEN** it runs the git-info check and the cwd-missing check for that cwd
- **AND** it runs the session-name, model-update, and pi-version checks

#### Scenario: Active tick without a cwd still checks name, model, and version
- **WHEN** the poll-tick runs, the session is active, and no cached cwd is present (e.g. cwd unset after a stale-context session swap)
- **THEN** it skips the git-info and cwd-missing checks (which require a directory)
- **AND** it STILL runs the session-name, model-update, and pi-version checks

### Requirement: Git state detection

The bridge SHALL detect the current git branch, remote origin URL, open PR number, and worktree identity for a cwd, and SHALL treat non-repository probes such that a real repo whose probe fails inconclusively never loses its git signal.

#### Scenario: Branch resolves for a normal checkout
- **WHEN** git detection runs against a cwd on a named branch
- **THEN** the detected branch is that branch's short ref name

#### Scenario: Detached HEAD resolves to a short SHA
- **WHEN** the current ref resolves to `HEAD` (detached)
- **THEN** the detected branch is the short commit SHA
- **AND** when even that fails it falls back to the literal `HEAD`

#### Scenario: Not a git repository yields no git info
- **WHEN** the branch cannot be detected for a cwd
- **THEN** `gatherGitInfo` returns undefined and no git_info_update is sent for that tick

#### Scenario: Worktree identity is derived from git-common-dir vs toplevel
- **WHEN** `git rev-parse --git-common-dir` resolves OUTSIDE `git rev-parse --show-toplevel` for the cwd
- **THEN** the cwd is reported as a worktree with `mainPath` set to the parent of the common `.git` dir and `name` set to the cwd's basename
- **AND** when the common dir is inside the toplevel (the main checkout) or either rev-parse fails, the worktree is undefined

#### Scenario: Git-repo tri-state distinguishes confirmed non-repo from unknown
- **WHEN** the git-repo probe exits with code 128 ("not a repository")
- **THEN** the repo state is a confirmed false
- **AND** when the probe fails any other way (missing binary, timeout, signal, other exit code) the repo state is undefined (unknown) rather than false

### Requirement: Platform link building from the remote URL

The bridge SHALL parse an SSH or HTTPS remote URL into host/user/repo, map the host to a known hosting platform, and build platform-correct branch and PR/merge-request URLs, emitting nothing when parsing or the platform is unknown.

#### Scenario: SSH and HTTPS remotes parse to the same host/user/repo
- **WHEN** a remote URL is `git@github.com:user/repo.git` or `https://github.com/user/repo.git`
- **THEN** it parses to host `github.com`, user `user`, repo `repo` (the trailing `.git` is stripped)

#### Scenario: GitHub branch and PR URLs
- **WHEN** links are built for a GitHub remote on branch `feature` with PR number 42
- **THEN** the branch URL is `https://github.com/user/repo/tree/feature`
- **AND** the PR URL is `https://github.com/user/repo/pull/42`

#### Scenario: Platform-specific path shapes
- **WHEN** the platform is GitLab
- **THEN** the branch URL uses `/-/tree/<branch>` and the PR URL uses `/-/merge_requests/<n>`
- **AND** Bitbucket uses `/src/<branch>` and `/pull-requests/<n>`, Gitea/Codeberg use `/src/branch/<branch>` and `/pulls/<n>`, and sourcehut uses `/tree/<branch>` and `/patches/<n>`

#### Scenario: Branch names are URL-encoded and detached HEAD gets no branch URL
- **WHEN** the branch contains characters needing encoding
- **THEN** the branch segment is URL-encoded in the link
- **AND** when the branch is the literal `HEAD` no branch URL is generated

#### Scenario: Unparseable remote or unknown host yields no links
- **WHEN** the remote URL cannot be parsed or its host is not a known platform
- **THEN** no branch or PR URL is produced (empty links)

### Requirement: Change-detected git forwarding (no drift)

The bridge SHALL forward a git_info_update ONLY when branch, PR number, worktree state, or working-tree status changes since the last send, comparing worktree and status via stable serialised snapshots so transitions in either direction are detected.

#### Scenario: No git change is silent
- **WHEN** a tick's branch, PR number, serialised worktree, and serialised git status all equal the last-sent values
- **THEN** no git_info_update is sent

#### Scenario: Any git change forwards the full info
- **WHEN** any of branch, PR number, worktree snapshot, or status snapshot differs from the last send
- **THEN** a git_info_update is sent carrying the branch, branch URL, PR number, PR URL, and `isGitRepo: true`
- **AND** the last-sent branch, PR, worktree, and status caches are updated to the new values

#### Scenario: Worktree present→absent and inconclusive status are encoded explicitly
- **WHEN** worktree state transitions from present to absent
- **THEN** the wire message sets `gitWorktree` to explicit `null` so the server clears its cached value
- **AND** when the git-status probe is inconclusive this tick the `gitStatus` field is omitted so the server keeps its last known status rather than clearing to a false all-clean

#### Scenario: Reconnect cache reset re-sends non-persisted git fields
- **WHEN** the reconnect-cache reset runs (e.g. after a server-restart-driven reconnect)
- **THEN** the last branch, PR, worktree, and status caches are cleared so the next tick re-sends them

### Requirement: Change-detected name, model, and pi-version forwarding

The bridge SHALL forward session name, model/thinking level, and pi version updates ONLY on change from the last send.

#### Scenario: Model or thinking level change forwards a model_update
- **WHEN** the current model string or thinking level differs from the last-sent pair
- **THEN** the last-model and last-thinking-level caches update
- **AND** a model_update carrying model and thinking level is sent only when a model string is present

#### Scenario: Unchanged model is silent
- **WHEN** both the model string and thinking level equal the last-sent values
- **THEN** no model_update is sent

#### Scenario: Session name change forwards a session_name_update
- **WHEN** the session name (empty string when unset) differs from the last-sent name
- **THEN** the last-name cache updates and a session_name_update carrying the name is sent

#### Scenario: pi version change forwards a pi_version_update
- **WHEN** the read pi version differs from the last-sent version (including the first successful read)
- **THEN** the last-version cache updates and a pi_version_update carrying the version is sent
- **AND** when the version read throws, a warning is logged and the send is skipped so the next tick retries

### Requirement: Missing-cwd detection

The bridge SHALL emit a cwd_missing signal exactly once, the first time the cwd stops existing, and never again for that session.

#### Scenario: First disappearance emits cwd_missing once
- **WHEN** the cwd previously existed and now `existsSync(cwd)` returns false and the missing flag is not yet set
- **THEN** the missing flag is set and a single cwd_missing message is sent

#### Scenario: Subsequent ticks after missing are no-ops
- **WHEN** the missing flag is already set
- **THEN** the cwd-missing check returns immediately without re-sending, even if the cwd reappears
