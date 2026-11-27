# agent-teams-hooks Specification

## Purpose
TBD - created by archiving change add-agent-teams-templates-hooks. Update Purpose after archive.

## Requirements

### Requirement: Hook events and definition

A template MAY declare up to three commands per event for `TeammateIdle`, `TaskCreated` and `TaskCompleted`, each `{command, timeoutMs?}`, `command` at most 2000 characters and `timeoutMs` an integer of at least 1; an unknown event key SHALL be ignored with a warning. The server SHALL run them as `bash -c <command>` in the team lead cwd through the shared platform wrappers, sequentially, and SHALL pass one JSON object on stdin built only from server-held team state.

#### Scenario: Task stdin payload
- **WHEN** a `TaskCompleted` hook runs for task 3 owned by `alice`
- **THEN** its stdin JSON contains `hook_event_name`, team id and name, cwd, member `alice`, `memberCwd` and the task id, title, description, status and result

#### Scenario: Idle stdin payload
- **WHEN** a `TeammateIdle` hook runs for `alice`
- **THEN** its stdin JSON contains `hook_event_name`, team, member `alice`, `memberCwd` and `idle.settleId` and `idle.finalText`

#### Scenario: Too many commands
- **WHEN** a template declares four commands for one event
- **THEN** the template is `invalid` with error `too_many_hooks`

#### Scenario: Command too long
- **WHEN** a hook command is 2001 characters
- **THEN** the template is `invalid` with `hook_command_too_long`

#### Scenario: Bad timeout
- **WHEN** a hook declares `timeoutMs: 0` or `timeoutMs: 1.5`
- **THEN** the template is `invalid` with `field_invalid`

#### Scenario: Unknown event key
- **WHEN** a template declares hooks for `TaskDeleted`
- **THEN** the template is valid with a warning and the hook never runs

### Requirement: Exit-code semantics

Exit code 0 SHALL allow the event. Exit code 2 SHALL block it and its stderr (control characters stripped, at most 2000 characters) SHALL be returned as feedback. Any other exit code, a timeout or an output overflow SHALL be logged and counted and SHALL allow the event. A spawn error SHALL allow the event and SHALL send the lead a notice on its first occurrence per team. The first command that exits 2 SHALL end the sequence.

#### Scenario: Exit 2 blocks
- **WHEN** a `TaskCompleted` hook exits 2 with stderr `tests failing`
- **THEN** the task stays `in_progress` and the member's `TaskUpdate` fails with `hook_blocked` and text `tests failing`

#### Scenario: Other exit allows
- **WHEN** a hook exits 1
- **THEN** the event proceeds and the run is logged as a non-blocking error

#### Scenario: Timeout allows and is reported once
- **WHEN** a hook exceeds its timeout
- **THEN** its process tree is killed, the event proceeds and the lead gets one notice naming the event for the first timeout in that team

#### Scenario: Missing shell is loud
- **WHEN** `bash` cannot be spawned
- **THEN** the event proceeds and the lead gets a notice naming `spawn_error` once for that team

### Requirement: Degenerate exit 2

An exit code 2 with empty stderr SHALL block with the feedback `hook blocked (no output)`. An exit code 2 together with an output overflow SHALL still block, with the first 2000 characters of the output (control characters stripped) as feedback, and the overflow SHALL be counted.

#### Scenario: Exit 2 without output
- **WHEN** a `TaskCompleted` hook exits 2 with empty stderr
- **THEN** the task stays `in_progress` and the call fails with `hook_blocked` and text `hook blocked (no output)`

#### Scenario: Exit 2 with overflow
- **WHEN** a hook writes 100 KiB to stderr and exits 2
- **THEN** the call still fails with `hook_blocked`, the feedback is the first 2000 characters after stripping and the overflow counter increases

### Requirement: Execution budget and limits

All hook commands of one event SHALL share one deadline equal to the core op-gate budget (`opGateBudgetMs`, 12000 ms total, queue wait included); each command's `timeoutMs` (default `hookTimeoutMs`, 10000) SHALL be capped by the remaining budget. At most 2 hooks per team and 4 server-wide SHALL run at once; both output streams SHALL be capped at 64 KiB.

#### Scenario: Two commands share one budget
- **WHEN** two commands each declare `timeoutMs: 10000` and the first takes 9 s
- **THEN** the second is killed at the 12 s deadline and the gate answers before the 15 s lane timeout

#### Scenario: Timeout clamped
- **WHEN** a hook declares `timeoutMs: 60000`
- **THEN** it is killed at the deadline of at most 12000 ms after the gate started

#### Scenario: Descendants killed
- **WHEN** a timed-out hook has started a grandchild process
- **THEN** the grandchild is terminated with the hook and on server shutdown

