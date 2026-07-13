# Design — add-goal-session-supervisor

## Context

The dashboard already owns a hardened, generic session-lifecycle **mechanism**,
exposed to every trusted plugin via `ServerPluginContext`. `automation` rides all
of it; `goal` rides a thin slice and reimplements the deprecated cwd-FIFO path.
This change does NOT build new mechanism — it routes goal through what exists and
adds only goal-specific **policy**.

Host mechanism reused as-is (verified in `server-context.ts` + `event-wiring.ts`):
- `ctx.spawnSession(opts)` → returns `spawnToken`.
- Token spawn correlation: `headlessPidRegistry.linkByToken(spawnToken, …)` at
  register; **cwd-FIFO is the host's own legacy fallback** (`See change:
  spawn-correlation-token`).
- `ctx.onSessionEnded` (death rail: `sessionManager.onUnregister` →
  `dispatchPluginSessionEnded`). Automation subscribes; goal will too.
- `ctx.abortAutomationRun({sessionId?, spawnToken?, graceful?})` → hardened kill
  (renamed `abortSpawnedRun` here — see Decision 8).
- `resume_session` / `handleResumeSession` — resume a dead pi conversation.

Goal-side building blocks (kept, extended):
- `GoalRecord.driverSessionId` (`goal-store.ts:57`) — the supervised anchor.
- `goal-budget-guard.decideBudgetHalt` — turn-budget → `/goal pause`.
- `goal-verdict-accumulator` — verdict history on the record.

**Separation of concerns this enforces:** host = session-lifecycle mechanism;
goal plugin = pursuit policy. The prior over-scoped draft muddied this by
reinventing correlation/abort/reaper inside the plugin — all deleted here.

## The unlock: progress-gated everything

Every hard question collapses to one signal:

```
progress = turnsUsed advanced  OR  a new verdict appended
           since this driver spawned
```

- Died **after** progress → transient crash. Resume. Reset all counters.
- Died **before** progress → the only case that counts toward giving up.

A healthy long-running goal can die and resume many times without tripping a
breaker, because each death follows progress. Breakers fire only on genuine
wedging, so thresholds can be generous.

## Supervisor state machine

```
                    GoalRecord: status ∈ {active, paused, done, failed, cleared}
                    driverSessionId · verdicts[] · turnsUsed(cumulative) · respawns[]

  onSessionEnded(driverSessionId):
    goal not active?                        → ignore (done/paused/cleared/failed terminal)
    !autoRespawn?                           → status=paused, reason="session ended"; stop
    within server-restart quiesce window?   → defer; reconcile after window
    crash-loop breaker tripped?             → status=failed, reason="crash loop" (SILENT)
    else:
       madeProgress = turnsUsed↑ OR new verdict since spawn
       if madeProgress:            reset consecutive-no-progress + backoff
       backoff = f(consecutiveNoProgress)  # 5s → 15s → 45s cap
       spawn = poison? fresh(reprime) : --resume(driverSessionId)   # host resume_session
       correlate via host linkByToken(spawnToken)  # NOT goal cwd-FIFO (D5)
       stash spawnToken on record for abort         # (D6)
       record respawns[].push({at, sessionId, reason, madeProgress})

  reaper (60s): active goal, driver hung, no turn advance in maxAge
              → synthesize a no-progress death; run the same path

  clear/pause: ctx.abortSpawnedRun({spawnToken|sessionId}); set terminal status
             BEFORE any respawn can fire; idempotent               (D6)
