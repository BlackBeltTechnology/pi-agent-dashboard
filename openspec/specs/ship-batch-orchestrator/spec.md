# ship-batch-orchestrator Specification

## Purpose
Ship every active change of one OpenSpec group through `ship-it` unattended, each in
its own worktree and dashboard session, with a parallelism cap, question-aware slot
accounting, in-batch dependency gating and teardown that archives every session and
removes every worktree whose work is safely pushed or merged.

## Requirements

### Requirement: Batch membership and order come from the OpenSpec group

The orchestrator SHALL take one group (by id, or by case-insensitive name) and SHALL
queue every active (non-archived) change assigned to it and not already archived on
`origin/develop`, in the group's persisted
`changeOrder`, with members absent from `changeOrder` appended in the board's default
order (in-progress, then complete, then name). An unknown or ambiguous group SHALL
abort the run before any side effect and list the available groups.

#### Scenario: Persisted order is honoured
- **WHEN** group `harden-security` has `changeOrder` `[b, a]` and active members `a`, `b`, `c`
- **THEN** the queue order SHALL be `b`, `a`, `c`

#### Scenario: Archived assignment is not queued
- **WHEN** `assignments` maps an already-archived change to the group
- **THEN** that change SHALL NOT be queued

#### Scenario: Ambiguous group name aborts
- **WHEN** two groups are named `Current` (case-insensitive) and the run names `current`
- **THEN** the run SHALL exit non-zero listing both group ids and SHALL create no worktree

### Requirement: Preflight before any side effect

Before creating any worktree, session, commit, state or lock file, the orchestrator
SHALL verify that `git` and `openspec` are available, the dashboard is reachable, its
spawn strategy is `headless`, the repository has an `origin` remote, and the cap `N` and
the live ceiling are integers with `1 ≤ N <` live ceiling, and that dependency data is
available for every member (a `pending` answer retried 10 times, 3 s apart); any failure
SHALL exit with code 1 and the reason.

#### Scenario: Non-headless spawn strategy refused
- **WHEN** the dashboard config reports `spawnStrategy: "tmux"`
- **THEN** the run SHALL exit non-zero naming the strategy and SHALL create no worktree

#### Scenario: Invalid cap refused
- **WHEN** the run is started with `--parallel 0`
- **THEN** the run SHALL exit non-zero before any side effect

### Requirement: Parallelism cap

The orchestrator SHALL start a queued change only while the number of active items is
below the cap `N` (default 2, configurable) and the number of live items (active plus
questioned) is below the live ceiling (default `2 × N`, configurable).

#### Scenario: Default cap holds two
- **WHEN** a group has 4 eligible changes and no `--parallel` flag is given
- **THEN** exactly 2 sessions SHALL be started and the third SHALL wait for a slot

#### Scenario: Live ceiling stops new starts
- **WHEN** with `N = 2` and `--max-live 3`, one item is active, two are waiting on questions and a change is queued
- **THEN** no further change SHALL start even though fewer than `N` items are active

### Requirement: A questioned session does not occupy a slot

An item whose session has a pending question on the pending-question stack SHALL NOT
count toward `N`, SHALL be kept open, and SHALL NOT be torn down, nudged or timed out
while the question is pending. The runner SHALL NOT exit while such an item exists.

#### Scenario: Question frees a slot without closing the session
- **WHEN** 2 items run with cap 2 and one session raises an `ask_user` question while a change is still queued and the live ceiling is not reached
- **THEN** the next queued change SHALL start within one observation interval (10 s) AND the questioned session SHALL remain open with its worktree intact

#### Scenario: Pending question keeps the runner alive
- **WHEN** every other item is terminal and one item still has a pending question
- **THEN** the runner SHALL keep waiting and SHALL NOT exit or tear that item down

### Requirement: Answered questions never pre-empt

When a question is answered the item SHALL count as active again. The orchestrator SHALL
NOT stop any item to restore the cap and SHALL NOT start new items until the active count
is below `N`.

