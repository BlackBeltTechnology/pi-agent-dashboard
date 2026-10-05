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

Worktree identity SHALL be derived from the shared checkout-root resolution
(`git-checkout-root-resolution`): a cwd is reported as a worktree when it is a linked
worktree AND a main checkout resolves for it, with `mainPath` set to that resolved main
checkout and `name` set to the basename of the worktree's own root (`thisCheckout`), not of the cwd, which may be a subdirectory of the worktree. The checkout roots are probed once per cwd and cached (see "Static git facts are cached per working directory"). Worktree identity SHALL NOT be derived from a
bare inside/outside comparison of `--git-common-dir` against `--show-toplevel`, and SHALL NOT
be derived from the common dir's name.

Consequently:

- A **submodule** SHALL NOT be reported as a worktree. Its per-worktree git dir and common
  dir are equal, so it is not a linked worktree; it is an independent project and consumers
  group it by its own cwd. The same applies to a `--separate-git-dir` checkout and to a bare
  repository.
- A **worktree of a submodule** SHALL be reported as a worktree, with `mainPath` set to the
  submodule's own checkout — never to a path inside `.git/modules`.
- A **worktree of a bare repository** is a linked worktree for which no main checkout exists.
  It SHALL be reported with NO worktree identity rather than with a fabricated `mainPath`, so
  it groups by its own cwd.

The bridge SHALL validate the resolved main checkout before reporting it, because the resolver
returns a user-controlled `core.worktree` value verbatim and does not judge it. When the
resolved main checkout contains a `.git` path segment (exact-segment test), the bridge SHALL
report NO worktree identity rather than the invalid path — omitting the field is the safe
response for a display consumer. `mainPath`, when reported, SHALL NEVER contain a `.git` path
segment.

#### Scenario: Branch resolves for a normal checkout
- **WHEN** git detection runs against a cwd on a named branch
- **THEN** the detected branch is that branch's short ref name

#### Scenario: Detached HEAD resolves to a short SHA
- **WHEN** the current ref resolves to `HEAD` (detached)
- **THEN** the detected branch is the short commit SHA
- **AND** when even that fails it falls back to the literal `HEAD`

#### Scenario: Not a git repository yields no git info
- **WHEN** the branch cannot be detected for a cwd
- **THEN** no git info is gathered and no git_info_update is sent for that evaluation

#### Scenario: Worktree identity is derived from git-common-dir vs toplevel
- **WHEN** the cwd is a linked worktree (its `--git-dir` differs from its `--git-common-dir`) AND a main checkout resolves for it
- **THEN** the cwd is reported as a worktree with `mainPath` set to that main checkout and `name` set to the basename of the worktree's own root
- **AND** when the cwd is not a linked worktree, or no main checkout resolves, or either rev-parse fails, the worktree is undefined

#### Scenario: Submodule is not a worktree
- **GIVEN** a cwd that is a git submodule checkout, whose `--git-common-dir` is `<super>/.git/modules/<name>` and equals its `--git-dir`
- **WHEN** git detection runs for that cwd
- **THEN** the worktree identity SHALL be undefined
- **AND** no `mainPath` pointing inside `<super>/.git/modules` SHALL be reported
- **AND** the branch, remote, and PR signals for the submodule SHALL still be detected normally

#### Scenario: Worktree of a submodule reports the submodule as its main path
- **GIVEN** a worktree created from a submodule checked out at `/super/models/sub`, whose common dir is `/super/.git/modules/models/sub`
- **WHEN** git detection runs for that worktree
- **THEN** it SHALL be reported as a worktree
- **AND** `mainPath` SHALL be `/super/models/sub`
- **AND** `mainPath` SHALL NOT be `/super/.git/modules/models`

#### Scenario: An implausible resolved main checkout is not reported
- **GIVEN** a linked worktree whose repository-local `core.worktree` points inside a git directory, which the resolver returns verbatim
- **WHEN** git detection runs for that worktree
- **THEN** the bridge SHALL report no worktree identity
- **AND** SHALL NOT emit a `mainPath` containing a `.git` path segment
- **AND** SHALL NOT rely on the resolver having filtered the value

#### Scenario: Worktree of a bare repository reports no worktree identity
- **GIVEN** a worktree created from a bare hub, for which no main checkout exists
- **WHEN** git detection runs for that worktree
- **THEN** the worktree identity SHALL be undefined rather than naming the directory that contains the bare git dir
- **AND** the session SHALL group by its own cwd

