# fix-spawn-correlation-ttl-coupling

## Why

`spawnRegisterTimeoutMs` is user-configurable. The two TTLs that decide what
happens *after* it fires are hardcoded to 60 s. Raising the timeout — the
intuitive response to a slow machine — therefore **guarantees** the correlation
token is already dead by the time the watchdog fires.

| Constant | Value | Where |
|---|---|---|
| `spawnRegisterTimeoutMs` | **90 000** (user-set; clamp 5 000–120 000) | `~/.pi/dashboard/config.json`, `packages/shared/src/config.ts:564` |
| `pendingClientCorrelations` TTL | **60 000**, hardcoded | `packages/server/src/pending/pending-client-correlations.ts:15` |
| `RECENTLY_FIRED_TTL_MS` | **60 000**, hardcoded | `packages/server/src/spawn-process/spawn-register-watchdog.ts` |

```
 t=0 ──────── 60s ──────── 90s ─────────────── 150s ────────▶
  spawn        │            │                    │
               │            │                    └─ recovery window ENDS
               │            └─ watchdog fires → timeout banner
               └─ correlation token DIES
```

The correlation is dead in **exactly** the slow-spawn case the watchdog exists
to report. The source comment claims the opposite — *"60s TTL aligned with
`spawn-register-watchdog` recovery window"* — which held only at the DEFAULT
timeout. Nothing re-derives it when the timeout is configured.

### Measured

Isolated dashboard (own `HOME`, ports 8123/9123, `spawnRegisterTimeoutMs:
5000`), probes at the decision sites, a WebSocket client recording browser
frames, and a synthetic bridge registering at a controlled delay. Trials differ
**only** in that delay:

| Trial | register at | `spawn_register_recovered` | `session_added.spawnRequestId` |
|---|---|---|---|
| A | t+10 s (token alive) | **delivered** — banner clears | `synth-o9v4o` — auto-select fires |
| B | t+70 s (token expired) | **never** — banner sticks | **MISSING** — auto-select dead |
| C | t+70 s, `hasUI:false` | never | MISSING, **and `hidden=true`** |

Against a real spawn, the watchdog fired at 5 s and `session_added` arrived
0.1 s later carrying the card — while `spawn_register_recovered` never came.

### Reported symptom, explained

*"Banner clears itself, but no card appears until refresh."* At a 90 s timeout a
register landing after 60 s finds the correlation already dead — **before the
watchdog has even fired** — so `session_added` ships without
`spawnRequestId`; the client's Tier-1 branch in `useMessageHandler.ts:250` never
runs `clearSpawningCwd` + `navigate()`, so the session never opens. A register
landing in 90–150 s is still inside the recovery window, so the banner does
clear. Both halves fall out of the constants above.

### Two defects the same investigation exposed

**Auto-hide reads a `source` that cannot yet be `"dashboard"`** —
`packages/server/src/session/memory-session-manager.ts:141`:

```js
hidden = params.hasUI === false && params.source !== "dashboard"
```

`params.source` is the bridge's self-reported value (`"tui"`), evaluated BEFORE
`decideDashboardSource` stamps `"dashboard"`, and `hidden` is never recomputed.
Trial C ends `source=dashboard` **and** `hidden=true` at once — a dashboard
spawn the guard was written to protect, filtered out of the sidebar by
`filterSessions`. Latent only because dashboard spawns currently report
`hasUI=true`; probes recorded `hasUI=true` and `hasUI=undefined`, never `false`.

**Recovery identity is unreliable.** The watchdog arms with the **keeper** pid
while the bridge registers the **pi** pid, so `_checkRecoveryByPid` cannot
match:

```
[P1] watchdog FIRE  … pid=22484   ← keeper (rpc-keeper/keeper.cjs)
[P1] clear-attempt  … pid=22490   ← pi process
```

The cwd tier is raw-string and missed on `/tmp` vs `/private/tmp`. Only the
token tier works — and the TTL gap above kills it precisely when it is needed.
The watchdog additionally logs **neither its fire nor its recovery** (its one
`console.error` sits in `armSpawnWatchdog` and covers neither path), so neither
appears in `server.log`; `spawn-failures.log` records 50
`REGISTER_TIMEOUT` entries (100 % `headless`, 100 % empty `stderrTail` — pi was
slow, not crashed) with no way to tell which later recovered.