#### Scenario: Answer leads to temporary over-cap, no new starts
- **WHEN** with cap 2, a questioned item is answered while 2 other items are active
- **THEN** 3 items SHALL be active, none SHALL be stopped, and no queued change SHALL start until the active count drops below 2

### Requirement: In-batch dependency gating

A queued change SHALL NOT start while any of its open `blockedBy` edges names another
member of the same batch that has not reached `shipped`. When such a blocker reaches a
terminal state other than `shipped`, the dependent SHALL become `skipped`. Blockers
outside the batch SHALL NOT gate the start; the dry run and the report SHALL list them.

#### Scenario: Dependent waits for its in-batch blocker
- **WHEN** `b` is blocked by `a`, both are in the batch, and `a` is running
- **THEN** `b` SHALL NOT start even if a slot is free, and SHALL become eligible once `a` is `shipped`

#### Scenario: Failed blocker skips the dependent
- **WHEN** `a` ends `kept` because it is blocked and `b` is blocked by `a`
- **THEN** `b` SHALL be `skipped` with the reason naming `a`

#### Scenario: Out-of-batch blocker does not gate
- **WHEN** `b` is blocked by `x` which is not a batch member, including when `x` is in a cycle outside the batch
- **THEN** `b` SHALL be eligible by queue order and slot availability alone and the dry run SHALL list `x` for `b`

### Requirement: In-batch cycles

Members forming a cycle through in-batch edges SHALL be `skipped` at planning time.

#### Scenario: In-batch cycle is skipped
- **WHEN** batch members `a` and `b` block each other
- **THEN** both SHALL be `skipped` at planning time and the rest of the batch SHALL proceed

### Requirement: Worktree selection per change

Starting a change SHALL use the worktree for branch `os/<change>`: reuse it when
registered; otherwise check out the existing local `os/<change>` branch, or the
remote-only `origin/os/<change>` branch; otherwise create `os/<change>` from `develop`.
An unregistered leftover directory at the worktree path SHALL be cleaned through the
orphan-cleanup endpoint and the creation retried once.

#### Scenario: Re-run reuses the pushed branch
- **WHEN** `fix-x` was previously torn down with branch `os/fix-x` existing only on `origin`
- **THEN** the worktree SHALL be created by checking out `origin/os/fix-x` into `.worktrees/os-fix-x`, not by creating a new branch

### Requirement: ship-it session spawn

After the worktree exists, the orchestrator SHALL record the spawn request time, spawn a
dashboard session in the worktree with the change attached, the configured model
(default `@coding`) and an initial prompt that invokes the `ship-it` skill, and persist
the session id before any later step.

#### Scenario: Fresh start
- **WHEN** change `fix-x` starts and no `os/fix-x` branch or worktree exists
- **THEN** `.worktrees/os-fix-x` SHALL be created on branch `os/fix-x` from `develop` and a session spawned there with model `@coding` and `fix-x` attached

### Requirement: Session adoption is exact

When a spawn reply times out, or a resumed item has a spawn request but no session id,
the orchestrator SHALL adopt a session only when exactly one resident, non-ended session
has a cwd resolving to the worktree path and started at or after the recorded spawn
request. With none it SHALL spawn again on resume, or fail the item on a spawn timeout;
with several it SHALL keep the item without adopting any.

#### Scenario: Stale session in the worktree is not adopted
- **WHEN** the spawn reply times out and the only resident session in the worktree is ended or started before the spawn request
- **THEN** no session SHALL be adopted and the item SHALL be `failed`

### Requirement: Init hook trust and start failures

The worktree init hook SHALL run only when already trusted; the orchestrator SHALL never
trust it. A worktree, init or spawn failure SHALL make the outcome `failed` and route the
item through teardown. An untrusted hook SHALL also halt all further starts while live
items continue, and the run SHALL tell the operator to trust the hook.