#### Scenario: Separate-git-dir and bare checkouts report no worktree identity
- **GIVEN** a cwd created with `git init --separate-git-dir=<elsewhere>.git`, whose `--git-dir` and `--git-common-dir` are equal
- **WHEN** git detection runs for that cwd
- **THEN** the worktree identity SHALL be undefined rather than reporting the common dir's parent as `mainPath`
- **AND** the same SHALL hold for a bare repository cwd, which has no toplevel at all

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
- **THEN** the wire message sets `gitWorktree` to explicit `null` (distinct from omission) so the server can distinguish "not a worktree" from "no change"; how the server applies it is owned by `git-context` (already-resolved parentage is retained)
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

### Requirement: Static git facts are cached per working directory

The bridge SHALL probe a cwd's remote origin URL and checkout roots (per-worktree git dir, common git dir, this checkout, main checkout, linked-worktree flag) once per cwd and reuse them on later ticks. The first probe for a cwd SHALL complete before the first `git_info_update` for that cwd is sent, so the registration handshake carries worktree identity. Later re-probes SHALL run asynchronously and SHALL happen when: a `git_info_refresh` is received; the reconnect-cache reset runs; the tick's filesystem stamp of `<topLevel>/.git` and the git dir (existence, type, modification time) differs from the stamp taken at the last probe; or on ticks 10, 20, 30, …. When the cwd is not a git repository (no roots), the stamp SHALL be the existence of `<cwd>/.git`, so `git init` in the cwd is detected on the next tick. A cwd change and a session change (new/fork/resume) SHALL be treated as a first probe for the cwd. Worktree identity SHALL be derived from the cached checkout roots by the same rules as `Git state detection`.

#### Scenario: Unchanged cwd reuses facts
- **WHEN** nine consecutive ticks run for the same cwd after the facts were probed and the stamp is unchanged
- **THEN** no remote-URL or checkout-root git process SHALL be spawned by those ticks

#### Scenario: Registration carries worktree identity
- **WHEN** a session in a linked worktree registers
- **THEN** the first `git_info_update` after `session_register` SHALL carry `gitWorktree`

#### Scenario: Worktree repaired underneath a live session
- **WHEN** `git worktree repair` rewrites `<topLevel>/.git` while the session runs
- **THEN** the next tick SHALL detect the stamp change and asynchronously re-probe the facts, and a changed worktree identity SHALL be sent

#### Scenario: git init in a plain directory
- **WHEN** a session's cwd was not a repository and `git init` runs in it
- **THEN** the next tick SHALL detect the new `<cwd>/.git`, re-probe the facts, and git info SHALL be sent

#### Scenario: Safety re-probe
- **WHEN** the 10th tick after the last probe runs
- **THEN** the remote URL and checkout roots SHALL be re-probed asynchronously

#### Scenario: cwd change re-probes
- **WHEN** the session's cwd changes
- **THEN** the facts for the new cwd SHALL be probed before git info for it is sent

### Requirement: Branch is read from the HEAD file

After the first evaluation for a cwd, the bridge SHALL determine the branch by reading `<gitDir>/HEAD` from the cached checkout roots. Content `ref: refs/heads/<name>` SHALL yield `<name>`. Any other content (a commit id, a ref outside `refs/heads/`, empty) or a read error SHALL fall back to the git CLI branch detection run asynchronously, which reports a detached HEAD as git's short commit id; until it settles the previous branch value SHALL be kept. The fallback result SHALL be reused while the HEAD file content is unchanged (for a read error: while the error code and the file's modification time are unchanged), so a persistently detached or unreadable HEAD does not spawn git on every evaluation.

#### Scenario: Branch from file
- **WHEN** `<gitDir>/HEAD` contains `ref: refs/heads/feature/x`
- **THEN** the branch SHALL be `feature/x` and no git process SHALL be spawned for it

#### Scenario: Detached HEAD falls back asynchronously
- **WHEN** `<gitDir>/HEAD` contains a 40-character commit id
- **THEN** the branch SHALL come from the asynchronous git CLI fallback (short commit id) and pi's event loop SHALL NOT wait for it

#### Scenario: Detached HEAD fallback reused
- **WHEN** two evaluations run while `<gitDir>/HEAD` holds the same commit id
- **THEN** the CLI fallback SHALL run for the first evaluation only

#### Scenario: Unreadable HEAD falls back
- **WHEN** reading `<gitDir>/HEAD` fails
- **THEN** the asynchronous git CLI branch detection SHALL be used and the evaluation SHALL NOT throw