#### Scenario: Output caps
- **WHEN** a hook writes more than 64 KiB to stdout
- **THEN** the run counts as an output overflow and the event proceeds

### Requirement: Hook environment

The hook child environment SHALL contain only `PATH`, `HOME`, `USER`, `LANG`, `LC_*`, `TMPDIR`, `SHELL`, `AGENT_TEAMS_EVENT`, `AGENT_TEAMS_TEAM_ID`, `AGENT_TEAMS_MEMBER` and `AGENT_TEAMS_TASK_ID`, never the server environment.

#### Scenario: Secrets not inherited
- **WHEN** the server environment contains `ANTHROPIC_API_KEY`
- **THEN** the hook child does not see it

#### Scenario: Event variables
- **WHEN** a `TaskCompleted` hook runs for task 3 of member `alice`
- **THEN** `AGENT_TEAMS_EVENT`, `AGENT_TEAMS_MEMBER` and `AGENT_TEAMS_TASK_ID` are set accordingly

### Requirement: TaskCreated and TaskCompleted gates

The plugin SHALL register core op gates for `TaskCreate` and for `TaskUpdate` to `completed`; the core operation SHALL re-validate and commit only after the gate. Exit 2 SHALL fail the call with `hook_blocked` and no state change. Claims and trusted server callers using `skipGates` SHALL NOT run hooks.

#### Scenario: Create blocked
- **WHEN** a `TaskCreated` hook exits 2 with `title must start with a ticket id`
- **THEN** `TaskCreate` fails with `hook_blocked`, the text is returned and no task exists

#### Scenario: State changed during the hook
- **WHEN** the team reaches `maxTasks` while a `TaskCreated` hook runs
- **THEN** the core re-validation fails the create with `task_cap_reached` even though the hook allowed

#### Scenario: Gated call ends inside the lane timeout
- **WHEN** hooks use their whole budget on a `TaskCreate`
- **THEN** the gate answers by the 12 s deadline, so the call commits or fails before the 15 s lane timeout and an agent retry cannot duplicate the task

#### Scenario: Trusted caller skips hooks
- **WHEN** a trusted server caller creates tasks with `skipGates`
- **THEN** no `TaskCreated` hook runs

### Requirement: Gate contention

A second completion of a task whose hook is running SHALL fail with `hook_blocked` and feedback `hook_pending`. A task hook that cannot start before the deadline SHALL fail the call with `hook_blocked` and feedback `hook_busy`, never silently allow it.

#### Scenario: Concurrent completion
- **WHEN** two completions of task 3 race
- **THEN** one waits for the hook and the other fails with `hook_blocked` and feedback `hook_pending`

#### Scenario: Queue starvation is not a pass
- **WHEN** three teammates complete at once, the per-team limit is 2 and the third hook cannot start before the deadline
- **THEN** the third `TaskUpdate` fails with `hook_blocked` and feedback `hook_busy`, the task stays `in_progress` and a retry can run the hook

### Requirement: TeammateIdle gate

The plugin SHALL register a core op gate for the idle report. On exit 2 the member SHALL NOT be marked idle, the lead SHALL NOT be notified, and a `hook_feedback` mail SHALL wake the member. Hooks SHALL NOT run for a `shutdown_pending` member or for an idle that carries an error or abort. A hook that cannot start before the deadline SHALL let the idle through and be counted.

#### Scenario: Feedback keeps the member working
- **WHEN** a `TeammateIdle` hook exits 2 with `write the summary file first`
- **THEN** the member receives a waking `hook_feedback` mail with that text and the lead receives no idle notice

#### Scenario: Shutdown pending skips hooks
- **WHEN** a `shutdown_pending` member settles
- **THEN** no `TeammateIdle` hook runs and core shutdown handling proceeds

#### Scenario: Error idle skips hooks
- **WHEN** a member reports idle with an error
- **THEN** no hook runs and the lead notice carries the error as in core

### Requirement: Idle retry cap and supersession

After `hookMaxRetries` (default 3) consecutive blocks for one member the idle SHALL be accepted and the lead notified; the counter SHALL reset on any accepted idle. An idle superseded by a waking mail during the hook SHALL be dropped.

#### Scenario: Retry cap
- **WHEN** the hook blocks a fourth consecutive time with `hookMaxRetries` 3
- **THEN** the idle is accepted and the lead gets a notice naming the hook

#### Scenario: Superseded idle
- **WHEN** a waking mail reaches the member while its idle hook runs
- **THEN** the idle report is dropped and the member stays busy

#### Scenario: Counter resets
- **WHEN** a blocked member is later accepted as idle
- **THEN** its consecutive-block counter is zero for the next idle

### Requirement: Hook configuration domains