### The same silence, confirmed at two more layers

A later incident (restoring sessions killed by an unscoped `pkill`) reproduced
the defect family twice more. Both share one shape: **an operation reports
success while the work never happens, and no log anywhere records the loss.**

**A resumed bridge can accept nothing while looking perfectly healthy.** Four
sessions were resumed with `POST /api/session/:id/resume {mode:"continue"}`.
Three registered, reported live telemetry in `/api/health` `agents[]`, held an
ESTABLISHED socket to the pi port, and showed `status=active` — and silently
discarded every inbound message:

```
POST /api/session/<id>/prompt   → HTTP 200 {"success":true}
session .jsonl mtime            → UNCHANGED for 30 s+   (pi never saw it)
```

`success:true` only means `piGateway.sendToSession` found an OPEN socket and
wrote to it (`session-api.ts`); it is not an acknowledgement. Every diagnostic
the dashboard exposes is **outbound** (telemetry, RSS, `activeBridgeCount`,
`status`), so a bridge that is deaf inbound is indistinguishable from a healthy
one. Only transcript growth falsifies it. Killing the keeper and re-resuming
cleared it in all three cases.

The mechanism is **not** in the extension — it is
`connections.set(msg.sessionId, ws)` overwriting unconditionally in the gateway
(`pi-gateway.ts:301`), so a second bridge claiming the same id displaces the
first and `sendToSession` reports `true` for the wrong socket. Root-caused
separately in `fix-duplicate-bridge-registration`; the resume path is what
manufactures the duplicate, since nothing checks whether a live bridge already
holds the session id being resumed. Two extension-side candidates considered
here — the serialized inbound pump in `connection.ts` and the session-id guard
in `command-handler.ts` — were both wrong.

One observability point stands regardless: the guard's `console.error` **cannot
be read**, because keeper output capture is opt-in
(`keeperLog.capturePiOutput`, default OFF → `stdio: "ignore"`), so any
extension-side drop goes to `/dev/null`.

**Liveness is never reconciled against reality.** 559 of 639 sessions the
server counted as live were dead — TUI sessions in `/private/tmp` created over
two days a month earlier, killed without an end event, still `status=active`
with no process:

| marked live | real bridges | phantom |
|---|---|---|
| 639 | 8 | **559** |

Retiring them via `/shutdown` (559/559 OK) dropped the live count to 80. Nothing
in the system would ever have corrected this on its own.

## What Changes

- **Both TTLs derive from the configured timeout** instead of hardcoded 60 s, so
  the correlation and recovery windows always outlive the watchdog that
  schedules them. Raising `spawnRegisterTimeoutMs` SHALL NOT disable
  correlation.
- **A late-registering spawn still auto-selects.** `session_added` SHALL carry
  `spawnRequestId` whenever the spawn was client-initiated, for any register
  arriving inside the recovery window.
- **`hidden` is decided from the resolved source.** The auto-hide heuristic
  SHALL evaluate against the server's dashboard-source decision, never the
  bridge's pre-decision self-report; a session SHALL NOT end up
  `source="dashboard"` and `hidden=true` simultaneously.
- **Watchdog cwd identity is made reliable.** Arm/clear SHALL compare cwds
  normalized the same way on both sides. The pid tier is deliberately NOT
  repaired — pi's pid does not exist at arm time, and the token tier runs first
  for every spawn the current code produces, so the tier is unreachable in
  practice; see design D4.
- **Fire and recovery become observable** in `server.log`, and the failure log
  SHALL be able to distinguish a timeout that later recovered from one that
  never did.
- **A dropped inbound message SHALL be recorded server-side.** The bridge
  discarding a message (session-id mismatch, queue overflow, parked pump) SHALL
  surface through a channel that survives `capturePiOutput=false`; today the
  only record is a `console.error` written to `/dev/null` by default.
- **Prompt delivery SHALL be distinguishable from prompt transmission.**
  `POST /api/session/:id/prompt` returning `success:true` currently proves only
  a socket write. Callers SHALL be able to tell "pi accepted it" from "a byte
  left the server."
