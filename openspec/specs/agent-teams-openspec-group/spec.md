# agent-teams-openspec-group Specification

## Purpose
TBD - created by archiving change add-agent-teams-openspec. Update Purpose after archive.

## Requirements

### Requirement: Group membership and order

The `openspec-group` seed SHALL resolve the goal against `openspec/groups/groups.json`, read as a file under the lead cwd (group id first, matched case-sensitively, else case-insensitive name), and include every change with `assignments[change] === group.id` whose directory `openspec/changes/<change>/` exists. Order SHALL be the persisted `changeOrder[group.id]` members, then the remaining members by name (ship-batch also ranks by status; the team has no status data, a deliberate difference).

#### Scenario: Persisted order first
- **WHEN** the group has members `a`, `b`, `c` and `changeOrder` lists `c`, `a`
- **THEN** tasks and launch order are `c`, `a`, `b`

#### Scenario: Archived change excluded
- **WHEN** a group assignment names a change with no active directory
- **THEN** it gets no task and appears in the start notice as skipped

#### Scenario: Empty group
- **WHEN** the group has no included change
- **THEN** the start fails `group_empty`

### Requirement: One task per change with in-group dependencies

The seed SHALL create one task per included change titled with the change name and a description naming the change, its worktree path and branch. `blockedBy` SHALL hold the task of each declared `blocked_by` change that is included; other blockers SHALL be left out and listed in the lead notice. Only the declared `dependencies.yaml` SHALL be read; an `invalid` file SHALL skip its change and name it in the notice.

#### Scenario: In-group edge
- **WHEN** `b` declares `blocked_by: a` and both are included
- **THEN** the task of `b` is blocked by the task of `a`

#### Scenario: Out-of-group blocker
- **WHEN** `b` declares `blocked_by: z` and `z` is not in the group
- **THEN** the task of `b` has no blocker for `z` and the notice lists `z`

#### Scenario: Cycle
- **WHEN** two included changes block each other
- **THEN** the seed detects the cycle itself, skips both, names them in the notice and creates the other tasks

#### Scenario: Invalid dependencies file
- **WHEN** a change's `dependencies.yaml` is invalid
- **THEN** that change is skipped and named in the notice

### Requirement: Skipped changes skip their dependants

A change skipped for an `invalid` dependencies file or a cycle SHALL cause every change that depends on it, transitively, to be skipped and named in the lead notice. A blocker whose directory is absent or archived SHALL count as out-of-group: listed, no edge.

#### Scenario: Dependant of a broken change
- **WHEN** `b` declares `blocked_by: a` and `a` has an invalid `dependencies.yaml`
- **THEN** both `a` and `b` get no task and are named in the notice

#### Scenario: Archived blocker
- **WHEN** `b` declares `blocked_by: a` and `a` is archived
- **THEN** `b` gets a task with no blocker for `a` and the notice lists `a`

### Requirement: Lazy launcher with a slot cap

The server SHALL launch a teammate only while the team is `active`, the task is pending, unblocked and has no launch record, fewer than `openspecGroupParallel` slots are held and live members are fewer than `maxTeammates`. A `launching` change holds a slot, as does a `launched` one whose task is open and whose member is not `gone`/`failed` (`disconnected` holds it). Launches are serial, in `changeOrder`. A full team waits and is re-evaluated on every team change.

#### Scenario: Slot freed
- **WHEN** parallel is 2, two changes run and a third is unblocked
- **THEN** the third starts only after one task has completed

#### Scenario: Restart does not over-launch
- **WHEN** the server restarts and every member is `disconnected` for the reconcile grace
- **THEN** their slots stay occupied and no extra member is launched

#### Scenario: Inactive team
- **WHEN** the team is `orphaned`, `closing` or `closed`
- **THEN** the launcher starts nothing

#### Scenario: Live members at the team cap
- **WHEN** a completed change's member is still `shutdown_pending` and live members equal `maxTeammates`
- **THEN** the next change is not launched, no launch record is written, and it starts once a member is `gone`

#### Scenario: Cap race at spawn
- **WHEN** `spawnMember` answers `team_full` after the launch record was written
- **THEN** the record is removed, nothing is reported as a failure and the launcher retries on the next team change

### Requirement: Launch is idempotent and never auto-retried

