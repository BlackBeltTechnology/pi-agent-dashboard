# goal-supervisor Specification

## Purpose
TBD - created by archiving change add-goal-session-supervisor. Update Purpose after archive.
## Requirements
### Requirement: A visible respawning state covers the no-live-driver window
While a respawn is pending (backoff delay or spawn in flight), the goal SHALL be
in a `respawning` status — a visible, non-terminal state that is NOT `pursuing`.
A goal SHALL NOT remain `pursuing` while it has no live driver. `GoalRecordStatus`
SHALL be extended with `respawning` and `failed`; existing values
(`pursuing|paused|achieved|cleared`) are unchanged.

#### Scenario: Goal shows respawning during backoff
- **WHEN** a driver dies and a respawn is scheduled after a backoff delay
- **THEN** the goal status SHALL be `respawning` for the whole no-live-driver window
- **AND** SHALL return to `pursuing` only once a new driver has registered

### Requirement: Goal driver death is detected and classified
The goal server SHALL subscribe to the session-death signal
(`ctx.onSessionEnded`, fanned from `sessionManager.onUnregister` via
`dispatchPluginSessionEnded`) and, for a session that is the `driverSessionId`
of a `GoalRecord`, classify the ending before acting. A goal already `done`,
`paused`, `cleared`, or `failed` SHALL be treated as terminal (no action).

#### Scenario: Dead driver on an inactive goal is ignored
- **WHEN** a session ends and it is the driver of a goal whose status is `done`, `paused`, `cleared`, or `failed`
- **THEN** the supervisor SHALL take no action
- **AND** the `GoalRecord` SHALL be unchanged

#### Scenario: Dead driver on an active goal is finalized when respawn is off
- **WHEN** a session ends and it is the driver of an `active` goal with `autoRespawn` false
- **THEN** the goal status SHALL become `paused`
- **AND** the pause reason SHALL be `"session ended"`
- **AND** the goal SHALL NOT respawn

### Requirement: Progress-gated auto-respawn keeps active goals pursuing
For a `pursuing` goal with `autoRespawn` true, the supervisor SHALL respawn a
driver on death unless a breaker forbids it. Respawn gating SHALL be driven by
whether the dead driver **made progress** since it spawned, where progress is a
strict increase in `turnsUsed` (a first-seen or `turnsUsed=0` snapshot, or a
fire-and-forget initial verdict, SHALL NOT count as progress). The latest
`turnsUsed` SHALL be buffered on the `GoalRecord` (`lastKnownTurnsUsed`) so a
snapshot lost in flight at crash time does not cause a false no-progress
classification. A death that follows progress SHALL reset the
consecutive-no-progress counter and the respawn backoff.

#### Scenario: Transient death after progress resumes the conversation
- **WHEN** an `active` autoRespawn goal's driver dies after making progress
- **THEN** the supervisor SHALL respawn by resuming the driver via `spawnPiSession({sessionFile, mode:"continue"})` (session file resolved from `driverSessionId`), preserving the conversation
- **AND** the consecutive-no-progress counter and backoff SHALL reset to zero

#### Scenario: Poisoned session falls back to a fresh driver
- **WHEN** a driver dies with no progress twice consecutively on resume (`K = 2`)
- **THEN** the supervisor SHALL spawn a fresh driver instead of resuming
- **AND** the fresh driver SHALL be re-primed with `/goal <objective>` plus a summary derived from `GoalRecord.verdicts`

#### Scenario: Backoff grows on repeated no-progress deaths
- **WHEN** consecutive no-progress deaths occur
- **THEN** the delay before each respawn SHALL follow an increasing backoff (`5s → 15s → 45s` cap)
- **AND** any subsequent death that followed progress SHALL reset the backoff to zero

### Requirement: Crash-loop breaker prevents runaway respawns
The supervisor SHALL fail a goal that dies repeatedly without progress. When a
goal accumulates `3` no-progress deaths within a rolling `5 minute` window, the
supervisor SHALL set the goal `status = "failed"` with reason `"crash loop"` and
SHALL NOT respawn it again. The breaker verdict SHALL be silent (no
notification); it SHALL be surfaced on the goal chip and board only.

#### Scenario: Breaker trips after repeated no-progress deaths
- **WHEN** a goal reaches 3 no-progress deaths within 5 minutes
- **THEN** the goal status SHALL become `failed` with reason `"crash loop"`
- **AND** no further respawn SHALL be attempted
- **AND** no user notification SHALL be emitted

#### Scenario: Progress prevents the breaker
- **WHEN** a goal dies, respawns, and the new driver makes progress before dying again
- **THEN** the no-progress counter SHALL be zero and the breaker SHALL NOT trip

### Requirement: Turn budget accumulates across respawns
The `GoalRecord` SHALL track cumulative `turnsUsed` across every driver
(respawns included). Budget enforcement (`goal-budget-guard.decideBudgetHalt`)
SHALL read the cumulative value so respawns cannot reset or defeat the budget.

#### Scenario: Budget halts despite respawns
- **WHEN** the sum of turns across all drivers of a goal reaches `budget.maxTurns`
- **THEN** the goal SHALL halt (`/goal pause`) even if the current driver's per-session turn count is below the cap