- **NOT in scope, and why:**
  - *A general client-side reconcile / snapshot-pull channel.* Real, but a
    separate concern: it repairs drift generally, whereas this change removes a
    deterministic defect. Filing separately keeps the fix falsifiable.
  - *`session_updated` for an unknown id being silently dropped*
    (`useMessageHandler.ts:311`) — belongs to that reconcile work.
  - *The double `session_added` whose first frame carries `cwd:""` and
    `source:"unknown"`.* Observed in every trial; worth its own change.
  - *Changing the 5 000–120 000 clamp.* The bug is coupling, not the bounds.
  - *Re-deriving the other `pending*` TTLs.* `pendingAttachRegistry` and
    `pendingResumeIntentRegistry` bound the damage of a FAILED spawn rather than
    waiting for a bridge; lengthening them is a regression, not a fix. Same for
    `pendingResume`, `pendingInitialPrompt`, `pendingWorktreeBase` and
    `pendingGoalLink` — each needs its own analysis. See design D1a.
  - *Reconciling stale `active` sessions against real processes* (the 559
    phantoms). Same family, but it is a liveness-reaper concern rather than a
    spawn-correlation one; it belongs with the reconcile channel above.
  - *The outside-workspace spawn failure* — a session spawned into a cwd
    outside the configured workspaces registers, is disconnected immediately,
    and never reconnects, leaving a card whose every prompt 502s. Reproduced
    twice with a control; filed separately as
    `fix-bridge-mdns-migration-hijack`.

## Capabilities

### New Capabilities

- `prompt-delivery-ack`: `POST /api/session/:id/prompt` SHALL distinguish a
  prompt the bridge acknowledged (delivered) from one merely written to an OPEN
  socket (transmitted).

### Modified Capabilities

- `spawn-correlation`: the client-correlation and fork-registry TTLs SHALL be
  derived from the same configuration read that arms the spawn's watchdog, on
  all three recording paths, rather than from a literal; a register arriving after 60 s SHALL still yield `spawnRequestId` on
  `session_added`; and `hidden` SHALL be decided from the dashboard-spawn signal
  rather than the bridge's self-reported source.
- `spawn-register-watchdog`: the recovery window SHALL be a single named
  constant shared with every TTL derivation; cwds SHALL be normalized on both
  sides; a register SHALL NOT disarm a concurrent same-cwd spawn; fire and
  recovery SHALL be logged with the timeout that actually applied.
- `bridge-message-pump`: a dropped inbound message SHALL be recorded
  server-side, surviving `keeperLog.capturePiOutput=false`.

## Impact

- `packages/server/src/pending/pending-client-correlations.ts` — TTL from config.
- `packages/server/src/spawn-process/spawn-register-watchdog.ts` — TTL from
  config, pid/cwd identity, logging.
- `packages/server/src/pending/pending-fork-registry.ts` — same derivation; its
  30 s is already short at the default timeout.
- `packages/server/src/pi/pi-gateway.ts` — tier-aware clears, so registering one
  spawn stops disarming a concurrent same-cwd spawn.
- `packages/server/src/session/session-api.ts` — removal of the `delivered: true`
  the contended branch cannot know.
- `packages/server/src/session/memory-session-manager.ts` — auto-hide evaluated
  against the resolved source.
- `packages/server/src/lifecycle/dashboard-source-decision.ts` — ordering
  relative to the `hidden` decision.
- `packages/extension/src/` — reporting a dropped inbound message; acknowledging
  a prompt.
- The spawn-correlation and watchdog fixes need **no protocol change**:
  `spawnRequestId` and `spawn_register_recovered` already exist and simply stop
  being dropped. The two observability items **do** add protocol — a
  bridge→server drop report and a prompt acknowledgement — both optional, so an
  older bridge degrades to today's behaviour.
- Default-timeout installs are unaffected in spawn behaviour.

## Discipline Skills

- `systematic-debugging` — the root cause was reached evidence-first
  (probes, recorded frames, A/B/C trials differing in one variable); the fix is
  judged against reproducing Trial A's frames in Trial B's timing, not against
  "spawning feels better".
- `observability-instrumentation` — the watchdog's total silence is why 50
  logged timeouts could not be triaged; fire/recover logging is part of the fix.
- `doubt-driven-review` — the `hidden` ordering change touches session
  visibility for every spawn path; it gets an adversarial pass before it stands.