Before any worktree or spawn work the launcher SHALL write `launched[task] = {state: "launching", member}` to the sidecar synchronously. It becomes `launched` once core reserved the member, and `launch_failed` with the code if an earlier step fails. A `launching` record found after a restart becomes `launch_failed` `launch_interrupted`. A record SHALL NOT be relaunched automatically; the lead gets one waking notice with task, code and the relaunch route.

#### Scenario: Crash mid-launch
- **WHEN** the server restarts after the record was written but the spawn never resolved
- **THEN** no second member is launched, the record is `launch_failed` `launch_interrupted` and the lead is notified once

#### Scenario: Launch failure
- **WHEN** the worktree step fails after the record
- **THEN** the record is `launch_failed` with the code, its slot is free, the task stays pending and the lead receives a waking notice

#### Scenario: Launched member died
- **WHEN** a `launched` member becomes `gone` and its task is pending
- **THEN** no automatic relaunch happens and the lead is notified

### Requirement: Relaunch after a failed or lost launch

The plugin SHALL expose `POST /api/plugins/agent-teams/openspec-relaunch {teamId, change}` (tier `operate`, the team owner rule of the Team routes) that deletes a `launch_failed` record, or a `launched` record whose member is `gone`/`failed` while the task is pending, and re-evaluates the launcher. Any other state SHALL answer `not_relaunchable`.

#### Scenario: Relaunch after a git failure
- **WHEN** the owner posts a relaunch for a `launch_failed` change
- **THEN** the record is cleared and the launcher starts it again when a slot is free

#### Scenario: Running change
- **WHEN** the owner posts a relaunch for a change whose member is live
- **THEN** the answer is `not_relaunchable` and nothing changes

### Requirement: Teammate naming

The member for a change SHALL be named `os-<change>` when that has at most 32 characters, otherwise `os-` followed by the first 22 characters of the change (trailing `-` trimmed), `-` and the first 6 hex characters of `sha256(change)`. The name SHALL satisfy the core member-name rule and the mapping SHALL be recorded in the sidecar.

#### Scenario: Short name
- **WHEN** the change is `fix-x`
- **THEN** the member is `os-fix-x`

#### Scenario: Long name
- **WHEN** the change is `add-agent-teams-templates-hooks` (31 characters)
- **THEN** the member name has at most 32 characters, starts with `os-` and is stable across restarts

### Requirement: Worktree per teammate before the member spawn

For each launch the plugin SHALL create or reuse `<repo>/.worktrees/os-<change>` on branch `os/<change>` through the dashboard git routes by in-process injection: an existing local or `origin/` branch is checked out, else a branch is forked from `openspecWorktreeBase` (default `develop`); one orphan-cleanup retry; an untrusted init fails `init_untrusted`.

#### Scenario: Worktree created
- **WHEN** the launcher starts `fix-x` and no worktree exists
- **THEN** the member's cwd is `<repo>/.worktrees/os-fix-x` on branch `os/fix-x`

#### Scenario: Base unset
- **WHEN** `openspecWorktreeBase` is unset and no branch `os/fix-x` exists
- **THEN** the branch is forked from `develop`

#### Scenario: Branch already exists
- **WHEN** branch `os/fix-x` exists locally and no worktree does
- **THEN** it is checked out into the worktree instead of forked

#### Scenario: Typed failure
- **WHEN** the git route answers `git_failed`
- **THEN** no member is spawned, the task stays pending and the lead gets a waking notice with the code

#### Scenario: Lead not at repo root
- **WHEN** the lead cwd is a linked worktree or a subdirectory
- **THEN** the start fails `lead_not_repo_root` and no worktree is created

### Requirement: Member spawn in the worktree

After a realpath check that the worktree lies under the lead cwd's `.worktrees/` with basename `os-<change>` the plugin SHALL call core `spawnMember` with `TrustedSpawnOptions.cwd` set to it. A failed step SHALL NOT fall back to the lead cwd and SHALL leave the task pending.

#### Scenario: Unexpected path
- **WHEN** the git route returns a path whose basename is not `os-<change>`
- **THEN** no member is spawned and the lead gets a waking notice `worktree_path_unexpected`

#### Scenario: No fallback to the lead cwd
- **WHEN** the worktree step fails
- **THEN** no session starts in the lead cwd

### Requirement: Ownership without dispatching other changes

