## MODIFIED Requirements

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

## ADDED Requirements

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