### Requirement: Respawn correlates by a goalId stamped before launch, keyed to the spawn token
A supervisor-spawned driver SHALL be correlated to its `GoalRecord` by a `goalId`
recorded in the host spawn metadata BEFORE the process launches, keyed to the
spawn token the host resolves at register (via `linkByToken`), NOT by consuming
the head of a per-cwd FIFO queue and NOT by recording the token only after
`spawnSession` returns. If a supervisor-spawned driver registers without a
matching token, the goal SHALL be paused/`stopping_failed` rather than cwd-linked.
The goal plugin SHALL NOT introduce a new kill path or a second process-link
registry.

#### Scenario: Same-cwd non-goal session is not mis-linked
- **WHEN** a supervisor respawn is in flight for a goal in cwd `C` and an unrelated session registers in `C` first
- **THEN** the unrelated session SHALL NOT be linked to the goal
- **AND** the goal SHALL link only the session carrying its goal-run token

#### Scenario: Overlapping respawns do not cross-link
- **WHEN** two goals in the same cwd each respawn a driver with overlapping timing
- **THEN** each driver SHALL link to the goal matching its `spawnToken` via the host `linkByToken` path

### Requirement: In-flight respawn is abortable, terminal-status-first, generation-guarded
`clear` and `pause` SHALL stop an in-flight respawn. The supervisor SHALL, in
order: (1) bump a per-goal `generation` counter and write the terminal status
SYNCHRONOUSLY, (2) cancel any pending backoff timer and in-flight spawn promise
(each SHALL check `generation` before acting), (3) call the host kill primitive
(`abortSpawnedRun`, renamed from `abortAutomationRun`) by `spawnToken` (spawn→
register window) else `sessionId`. The death signal produced by that kill SHALL
be a no-op (terminal status already set). If the kill returns `false` (nothing
targeted), the goal SHALL be set to a visible `stopping_failed`/`failed` state
and SHALL NOT respawn — never a terminal record over a still-running process. All
finalize paths SHALL be idempotent.

#### Scenario: Backoff timer firing after clear is cancelled
- **WHEN** a backoff timer or spawn promise resolves after the user cleared the goal
- **THEN** it SHALL observe the bumped `generation` and SHALL NOT spawn or link

#### Scenario: Clear during spawn window kills the process and stops respawn
- **WHEN** a user clears a goal while a respawn is spawning (before register)
- **THEN** the spawning process SHALL be killed by `spawnToken`
- **AND** the goal SHALL become terminal (`cleared`) and SHALL NOT respawn again

#### Scenario: Pause races respawn without double action
- **WHEN** a pause and an automatic respawn are triggered concurrently
- **THEN** exactly one terminal outcome SHALL result and repeated finalize calls SHALL be no-ops

### Requirement: A gated reaper must not kill a busy driver (v1-optional)
Any hung-driver reaper SHALL NOT treat "no turn advance in `maxAge`" alone as
death: a driver actively generating or running a long tool advances no turns yet
is healthy, and killing it would violate C1. A reaper, if shipped, SHALL first
check `session.status`/`currentTool` and reap only an idle driver that also has
not advanced. The reaper MAY be omitted from v1, relying solely on
`sessionManager.onUnregister`.

#### Scenario: Busy driver is not reaped
- **WHEN** a driver has advanced no turns within `maxAge` but is generating or running a tool
- **THEN** it SHALL NOT be reaped

### Requirement: Boot-time reconcile handles server restarts
On server startup the supervisor SHALL reconcile persisted goals: any
`respawning` or `pursuing` goal whose `driverSessionId` is not live SHALL run the
classify path once. This replaces an in-flight quiesce/defer mechanism (the old
server exits before it could reconcile, and no server-side deferred-action queue
exists), and avoids a respawn thundering herd without new broadcast plumbing.

#### Scenario: Orphaned goals reconciled after restart
- **WHEN** the server restarts and a previously `pursuing` goal's driver did not re-register
- **THEN** boot-time reconcile SHALL run the classify path for it exactly once
- **AND** a goal whose driver did re-register SHALL be left `pursuing`

### Requirement: Auto-respawn is opt-in with a global default and always-on caps
Auto-respawn SHALL be controlled by `GoalRecord.autoRespawn`, defaulting from
`GoalPluginSettings.autoRespawnDefault` (default off). The cumulative turn
budget and the crash-loop breaker SHALL apply regardless of the flag.

#### Scenario: Default-off goal only finalizes on death
- **WHEN** a goal is created while `autoRespawnDefault` is off and its driver dies
- **THEN** the goal SHALL be paused (`"session ended"`) and SHALL NOT respawn

#### Scenario: Opted-in goal still bounded by hard caps
- **WHEN** an `autoRespawn` goal exceeds its cumulative budget or trips the crash-loop breaker
- **THEN** it SHALL halt or fail respectively despite `autoRespawn` being on

### Requirement: Supervisor state is visible
The goal chip and board SHALL surface supervisor state: an in-progress respawn
(`↻ Respawning n/m`) and a breaker failure (`✕ Failed · crash loop`). Respawn
attempts and breaker trips SHALL be logged server-side.

#### Scenario: Respawning goal shows respawn state
- **WHEN** a goal is between driver death and the new driver making progress
- **THEN** its chip/card SHALL indicate a respawn is in progress

#### Scenario: Failed goal shows the breaker verdict
- **WHEN** the crash-loop breaker sets a goal `failed`
- **THEN** its chip/card SHALL show the failed state with reason `"crash loop"`