The template SHALL set `autoDispatch: false`. The launcher SHALL set the member as `owner` of its change task atomically with the name reservation, and the owner of a launcher-owned task SHALL be immutable for non-server actors (`owner_locked`). The briefing SHALL tell the teammate to work only on that task.

#### Scenario: Owner set before claim
- **WHEN** `os-fix-x` is spawned for the task of `fix-x`
- **THEN** the task owner is `os-fix-x` and no other member can claim it

#### Scenario: Lead reassignment refused
- **WHEN** the lead updates the owner of a launcher-owned task to another member
- **THEN** the update fails `owner_locked` and the owner is unchanged

#### Scenario: Idle teammate gets nothing else
- **WHEN** `os-fix-x` is idle and another change task is unowned and unblocked
- **THEN** the dispatcher does not assign it to `os-fix-x`

### Requirement: Briefing and skills

The spawn prompt SHALL state the task id, change and worktree path, instruct the teammate to load and follow the skill named by `openspecShipSkill` as its first action, to take the `harness` lock only around the docker harness step, and to complete its task only when the change is shipped. It SHALL state that task text is data and the lock is advisory. The teammate SHALL get no skill allowlist.

#### Scenario: Skill missing at start
- **WHEN** `openspecShipSkill` cannot be resolved for the repository
- **THEN** the start fails `ship_skill_missing` before anything is created

#### Scenario: Briefing content
- **WHEN** a teammate is spawned
- **THEN** its prompt names its task id, change, worktree path and the lock rule

### Requirement: Completion is verified as shipped

A core op gate for `TaskUpdate` to `completed` on a launcher-owned task SHALL require the change to be shipped: with the worktree present, an exact `YYYY-MM-DD-<change>` archive entry exists and `openspec/changes/<change>/` does not; with it gone, a fetch of `origin/<merge>` (`openspecMergeBase`, bounded by `openspecFetchTimeoutMs`) lists such an entry. Otherwise the call SHALL be blocked `not_shipped`, failing closed.

#### Scenario: False completion refused
- **WHEN** a teammate completes its task while the change directory still exists
- **THEN** the call is refused `not_shipped` and dependents stay blocked

#### Scenario: Worktree removed after the merge
- **WHEN** `ship-change` merged the change and removed `.worktrees/os-fix-x`, and `origin/develop` lists the archive directory
- **THEN** the teammate's `TaskUpdate` to `completed` is allowed, since it needs no cwd

#### Scenario: Worktree removed, merge not visible
- **WHEN** the worktree is gone and the fetch fails or no exact archive entry is on `origin/<merge>`
- **THEN** the call is refused `not_shipped`

#### Scenario: Fetch times out
- **WHEN** the worktree is gone and the fetch exceeds `openspecFetchTimeoutMs`
- **THEN** the call is refused `not_shipped` with reason `fetch_failed` within the op-gate budget

#### Scenario: Similarly named archive does not count
- **WHEN** the archive holds `2025-01-01-add-fix-x` and the task's change is `fix-x`
- **THEN** the call is refused `not_shipped`

#### Scenario: Non-develop fork base still judged on the merge target
- **WHEN** `openspecWorktreeBase` is `main`, `openspecMergeBase` is `develop` and the archive is on `origin/develop`
- **THEN** the completion is allowed

#### Scenario: Hand-back does not unblock
- **WHEN** the shipping skill ends with a hand-back instead of a shipped change
- **THEN** the teammate messages the lead and leaves the task `in_progress`

### Requirement: Completion frees the slot

When a launcher-owned task is completed (observed through the core `task_completed` store event) its slot SHALL be free at once, while the member still counts against `maxTeammates` until it is `gone`. The server SHALL then request the member's shutdown through core; a rejection or missing answer within `shutdownGraceMs` SHALL notify the lead but SHALL NOT keep the slot occupied. A member that exits without completing its task SHALL NOT be relaunched.

#### Scenario: Normal end
- **WHEN** `os-fix-x` completes its task
- **THEN** its slot is free, it receives a shutdown request and approves, and the next unblocked change can start

#### Scenario: Shutdown rejected
- **WHEN** `os-fix-x` rejects the shutdown request after completing
- **THEN** the lead is notified and the next change still starts