#### Scenario: Untrusted init hook halts scheduling
- **WHEN** the init endpoint answers `init_untrusted`
- **THEN** the hook SHALL NOT be trusted or run by the orchestrator, the item SHALL be `failed` and torn down, no further change SHALL start, and live items SHALL continue to completion

### Requirement: No decision without a live view

The orchestrator SHALL make no settle or teardown decision unless its bus connection has
been up continuously for at least the settle window, and SHALL treat a recorded session
missing from the resident list as ended only when the archived listing shows it. On a
lost connection it SHALL reconnect with backoff indefinitely and report the dashboard as
unreachable in status mode.

#### Scenario: Dashboard restart does not trigger teardown
- **WHEN** the dashboard restarts while an item's ship-it session is still running
- **THEN** the item SHALL NOT be settled or torn down until the session is observed again or confirmed archived

### Requirement: Settle rule

An item without a pending question SHALL be settled when its session has ended, or when
it has been idle for the settle window after either streaming since the last prompt or
the start timeout elapsing since that prompt.

#### Scenario: Prompt that never streams still settles
- **WHEN** a spawned session stays idle and never streams for longer than the start timeout
- **THEN** the item SHALL settle and be classified instead of holding its slot

### Requirement: Outcome classification

The outcome SHALL be `shipped` when the change is newly archived on `origin/develop`
compared with the archive set recorded at plan time, names matched exactly with the
shared archived-name parser, re-fetching once after a delay before deciding otherwise;
else `blocked` when the worktree holds the change's `SHIP_IT_BLOCKED.md`; else
`incomplete`; and `unknown` when `origin/develop` cannot be fetched.

#### Scenario: Shipped detection
- **WHEN** a settled item's change appears as `openspec/changes/archive/<date>-<change>/` on `origin/develop` and did not at plan time
- **THEN** its outcome SHALL be `shipped`

#### Scenario: Similar archive name is not a match
- **WHEN** change `auth` settles and `origin/develop` newly contains `archive/2026-01-01-fix-auth/` only
- **THEN** its outcome SHALL NOT be `shipped`

### Requirement: Bounded continue nudge

An `incomplete` item whose session is alive and idle SHALL be re-prompted to continue
`ship-it` up to the nudge budget (default 1) before teardown. An ended session SHALL never
be nudged.

#### Scenario: Stopped mid-run is nudged once
- **WHEN** a settled item is neither archived nor blocked, its session is alive and idle, and no nudge was used
- **THEN** one continue prompt SHALL be sent and the item SHALL return to running instead of being torn down

### Requirement: Teardown always archives the session first

Every item reaching an outcome SHALL be torn down. Teardown SHALL archive the session and
confirm, within a bound, that it is ended and archived — re-issuing the archive when an
idle-archive intent expired — before touching the worktree; it SHALL then bring a
recorded docker test harness down. A session not archived within the bound, or any other
non-ended session still in the worktree, SHALL make the item `kept`.

#### Scenario: Remove never races a live session
- **WHEN** the archive request is accepted as pending
- **THEN** the worktree SHALL NOT be touched until the session is observed ended and archived

#### Scenario: Expired archive intent is re-issued
- **WHEN** the session ends after its idle-archive intent expired and is not archived
- **THEN** the archive SHALL be requested again for the ended session

### Requirement: Unshipped work is pushed before removal

Pushable work SHALL be commits on `os/<change>`, tracked changes and untracked
non-ignored files; `.pi/settings.json` SHALL be treated as worktree-local configuration
and never staged. For `incomplete` and `failed`, work SHALL be committed as a WIP commit
and `os/<change>` pushed, after which the worktree SHALL be removed and the branch kept;
a worktree with nothing to save SHALL be removed.

#### Scenario: Incomplete change is pushed then removed
- **WHEN** an item ends `incomplete` with uncommitted edits
- **THEN** a WIP commit SHALL be pushed to `origin/os/<change>` and the worktree SHALL be removed with the branch kept