```

## Decisions

### 1. Resume-first, fresh-fallback on poison
`--resume driverSessionId` preserves the agent's working memory — the whole
point of a long pursuit. The only failure mode is a *poisoned* session that
re-dies on replay (context-window overflow, a tool that always crashes on the
same state, corrupt log). After `K = 2` consecutive **no-progress** resume-deaths
of the same session, stop replaying into the wall: fresh spawn, re-prime with
`/goal <objective>` + a summary built from `GoalRecord.verdicts` so nothing the
dashboard already persisted is lost.

Rejected: always-fresh (throws away all context every death) and always-resume
(infinite crash loop on a poisoned session).

### 2. Two progress-gated breakers
| Breaker | Trips on | Threshold | Action |
|---|---|---|---|
| Poison (per-session) | consecutive no-progress *resume*-deaths | `K = 2` | switch to fresh spawn |
| Crash-loop (per-goal) | consecutive no-progress deaths total | `3 in rolling 5 min` | `status=failed` (silent) |

Exponential backoff `5s → 15s → 45s` (cap) between respawns; **any progress
resets counters and backoff**. Scales match automation's 60s reaper/TTL rhythm.
Breaker verdict is **silent** (chip/board show `✕ Failed · crash loop`; no
notification) — user-confirmed.

### 3. Cumulative budget on the record, not per session
`maxTurns` MUST accumulate on `GoalRecord.turnsUsed` across respawns. If it reset
per session, respawn = infinite turns and `decideBudgetHalt` is defeated.
Verdicts already persist on the record; `turnsUsed` joins them. Budget halt still
routes through the existing `goal-budget-guard`.

### 4. Opt-in per goal, global default, hard caps always on
```
GoalRecord.autoRespawn ← default from GoalPluginSettings.autoRespawnDefault (off)
ALWAYS enforced regardless of flag: cumulative maxTurns budget + crash-loop breaker
```
Autonomous token spend while nobody watches must be explicit. Global default lets
power users flip it once; per-goal override handles exceptions; hard caps bound
even opted-in goals. With the flag off, the supervisor still *finalizes* dead
goals (paused, "session ended") — strictly better than today's wedged `active`.

### 5. Correlation: reuse the host token path, drop the goal cwd-FIFO primary
No new registry. Capture the `spawnToken` `ctx.spawnSession` already returns and
stamp `goalId` keyed by that token through the host's existing token correlation
(`linkByToken`). Delete `pendingGoalLinkRegistry` as the *primary* link path; the
host already keeps cwd-FIFO as the legacy fallback for old clients, so nothing
new is needed for that case. This closes the same-cwd mis-link (gap #1) for free
because the whole dashboard already correlates this way.

### 6. Abort: reuse `abortAutomationRun` (renamed), no new kill path
The hardened kill primitive already exists in `ServerPluginContext` and already
handles both the `spawnToken` pre-register window and the linked `sessionId`,
with a graceful hint. `clear` / `pause` call it, then set terminal status
*before* the next respawn fires. All finalize paths idempotent (mirror
automation). Goal retains the `spawnToken` on the `GoalRecord`'s in-flight state
for the abort call — the only goal-side addition.

### 7. Restart quiesce
On server restart every driver unregisters at once. The supervisor honors the
existing `server_restarting {quiesceMs}` broadcast: defer respawns during the
window, reconcile after (respawn still-active goals whose drivers did not come
back). Prevents a spawn thundering herd.

### 8. Rename `abortAutomationRun` → `abortSpawnedRun`
The primitive is generic (kill any spawned run) but carries an automation name in
the shared runtime. Goal becomes a second caller, so the name lies. Mechanical
rename across `server-context.ts` (type + field), the host wiring in `server.ts`,
and the automation caller. No behavior change. Alternative — leave it and eat the
misnomer — rejected: a shared primitive named after one consumer invites the next
plugin to reinvent rather than reuse (the exact mistake this change corrects).

## Doubt-review corrections (cycle 1: Claude + GPT-5.5, adversarial)
A two-model doubt cycle found the first draft had a self-contradictory invariant,
a wrong implementation layer, and a fictional resume flag. These corrections
SUPERSEDE the conflicting parts of Decisions 1–8 and the proposal.

**S1 — State vocabulary + `respawning` state (fixes C1 self-violation).**
Existing `GoalRecordStatus = "pursuing" | "paused" | "achieved" | "cleared"`
(`shared/src/types.ts`) — NOT `active`/`done`. Use the real names. Add
`"failed"` (breaker) AND `"respawning"` (visible, non-terminal, no-live-driver).
During backoff the goal is `respawning`, not `pursuing` — otherwise C1 ("never
active without a live driver") is violated by our own 5/15/45s backoff window.
Update every match site (`GoalChip`, detail, board, reducers).

**S2 — Supervisor lives in MAIN SERVER, hooks `sessionManager.onUnregister`.**
The goal-*plugin* server cannot reach `GoalStore` (documented in
`goal-verdict-accumulator.ts`). The supervisor is `packages/server/src/goal-supervisor.ts`
beside the accumulator, with direct `GoalStore` + `spawnPiSession` access, and
subscribes to `sessionManager.onUnregister` directly — NOT plugin
`ctx.onSessionEnded`. (Supersedes "subscribe the goal server to ctx.onSessionEnded".)

**S3 — Resume = `spawnPiSession({sessionFile, mode:"continue"})`, not `--resume`.**
There is no `--resume <uuid>` flag; continue mode passes `--session <file>`
(`shared/src/platform/spawn-mechanism.ts`). Resolve `driverSessionId → sessionFile`
via `sessionManager`, then spawn continue-mode. If the file is gone, fall through
to fresh spawn. (Supersedes "--resume driverSessionId".)

**S4 — Stamp `goalId` BEFORE launch, keyed to the spawn token; never cwd for
supervisor spawns.** Recording the token after `spawnSession` returns races a
fast `session_register`. Pass `goalId` INTO the host spawn call so the host
records token→goalId metadata before the process launches; apply it on
`linkByToken`. `linkByToken` only links process→session — goalId stamping is a
SEPARATE concern that must ride the same token. For supervisor spawns, if the
token is missing at register, PAUSE the goal (`stopping_failed`), do NOT cwd-link
(C3). cwd-FIFO stays only as the host's own legacy fallback for *user* spawns.
(Supersedes D5's "delete the registry" phrasing — the goalId path is re-keyed to
the token, not deleted.)

**S5 — Replace the driver explicitly on respawn.** `linkSession` sets
`driverSessionId` only when unset; the dead driver is still set, so a respawn
would link but not become the driver. Add `goalStore.replaceDriver(cwd, id, newSessionId)`.

**S6 — Terminal-first abort + per-goal generation token (fixes C4/C6).**
clear/pause: (1) bump a per-goal `generation` counter and write terminal status
SYNCHRONOUSLY, (2) cancel any pending backoff timer + in-flight spawn promise
(both check `generation` before acting), (3) THEN call the host kill. The
`onUnregister` handler checks `generation` + terminal status first — a death from
our own kill is a no-op, not a respawn trigger (breaks the
kill→onUnregister→respawn loop). If the kill returns `false` (nothing targeted),
set visible `stopping_failed` and suppress respawn — never leave a record
"paused" over a still-running process.

**S7 — Progress = positive turn delta only; buffer it on the record.** The
verdict accumulator appends on first-seen snapshot even at `turnsUsed=0`
(fire-and-forget, FIFO-capped) — unsafe as progress evidence. Progress =
`lastKnownTurnsUsed` strictly increased. Persist `lastKnownTurnsUsed` on the
`GoalRecord` (updated from the snapshot stream) so a snapshot lost in-flight at
crash time doesn't cause a false no-progress classification.

**S8 — Breaker counter derives from persisted `respawns[]`, not RAM.** Survives a
server restart (else C2's hard bound resets on every restart).

**S9 — Reaper gated or cut for v1.** "No turn advance in maxAge" cannot tell
*hung* from *busy on a long tool* — killing a healthy session violates C1. Either
gate on `session.status`/`currentTool` (only reap idle+no-advance), or **cut the
reaper from v1** and rely solely on `onUnregister`. Default: cut for v1.

**S10 — Restart quiesce cut for v1; reconcile on boot instead.** No server-side
deferred-action queue exists and the old server exits before it could reconcile.
Replace with a **boot-time reconcile**: on startup, any `respawning`/`pursuing`
goal whose `driverSessionId` is not live → run the classify path once. Simpler,
no thundering herd, no new broadcast plumbing. (Supersedes D7.)

**S11 — Concrete re-prime format + capability probe (fixes C7).** The primer
only sends `/goal <objective>`. Define a restart prompt = objective + criteria +
cumulative verdict summary + budget/judge, and PROBE `@ricoyudog/pi-goal-hermes`
for resume/cold-start support before enabling auto-respawn; if unsupported,
disable auto-respawn and log. (Sharpens the open question below into a task.)

**S12 — `SILENT` wording dropped.** Per the chosen behavior: no push
notification, but `failed` IS shown on chip/board (that is not "silent"). One
non-spam terminal-failure event is acceptable.

## Doubt-review corrections (cycle 2: GPT-5.5, re-review of the corrected design)
Cycle 2 found the corrections opened new seams. These SUPERSEDE the cycle-1 items
where they conflict.

**P0 (prerequisite, root finding) — the supervisor must OWN durable status +
progress persistence first.** Today `goal-verdict-accumulator.ts` only appends
verdicts; it never writes `GoalRecord.status` back or persists `turnsUsed`. The
entire classify-by-`status` + boot-reconcile + cumulative-budget design is unsound
until a component maintains, from the live `goal_status` stream: durable
`status` transitions (pursuing/paused/achieved), `lastKnownTurnsUsed`,
`totalTurnsUsed`, `lastProgressAt`. Build this FIRST; respawn logic layers on top.

**C2a — Ride the existing death fanout, do not reassign the slot.**
`sessionManager.onUnregister` is a single callback already owned by
`event-wiring.ts`; the supervisor MUST subscribe via the existing
`dispatchPluginSessionEnded` fanout (add a listener), never reassign
`onUnregister`. (Corrects S2.)

**C2b — Boot reconcile needs enumeration + in-flight guard.** `GoalStore` only
exposes `list(cwd)`; add `listAll()`/`scanFiles()`. Persist the in-flight respawn
token+goalId so a restart between launch and register does NOT double-spawn
(reconcile checks the persisted token before deciding a driver is absent).
(Corrects S10.)

**C2c — Correlation metadata must be persisted, not in-memory.** Extend the host
headless/pid registry entry with optional persisted `{goalId}` consumed by
`spawnToken` at register. An in-memory token→goal map dies on restart; a separate
registry violates C5. (Corrects S4.)

**C2d — Spawn is not abortable; mint token before launch + kill-on-stale.**
`spawnPiSession` has no `AbortSignal`. Mint the spawn token BEFORE launch, store
it synchronously, pass it in. If the spawn completes under a stale `generation`
(user cleared meanwhile), the completion handler MUST kill the returned
process/token. (Corrects the "cancel the spawn promise" hand-wave in S6.)

**C2e — Gate all goal signals on the CURRENT driver.** After `replaceDriver`, a
late `goal_status`/death from the old driver must not append verdicts, advance
progress, or trip budget. Gate every goal snapshot + death on
`sessionId === goal.driverSessionId`, and clear the old driver's `goalId` in
`replaceDriver`. (New — introduced by S5.)

**C2f — Turn accounting: pre-launch baseline + unknown-progress class.** Record a
zero `turnsUsed` baseline before launch so a missed first snapshot cannot make a
real turn uncounted (maxTurns evasion). A driver that was streaming / running a
tool and crashed before its next `message_end` snapshot is classified
`unknown-progress` (NOT no-progress) — it does not increment the breaker.
(Corrects S7.)

**C2g — Breaker epoch persisted.** Count only no-progress deaths AFTER
`lastProgressAt`/`breakerEpoch` (both persisted); progress bumps the epoch so
stale pre-reset deaths in `respawns[]` don't count. (Corrects S8.)

**C2h — Abort mutation is one awaited store write before the kill.** "bump
`generation` + set terminal status" is a SINGLE awaited `GoalStore.update` issued
BEFORE the host kill; the death handler re-reads after the mutation, so a death
from our own kill sees the terminal status. (Sharpens S6.)

**C2i — Status union closed end-to-end.** Decide `stopping_failed` vs
`paused` + an `operationState`/`lastError` field. Whichever: update the shared
`GoalRecordStatus` union, REST validation, client `statusMeta` (currently
defaults unknown→"Pursuing"), board filters (currently exclude non-core states),
detail actions, and tests in ONE change. (Closes S1/S12 gaps.)

**C2j — Resume forces headless.** Respawn spawns MUST set `strategy:"headless"`;
if headless RPC is unavailable, disable auto-respawn (goal `/goal` control is only
reliable in dashboard-spawned headless sessions). (Corrects S3.)

## Why not a shared supervision engine (scope boundary)
Tempting DRY move: extract one `SupervisedRunEngine` that both `automation` and
`goal` build on. Rejected for this change. Reasons:

- **Only two real supervisors exist.** Census of who actually *spawns +
  supervises a driver session*: `automation` (the one mature supervisor) and
  `goal` (this change). `flows` looked like a third but is a **passenger** — it
  registers a `flows.run` automation *action* the automation engine dispatches
  and finalizes (`flows-plugin/src/server/automation-actions.ts`), it never spawns
  its own driver. So this is rule-of-three at two: one mature instance + one
  hypothetical is too little to extract a correct abstraction from.
- **The shared part is MECHANISM, and it already lives in the host.**
  spawn + token-correlate (`linkByToken`) + death rail (`onSessionEnded`) +
  `abortSpawnedRun` + resume + restart-quiesce are all in `ServerPluginContext` /
  host wiring. DRY is already satisfied at that layer; this change just routes
  goal through it (D5/D6/D7/D8).
- **The POLICY genuinely diverges.** automation = one-shot, concurrency
  skip/queue/parallel across many keys, finalize-once → `result.md`,
  trigger-driven, retention/prune. goal = single resurrecting driver, progress-
  gated respawn, crash-loop breaker, cumulative budget, verdict history. Little
  shared policy to factor out.
- **Automation's engine is load-bearing and battle-scarred** (every method has a
  `See change:` fix). Refactoring hardened, working code to serve a not-yet-built
  one is high risk for low reward.

**What MIGHT be worth extracting later — not now, and not the policy.** A thin,
policy-FREE `SupervisedRunRegistry` both engines independently need and that is
NOT in the host: a `{ runId → { spawnToken, sessionId, startedAt } }` pending
map with `finalizeOnce(runId)` (idempotent guard = automation's `removePending`),
`pendingForToken/ForSession`, and `reap(maxAge)`. Home: `dashboard-plugin-runtime`.

**Revisit trigger (explicit):** extract that registry ONLY when a THIRD real
supervisor appears, OR goal's bookkeeping ships and diffs near-identical to
automation's. Extract from two real implementations, never one real + one
imagined. Until then, goal builds its own bookkeeping in `goal-supervisor.ts`.

## Open questions (non-blocking)
- `--resume` fidelity: does pi session-resume restore the extension's in-session
  loop state, or only the conversation? If only the conversation, the re-primed
  `/goal` on resume may be needed even in the resume path.
- Reaper `maxAge` value for goals (automation uses 30min default `maxRunAgeMs`).
- `respawns[]` FIFO cap (verdicts use `GOAL_VERDICTS_CAP`; reuse or separate).

## Risks
- **Runaway spend** — mitigated by opt-in default-off + cumulative budget +
  crash-loop breaker + backoff. Primary `doubt-driven-review` target.
- **Invisible autonomy** — mitigated by chip/board respawn+failed state + logs.
  Primary `observability-instrumentation` target.
- **Cross-link under respawn** — mitigated by reusing the host's `linkByToken`
  token correlation (D5); no goal-specific correlation code remains.