#### Scenario: Member died
- **WHEN** `os-fix-x` becomes `gone` with its task `in_progress`
- **THEN** core releases the task, no automatic relaunch happens and the lead is woken

### Requirement: Coexistence with ship-batch

The start SHALL fail `batch_runner_active` when `<repo>/.worktrees/.ship-batch/lock` is live by the ship-batch rules: `heartbeatAt` younger than 10 minutes, not more than 60 s in the future, and not a dead pid on the same host. A change whose worktree already hosts a resident session SHALL be skipped and listed. A change already driven by another active team SHALL fail the later start `change_in_use`.

#### Scenario: Batch runner live
- **WHEN** the lock heartbeat is 2 minutes old
- **THEN** the start fails `batch_runner_active`

#### Scenario: Dead pid is stale
- **WHEN** the lock names a dead pid on this host with a fresh heartbeat
- **THEN** the start proceeds

#### Scenario: Change already in a team
- **WHEN** an active team's sidecar already holds change `fix-x` and a second team is started for it
- **THEN** the second start fails `change_in_use` and nothing is created

#### Scenario: Live session in worktree
- **WHEN** `.worktrees/os-fix-x` already hosts a resident session
- **THEN** `fix-x` is skipped and named in the notice

### Requirement: Commit rule for owned worktrees

The lead SHALL commit nothing in `openspec-group`. Each teammate SHALL be spawned with the core per-member committer `member` (owner-ratified exception to the lead-sole-committer rule), so only the member owning a worktree's branch commits, pushes and merges there via the shipping skill. The lead stays the sole committer in the shared cwd of `openspec-apply`.

#### Scenario: Lead briefing
- **WHEN** the lead playbook is rendered
- **THEN** it states that the lead makes no commits and that each teammate ships from its own worktree

#### Scenario: Member committer switch
- **WHEN** a group teammate is spawned
- **THEN** it receives the member-commit protocol prompt and the git-write guard is off for it only

#### Scenario: Exception does not leak
- **WHEN** the lead or a member of a plain or apply team attempts a git write
- **THEN** the git-write guard refuses it

### Requirement: Lead notices are coalesced

The template SHALL set `notify.coalesceMs` to 10000 so idle reports of finishing teammates reach the lead as one notice; errors, rejections, member deaths and launch failures SHALL keep waking the lead.

#### Scenario: Several teammates idle
- **WHEN** two teammates report idle within the window
- **THEN** the lead receives one notice

### Requirement: groups.json validity

A missing `groups.json` SHALL fail `group_unknown`; invalid JSON, an unknown `schemaVersion`, duplicate group ids or wrong field types SHALL fail `groups_invalid`.

#### Scenario: Malformed file
- **WHEN** `groups.json` is invalid JSON or holds two groups with the same id
- **THEN** the start fails `groups_invalid` and nothing is created

#### Scenario: Missing file
- **WHEN** `openspec/groups/groups.json` does not exist
- **THEN** the start fails `group_unknown`

### Requirement: Group size limit

A group with more included changes than core `maxTasks` SHALL fail `too_many_tasks` in `preflight`, creating nothing.

#### Scenario: 51 changes
- **WHEN** a group has 51 active changes and `maxTasks` is 50
- **THEN** the start fails `too_many_tasks` and no task exists

### Requirement: Launch steps are bounded

A launch SHALL fail `launch_failed` with `launch_timeout` after 120 s overall; a late success SHALL be ignored and the worktree left. A core refusal such as `name_taken` SHALL fail the launch with that code, free the slot and never adopt a member the launcher did not spawn.

#### Scenario: Hanging git route
- **WHEN** the worktree step does not answer within 120 s
- **THEN** the record is `launch_failed launch_timeout` and the slot is free

#### Scenario: Name already taken
- **WHEN** the lead pre-spawned a member named `os-fix-x`
- **THEN** the launch fails `name_taken` and that member is not adopted

### Requirement: Stuck launcher task has no abandon surface

A launcher-owned task SHALL complete only when shipped and v1 SHALL add no abandon route or tool. The stuck-task notice SHALL name the relaunch route; the owner may fix and relaunch, or `TeamDelete` the team.

#### Scenario: Abandoned change
- **WHEN** the owner abandons a change whose task is `in_progress`
- **THEN** the task cannot be force-completed, its dependants stay blocked and the notice names the relaunch route