### Requirement: Shipped worktree removal

For `shipped`, the worktree SHALL be removed when still registered and its only dirt is
`.pi/settings.json`, and the local `os/<change>` branch SHALL be deleted.

#### Scenario: Worktree already removed by ship-change
- **WHEN** a `shipped` item's worktree is no longer registered
- **THEN** the remove step SHALL be skipped without error and a remaining local `os/<change>` branch SHALL be deleted

### Requirement: Unpushable state keeps the worktree

The worktree SHALL be kept, with the item `kept` and the path reported, when the outcome
is `blocked` (its gitignored hand-back cannot be pushed; WIP is still pushed), when the
push fails, when a merge or rebase is in progress or HEAD is detached, when the outcome is
`unknown`, or when a `shipped` worktree has dirt other than `.pi/settings.json`.

#### Scenario: Blocked change keeps its worktree
- **WHEN** an item ends `blocked`
- **THEN** its WIP SHALL be pushed, its session archived, and its worktree with `SHIP_IT_BLOCKED.md` left on disk

#### Scenario: Push failure keeps the worktree
- **WHEN** the push of an `incomplete` item fails
- **THEN** the worktree SHALL remain on disk and the item SHALL be `kept`

#### Scenario: Merge in progress is not committed
- **WHEN** an item settles while its worktree has a merge in progress
- **THEN** no commit SHALL be made and the worktree SHALL be kept

#### Scenario: Unarchivable session is reported
- **WHEN** a settled session is interrupted (`live:true`) and the archive is refused through the whole bound
- **THEN** the item SHALL be `kept` with the reason "session not archivable" and its worktree left untouched

### Requirement: Single runner per repository

Only one runner per repository SHALL run, identified by the repository's common git
directory, through an atomically created lock. A lock from another host, or from a live
same-host process with a recent heartbeat, SHALL refuse a second runner naming its
holder; only a same-host lock whose process is dead or whose heartbeat is stale SHALL be
taken over.

#### Scenario: Second runner refused
- **WHEN** a runner is live for the repository and another is started from a worktree of the same repository
- **THEN** the second SHALL exit non-zero naming the live pid

### Requirement: Resumable state

Run state SHALL be persisted atomically after every transition under
`<repo>/.worktrees/.ship-batch/`. A state file with non-terminal items SHALL be resumed by
re-attaching recorded sessions, never spawning a second session for a change; a fully
terminal one SHALL be rotated and a fresh plan made, skipping a member whose worktree
hosts a live session. SIGINT/SIGTERM SHALL stop new starts, persist, release the lock
and exit without touching live sessions.

#### Scenario: Restart does not double-spawn
- **WHEN** the runner is killed while 2 sessions run and is started again for the same group
- **THEN** it SHALL re-attach to both recorded sessions and spawn none for those changes

#### Scenario: Finished run starts fresh
- **WHEN** every item of the previous run is terminal and the runner is started again for the group
- **THEN** the old state SHALL be rotated and still-active members SHALL be re-queued, reusing kept worktrees

### Requirement: Observable runs and side-effect-free modes

Every transition, action and error SHALL be appended to an event log beside the state
file. A dry-run mode SHALL print the planned order, waits, skips and out-of-batch blockers
with no side effects; a status mode SHALL print the current state table; every run SHALL
end with a report of each change's outcome, reason and any kept worktree path, and exit
with code 0 when every change shipped and 2 when any change ended otherwise.

#### Scenario: Partial success exits 2
- **WHEN** a run completes with one change `shipped` and one `kept`
- **THEN** the process SHALL exit with code 2 and the report SHALL name the kept worktree path

#### Scenario: Dry run has no side effects
- **WHEN** the runner is started with `--dry-run`
- **THEN** it SHALL print the schedule and SHALL create no worktree, session, commit, state or lock file