`hookMaxRetries` SHALL be an integer of at least 0 and `hookTimeoutMs` an integer of at least 1; any other value SHALL fall back to its default with a startup warning. `hookMaxRetries` of 0 SHALL mean idle hooks never block.

#### Scenario: Retries disabled
- **WHEN** `hookMaxRetries` is 0 and an idle hook exits 2
- **THEN** the idle is accepted at once and no `hook_feedback` mail is sent

#### Scenario: Invalid retry value
- **WHEN** `hookMaxRetries` is `-1` or `1.5`
- **THEN** the default 3 applies and a startup warning names the setting

### Requirement: Hook trust and freeze

Hooks SHALL come only from a template. User-source hooks SHALL be trusted. Project-source hooks SHALL run only when the project is trusted and a confirmation exists for `realpath(cwd)` plus the SHA-256 of the canonical hook set; otherwise `team.start` SHALL return `hooks_untrusted` with the hash and the commands. The hooks SHALL be copied into the team at start and SHALL NOT be changeable by any tool or route afterwards.

#### Scenario: First start asks
- **WHEN** a trusted project template with hooks is started the first time
- **THEN** `team.start` returns `hooks_untrusted` listing the exact commands and starts nothing

#### Scenario: Confirmed start
- **WHEN** the user confirms the listed commands
- **THEN** the confirmation is stored for that hash and the team starts with the hooks

#### Scenario: Edited hook asks again
- **WHEN** one hook command in the file changes
- **THEN** the hash differs and the next start returns `hooks_untrusted`

#### Scenario: Agent cannot add a hook
- **WHEN** a lead calls any team tool with a `hooks` argument
- **THEN** the argument is rejected or ignored and the team's frozen hooks are unchanged

### Requirement: Hook-set hash and revocation

The hook-set hash SHALL cover event names, command text, command order and the effective `timeoutMs`, and SHALL ignore key order, comments and whitespace. Revoking project trust or a confirmation while a team runs SHALL NOT change that team's frozen hooks; it SHALL only gate later starts.

#### Scenario: Cosmetic edit keeps the hash
- **WHEN** the hooks block is reformatted, commented or its keys reordered without changing commands
- **THEN** the hash is unchanged and no new confirmation is asked

#### Scenario: Behavioural edit changes the hash
- **WHEN** a command's `timeoutMs` or the order of two commands changes
- **THEN** the hash differs and the next start returns `hooks_untrusted`

#### Scenario: Revoked while running
- **WHEN** the project's confirmation is revoked while a team started with those hooks runs
- **THEN** the frozen hooks keep running for that team and the next start returns `hooks_untrusted`

### Requirement: Hash-bound confirmation

`trustHooks` SHALL carry the hash the user was shown. `team.start` SHALL recompute the hash and refuse with `hash_mismatch` unless it equals the current one; only then SHALL it record the confirmation.

#### Scenario: Retry with the shown hash
- **WHEN** `team.start` is retried with `trustHooks` equal to the current hash
- **THEN** the confirmation is recorded and the team starts

#### Scenario: Hook edited between prompt and confirm
- **WHEN** the hook file changes after the prompt and `team.start` is retried with the old hash
- **THEN** it fails with `hash_mismatch`, records nothing and starts nothing

### Requirement: Hook observability

Every hook run SHALL log the event, member, exit code and duration (not stdin or stdout contents) and SHALL increment counters for runs, blocks, errors and timeouts exposed in the team snapshot `stats`. Three consecutive non-blocking errors for one event SHALL produce a non-waking lead notice.

#### Scenario: Counters
- **WHEN** one hook blocks and one times out
- **THEN** `stats` shows one block and one timeout

#### Scenario: Consecutive errors notice
- **WHEN** a `TaskCompleted` hook exits 1 three times in a row
- **THEN** the lead receives one non-waking notice naming the event

### Requirement: Hook confirmation routes

The plugin SHALL expose `POST /api/plugins/agent-teams/hook-trust {cwd, hash}` to record a confirmation and `DELETE /api/plugins/agent-teams/hook-trust?cwd=&hash=` to revoke it, both tier `operate` with the host route-cwd admission. A confirmation SHALL only be recorded for a hash the server currently computes for a trusted project template of that cwd. A revoke without `hash` SHALL remove every confirmation for that cwd.

#### Scenario: Stale hash refused
- **WHEN** the request names a hash that does not match the cwd's current hook set
- **THEN** the route answers `hash_mismatch` and records nothing

#### Scenario: Revoke one
- **WHEN** a confirmation is revoked by cwd and hash
- **THEN** the next start of that template returns `hooks_untrusted`

#### Scenario: Revoke all for a cwd
- **WHEN** the revoke request omits `hash`
- **THEN** all confirmations for that cwd are removed