### Requirement: pi version is re-read on a slow cadence

The bridge SHALL read the pi version on ticks 1, 11, 21, … (the first tick and every 10 ticks after it), counted per bridge incarnation. A failed or empty read SHALL be retried on the next tick. Change detection and the `pi_version_update` message are unchanged.

#### Scenario: Version not read every tick
- **WHEN** the version was read successfully on tick 1
- **THEN** ticks 2 through 10 SHALL NOT call the version reader and tick 11 SHALL

#### Scenario: Failed read retries
- **WHEN** the version read throws on a tick
- **THEN** a warning SHALL be logged, nothing SHALL be sent, and the next tick SHALL call the reader again

### Requirement: Model selection runs the model-update check immediately

When the bridge forwards a pi `model_select` event, it SHALL also run the model-update check (same change detection as the tick), deferred by 50 ms through the bridge's one-shot timer registry so the session context reflects the new model — the same deferral the dashboard-initiated model switch uses. `thinking_level_select` keeps its existing immediate check. The tick SHALL remain a fallback.

#### Scenario: TUI model change pushed immediately
- **WHEN** the user selects a different model in pi's own UI and pi emits `model_select`
- **THEN** a `model_update` carrying the new model SHALL be sent within about 50 ms, without waiting for the next tick

#### Scenario: Unchanged model on model_select
- **WHEN** `model_select` fires but the model string and thinking level equal the last-sent values
- **THEN** no `model_update` SHALL be sent

### Requirement: Poll cost is reported in the heartbeat

The bridge SHALL report cumulative poll-cost counters as flat optional fields of the `session_heartbeat` `metrics` object: `pollProcScanRuns`, `pollProcScanSpawns`, `pollProcScanMs`, `pollGitProbesTick`, `pollGitProbesTool`, `pollGitProbesWatch`, `pollGitProbesRefresh`, `pollGitSpawns`, `pollGitMs`, and `pollGitWatchersAttached` (0 or 1 per session). `/api/health` SHALL report the sum of each field across live sessions (for `pollGitWatchersAttached` the number of sessions with an attached watch). Servers that do not know the fields SHALL be unaffected.

#### Scenario: Counters advance
- **WHEN** one process scan and one tool-triggered git status probe run between two heartbeats
- **THEN** the second heartbeat SHALL show `pollProcScanRuns` and `pollProcScanSpawns` each increased by one and `pollGitProbesTool` increased by one

#### Scenario: Health sums sessions
- **WHEN** two live sessions report `pollGitSpawns` of 3 and 4
- **THEN** `/api/health` SHALL report `pollGitSpawns` as 7

#### Scenario: Older server
- **WHEN** a server that does not know the `poll*` fields receives the heartbeat
- **THEN** it SHALL process the heartbeat as before

### Requirement: Poll schedulers and watchers are disposed on teardown

Creating the process-scan scheduler, the git probe scheduler or the git-directory watcher SHALL first dispose any existing instance, so a `session_start` for a new, forked or resumed session leaves exactly one of each. The bridge SHALL register a disposer for each, and SHALL run every registered disposer in the re-initialisation block that clears the previous incarnation's timers, in the bridge cleanup path, and on `session_shutdown`. A re-entry by a different pi instance in the same process (e.g. a subagent), which skips initialisation, SHALL NOT run them. A cwd change SHALL dispose the git-directory watcher and attach one for the new cwd. A disposed scheduler SHALL NOT re-arm, and a scan or probe that settles after disposal SHALL NOT send.

#### Scenario: Reload leaves nothing running
- **WHEN** the bridge is reloaded three times in one pi process
- **THEN** exactly one process-scan schedule, one git probe scheduler and at most one git-directory watcher set SHALL be active afterwards

#### Scenario: Session switches do not stack schedulers
- **WHEN** the user starts a new session, forks, and resumes another within one pi process
- **THEN** exactly one process-scan schedule, one git probe scheduler and at most one git-directory watcher set SHALL be active

#### Scenario: Subagent re-entry keeps the parent's watchers
- **WHEN** a subagent loads extensions in the same pi process and the bridge skips initialisation for it
- **THEN** the parent session's schedulers and git-directory watcher SHALL keep running

#### Scenario: Late result after shutdown
- **WHEN** a git status probe settles after `session_shutdown`
- **THEN** no `git_info_update` SHALL be sent
