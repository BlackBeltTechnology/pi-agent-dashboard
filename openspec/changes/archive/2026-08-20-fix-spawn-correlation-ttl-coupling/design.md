## Context

A family of downstream TTLs decides whether a slow spawn is recoverable, and
only the timeout that *schedules* them is configurable:

| Constant | Value | Site |
|---|---|---|
| `spawnRegisterTimeoutMs` | user-set, clamp 5 000–120 000 | `packages/shared/src/config.ts` |
| `pendingClientCorrelations` TTL | hardcoded `60_000` | `pending/pending-client-correlations.ts:15` |
| `RECENTLY_FIRED_TTL_MS` | hardcoded `60_000` | `spawn-process/spawn-register-watchdog.ts:87` |
| `pendingForkRegistry` expiry | hardcoded `30_000` | `pending/pending-fork-registry.ts:16` |

Both are token-keyed and consumed on the same `session_register` path
(`event-wiring.ts:1320`, `:1383`), and neither re-derives from the timeout. The
fork registry is the worse of the two: at **30 s** it has zero slack even at the
*default* timeout, so a fork whose bridge is slow loses its parent placement
today.

Other `pending*` registries have hardcoded TTLs too, and they are **not** the
same defect — see D1a.

**The dominant failure case does not involve the watchdog firing at all.** With
`spawnRegisterTimeoutMs = 90000`, a bridge registering at t+70 s arrives
*before* the fire — nothing kills it, `session_added` is broadcast normally —
but the correlation died at t+60 s, so `spawnRequestId` is absent and the client
never auto-selects. That is the reported symptom, and it is a pure TTL defect.

The after-fire recovery path is secondary and carries a precondition the
original write-up missed: `_fireEntry` calls `_reclaimSpawn`
(`spawn-register-watchdog.ts:255`), which SIGTERM/SIGKILLs the spawn. A register
after the fire is only reachable when that reclaim missed.

Two adjacent defects share the shape *"the operation reports success while the
work never happens, and nothing logs the loss"*: `hidden` computed from the
bridge's pre-decision self-reported `source`
(`memory-session-manager.ts:170-176`), and cwd keys compared as raw strings.

## Goals / Non-Goals

**Goals:**

- Every TTL consumed on the register path outlives the watchdog timeout armed
  for that same spawn, on **every** correlation-recording path (spawn, resume /
  fork, degrade), including after a live Settings change.
- A register arriving before the fire but after 60 s still yields
  `spawnRequestId`. A register inside the recovery window does too.
- `hidden` stops being decided from the bridge's self-reported `source`, with
  the existing `visibilityIntent` / reattach precedence untouched.
- cwds are compared normalized, and a register for one spawn cannot disarm a
  concurrent spawn's watchdog.
- Fire and recovery are visible in `server.log`, with the timeout that actually
  applied, and a recovered `REGISTER_TIMEOUT` is joinable to its fire.
- A dropped inbound bridge message is recorded server-side while the socket is
  up, surviving `keeperLog.capturePiOutput=false`.
- `POST /api/session/:id/prompt` stops asserting a `delivered` it cannot know.

**Non-Goals:**

- A general client-side reconcile / snapshot-pull channel.
- Reaping the stale `active` sessions (the 559 phantoms).
- Changing the 5 000–120 000 clamp.
- Fixing duplicate bridge registration (`fix-duplicate-bridge-registration`) or
  the mDNS migration hijack (`fix-bridge-mdns-migration-hijack`).
- Making the fire-time reclaim more or less aggressive.
- **Making the pid tier work.** See D4 — it is removed from scope deliberately,
  not overlooked.

## Decisions

### D1 — One config read per spawn, feeding both the arm and every TTL

The timeout is read per operation, but not from one place: the spawn handler
takes `loadConfig()` at handler entry (`session-action-handler.ts:545`) and arms
with that value at `:644`, after an `await spawnPiSession` that can span
seconds, while `armSpawnWatchdog` re-reads config internally
(`spawn-register-watchdog.ts:386`) on the resume (`:514`) and degrade (`:458`)
paths. `pendingClientCorrelations` is constructed once at boot with no arguments
(`server.ts:334`).

So a construction-time `ttlMs` does not fix the bug, and a per-record *re-read*
introduces a new one: an operator lowering the setting mid-spawn would arm with
the old value and derive the TTL from the new one.

The rule is therefore **one read per spawn, shared**: the timeout value used to
arm a spawn's watchdog is the same value used to derive every TTL recorded for
that spawn.

```
ttlMs = clamp(timeoutMsUsedForThisArm) + RECOVERY_GRACE_MS + ORDERING_MARGIN_MS
                                          (60_000)            (5_000)
```

This applies at **all three** correlation-recording sites — spawn (`:611`),
resume/fork (`:523`) and degrade (`:469`) — not just the spawn path, and to
`pendingForkRegistry`, which is token-keyed, consumed on the same register path,
and carries the same defect.

`armSpawnWatchdog` performs its own internal `loadConfig()`
(`spawn-register-watchdog.ts:386`) and is what the resume (`:514`) and degrade
(`:458`) paths use, while those handlers hold a *separate* read
(`resumeConfig` `:507`, `degradeConfig` `:452`). Satisfying "one read" therefore
requires threading the handler's value into the arm rather than letting the arm
re-read — a signature change, not a constant swap.

`RECOVERY_GRACE_MS = 60_000` lives in one shared module imported by BOTH the
watchdog (for `recentlyFired` eviction) and every TTL derivation, so no literal
survives at any site.

**`ORDERING_MARGIN_MS` is not decoration.** `record()` and `arm()` do not have a
fixed order — record precedes arm on the spawn path (`:611` before `:644`), and
arm precedes record on the resume (`:514`/`:523`) and degrade (`:458`/`:469`)
paths. `ORDERING_MARGIN_MS` is **5 000 ms** — three orders of magnitude above
the real statement-ordering skew, chosen so the boundary is never in doubt
rather than tuned. With `GRACE` alone, the correlation clock and the recovery-window clock
start at different instants and the correlation can expire δ before the window
closes, producing a `spawn_register_recovered` (banner clears) with no
`spawnRequestId` (no card) — the reported symptom in miniature. The margin makes
the correlation outlive the window under either ordering.

*Alternative — construction-time `ttlMs`.* Rejected: stale the moment the
operator changes the setting.

*Alternative — re-read config at record time.* Rejected: it desynchronizes the
TTL from the arm it must outlive whenever the setting changes mid-spawn.

*Alternative — multiply the timeout (`2 ×`).* Rejected: at the 5 s lower bound
it gives a 5 s recovery window, shorter than today.

### D1a — Which registries are deliberately NOT re-derived

An earlier revision of this design widened the derivation to
`pendingAttachRegistry` and `pendingResumeIntentRegistry` on the assumption that
every `pending*` TTL was the same defect. It is not, and widening them would be
a regression:

- **`pendingAttachRegistry`** — its 60 s exists so "a failed spawn cannot strand
  an intent that would later attach to an unrelated session"
  (`pending-attach-registry.ts:11-13`). The TTL is an *anti-strand* bound.
  Lengthening it enlarges the window in which a dead spawn's intent attaches to
  someone else's session. It is also enqueued *before* `await spawnPiSession`
  (`session-action-handler.ts:557`), so its clock starts a whole spawn duration
  before any arm — a skew no ordering margin covers.
- **`pendingResumeIntentRegistry`** — its 60 s exists so "a failed spawn cannot
  poison a later legitimate reattach"
  (`pending-resume-intent-registry.ts:23-26`), and it is consumed on the
  `onChange` ended→alive transition (`server.ts:473`, `:520`), **not** on
  `session_register`. It is also recorded from server-only paths with no watchdog
  armed at all (`server.ts:2447`, `session-action-handler.ts:269`), where "the
  timeout in force for that spawn" does not exist.

The same reasoning excludes `pendingResumeRegistry`,
`pendingInitialPromptRegistry`, `pendingWorktreeBaseRegistry` and
`pendingGoalLinkRegistry` from this change: each needs its own analysis of what
its TTL is bounding, and a blanket sweep would trade one silent failure for
several. They are recorded here so the omission is deliberate and legible.

A per-entry derived TTL is also a **data-model change** for any registry that
applies one module-level sweep threshold; `pendingForkRegistry` already stores a
per-entry timer, which is part of why it is the one included.

### D2 — Keep the correlation alive; do not move the consume

The consume-and-broadcast already lives in event-wiring's `session_register`
handler (`event-wiring.ts:1320`, broadcast at `:1413`), on a path every late
register still traverses. The watchdog's `clearByToken`
(`spawn-register-watchdog.ts:160-180`) has no access to the correlation map, the
browser gateway, or the broadcast — and must not acquire it.

The only change needed is that the entry is **still there**: the fire must not
delete it, and D1's TTL must not have expired it.

*Alternative — have `clearByToken` consume and broadcast.* Rejected: it starves
the event-wiring consume that actually feeds `session_added`, producing the exact
missing-`spawnRequestId` regression this change removes.

Consequently `spawn_register_recovered` does **not** gain a `requestId` field.
The watchdog cannot know it without reading the correlation map it is forbidden
to touch, and nothing needs it there — `session_added` carries the value.

### D3 — `hidden` stops reading `params.source`; the signal must be plumbed

`memorySessionManager.register` runs in pi-gateway (`pi-gateway.ts:534`) *before*
`decideDashboardSource` runs in event-wiring (`event-wiring.ts:1332`), and that
decision has a side effect — the legacy branch decrements
`pendingDashboardSpawns` (`:1339-1341`). It cannot simply be called earlier.

So the decision is scoped to what is available at register time: the strong
`dashboardSpawned` signal the bridge carries. **That signal is not currently
forwarded**: the `register({...})` call at `pi-gateway.ts:534-556` passes
`source`, `hasUI`, `visibilityIntent` and `registerReason` but not
`dashboardSpawned`, which exists on `msg`. Plumbing it through is part of this
decision, not an implementation detail — changing the expression without it
would read `undefined` and hide *every* dashboard-spawned headless session.

Surrounding precedence is unchanged:

```
reattach && existing  → existing.hidden
visibilityIntent      → honoured as today
otherwise             → hasUI === false && !dashboardSpawned
```

*Alternative — relocate `decideDashboardSource` ahead of `register`.* Rejected
for this change: moving a side-effecting counter across a module boundary is a
restructure with its own blast radius.

*Alternative — recompute `hidden` after the stamp.* Rejected: a second write to
the same field is the drift that produced the bug.

**Known residual, accepted and recorded:** a session resolving to `dashboard`
*only* through the legacy cwd-FIFO branch (`dashboard-source-decision.ts:74-95`)
and reporting `hasUI:false` can still end up hidden. It requires a legacy bridge
that omits `dashboardSpawned`. Carried as an Open Question.

Gets a `doubt-driven-review` pass before it stands.

### D4 — Normalize cwd and stop cross-clobbering; leave the pid tier alone

**cwd normalization** — one shared realpath-based normalizer applied at arm and
at every `clearBy*`, raw-string fallback on any error. Straightforwardly
feasible, and it is the tier that actually misses today (`/tmp` vs
`/private/tmp`).

**The pid tier is explicitly abandoned, not fixed.** Arming with pi's pid is
impossible — `SpawnResult.pid` is the keeper pid
(`process-manager.ts:156-158, 559-561`) and pi's pid reaches the `<sock>.pi-pid`
sidecar only after the keeper spawns pi (`keeper.cjs:377-386`). Reconciling at
clear time was considered and rejected on three counts: the existing mapping
(`keeper-manager.ts:427-454`) is a *destructive* scan that SIGTERMs keepers and
unlinks sidecars; a safe pure lookup would be an O(n) readdir-plus-reads per
miss, on the register hot path; and `clearByToken` runs first
(`pi-gateway.ts:517`), so for every spawn the current code produces the pid tier
is already unreachable. Building a filesystem-scanning fallback for a path that
cannot be hit is cost without benefit.

The arm therefore keeps passing the pid it has, and the pid tier remains a
best-effort legacy fallback. This is recorded so the next reader does not
rediscover the mismatch and assume it was missed.

**Cross-clobbering.** `pi-gateway.ts:517-519` clears by token, then pid, then cwd
**unconditionally**. With two concurrent same-cwd spawns, A registering with its
token cancels A — then the unconditional `clearByCwd` finds B and cancels B's
timer too. Registering A silently disarms B's watchdog: no timeout diagnostic, no
reclaim, if B never registers. A clear that already succeeded on a stronger tier
must not go on to cancel a different spawn's arm.

**`recentlyFired` keying.** `_fireEntry` does `recentlyFired.set(cwd, …)`
(`:235`), so a second fire overwrites the first's recovery entry. Entries are
keyed by token when they have one, and by cwd only when they do not — one index
per entry, so there is no dual-key cleanup to get wrong and no same-cwd
overwrite.

### D5 — Log fire and recovery; log the timeout that applied; join by token

Neither `_fireEntry` nor the recovery emission is logged (the module's one
`console.error` at `:390` is in `armSpawnWatchdog` and covers neither). Both gain
a line naming cwd, pid and token where known, and the recovery line names the
tier that matched.

The persisted failure entry must name the timeout that **actually applied**:
`_fireEntry` already holds `entry.timeoutMs` (the per-arm value) and uses it for
the browser message, but the `appendSpawnFailure` message string interpolates
`this.timeoutMs`, the constructor default — stale after any live Settings change.

Fire entries carry no `spawnToken` (`:245-253`), so a recovery marker would have
no join key: cwd is ambiguous under concurrent same-cwd spawns and pid is absent
for tmux. The fire entry gains the token; the recovery is recorded against it.

### D6 — Report a drop while the socket is up; server records it

The bridge's drop path only calls `console.error`, which lands in `/dev/null`
whenever `keeperLog.capturePiOutput` is false (the default). The bridge reports
the drop over the WebSocket it already holds, and the server records it.

**Scoped to what the drop site can actually distinguish.** The guard at
`command-handler.ts:447-450` sees only `msg.sessionId !== sessionId`; it cannot
tell "never mine" from "was mine, since replaced". Those are therefore **one**
reportable class (session-id mismatch), not two. The second class is bounded
queue overflow.

**The two classes sit in different modules with different access.** The mismatch
guard is inside `command-handler.handle()`, which has no connection reference;
the overflow drop is in `connection.ts`, which does. Plumbing a report channel
to the mismatch site is part of this decision, not an implementation detail.

**The report must not be routed by the session it names.** `pi-gateway.ts:492`
silently drops an inbound message whose top-level `sessionId` maps to a
different connection — exactly the shape of a mismatch report. The dropped
session id therefore travels as payload, never as the routing field. The *disconnect* class (`discardedInboundCount`,
`connection.ts:203-205`) is excluded: when the drop cause IS the socket loss
there is nothing to report over, and the server observes that disconnect itself.

Because `connection.send()` silently buffers when the socket is down
(`connection.ts:190-196`), reporting is gated on a live connection — otherwise a
buffered report would surface after reconnect and misdescribe when it happened.

Reporting is bounded at **10 reports per session per 60 s window** so an
overflow burst cannot amplify into one report per message, and best-effort: reports share the outbound ring that can itself
overflow (`connection.ts:179-200`). The contract is that a drop is recorded
*when the channel permits* — a strong improvement over `/dev/null`, not a
guarantee. The spec must not promise a suppression summary that the same
saturation can eat.

*Alternative — default `capturePiOutput` to true.* Rejected: every session pays
disk I/O for a rare diagnostic, and the record stays in a per-keeper file.

### D7 — Stop asserting a `delivered` the server cannot know

`POST /api/session/:id/prompt` **already returns `delivered: true`**
(`session-api.ts:98-100`) on the contended branch, where it means only "written
to the owner socket". Under any honest reading that is transmission, and the
contended branch is exactly the displaced-bridge case where it is most likely to
be wrong.

The minimum correct change is therefore **subtractive**: that branch stops
asserting delivery. Transmission is reported explicitly, on the mainline path
too — today it returns a bare `{ success: true }` (`:108`), so "written but
unacknowledged" has no field to land in.

Delivery itself requires a bridge acknowledgement. Since the response is not
gated on it, `delivered` cannot appear in the response at all; the acknowledged
state is observable afterwards through the same session event stream the client
already consumes, keyed by a per-prompt handle returned in the response. What
counts as the acknowledgement is defined once and narrowly: the owning bridge
having handed the prompt to pi — not socket receipt, and not turn completion.

**The handle has to make a round trip.** `send_prompt` carries
`{ sessionId, text, images }` today (`session-api.ts:71-75`) and the bridge's
handler never sees a handle, so the handle rides *out* on `send_prompt` and
returns on a new bridge→server ack naming it. Server-side, the ack is accepted
only from the connection that currently owns the id.

**Pending-ack state gets its own bound.** Older bridges never acknowledge and a
session can unregister mid-flight, so unacknowledged entries would accumulate
forever. In a change whose thesis is TTL discipline, that state is evicted on the
same derived window as the correlations (`timeout + GRACE + MARGIN`) and on the
session unregistering.

Older bridges never acknowledge, so a prompt to them stays `transmitted`
forever. They do lose today's `delivered: true` — that field is currently false
advertising, so removing it is the fix, not a regression.

*Alternative — block the response on the ack.* Rejected: it converts every
prompt into a round trip and makes a slow bridge look like a failed one.

## Risks / Trade-offs

- **[Threading one config read through three handler paths]** → More plumbing
  than a single-site change, but it is the only shape that survives a live
  Settings change; a per-site re-read was tried on paper and desynchronizes.
- **[Widening the TTL derivation to fork/attach/resume-intent registries]** →
  Larger blast radius than the headline fix. Justified: they are consumed on the
  same register path, and the fork registry's 30 s is already short at the
  default timeout, so leaving it would ship a change that fixes spawns and not
  forks.
- **[`realpath` at arm and clear touches the filesystem synchronously]** → A hung
  mount stalls the loop. Bounded to once per spawn and once per register; falls
  back to the raw string on any error.
- **[Arm-resolved vs clear-raw mismatch]** → If the path is created or deleted
  between arm and clear, the two sides normalize differently and the cwd tier
  misses. Token tier unaffected; accepted.
- **[Making the clear path tier-aware changes cancellation semantics]** → Today's
  unconditional cascade is simpler but demonstrably cancels the wrong spawn's
  watchdog. The narrower rule is the point.
- **[Scoping `hidden` to `dashboardSpawned` leaves the legacy-FIFO residual]** →
  Recorded as an Open Question with its precondition stated.
- **[Drop reports can themselves be dropped]** → Best-effort by contract; the
  spec must not overclaim.
- **[Removing `delivered: true` is a visible API change]** → It is currently
  asserted on a branch that cannot know it. Callers reading it are being misled
  today; `success` is untouched. One concrete caller does break and must be
  updated with the change: `contention-resume-guard-api.test.ts:232` asserts
  `body.delivered === true` against exactly this branch.
- **[The cwd normalizer applies to the watchdog only]** → `pendingDashboardSpawns`
  and the `headlessPidRegistry` cwd-FIFO still key raw cwd, so one register can
  match the watchdog and miss them. Narrower than normalizing every cwd key space
  at once, and the token tier is unaffected; recorded rather than fixed here.
- **[`dashboardSpawned` is sent only when true]** → The bridge omits the field
  rather than sending `false` (`bridge.ts:2563`), so absent and false are
  indistinguishable and a dropped `true` hides the session. The signal is also
  untrusted input and needs the same normalization `hasUI` and `visibilityIntent`
  already get (`pi-gateway.ts:546-553`).
- **[The failure log is append-only NDJSON with rotation]** → "Record the
  recovery against the fire" is implementable only as an appended companion
  record joined by token, and rotation can separate the two. Accepted: the join
  key is still strictly better than today's nothing.

## Migration Plan

`spawnRequestId` and `spawn_register_recovered` already exist and simply stop
being dropped — D1/D2/D3/D4/D5 are protocol-neutral. **D6 and D7 do add
protocol**: a bridge→server drop report, a prompt acknowledgement, and a
per-prompt handle, all requiring `packages/shared` type additions. Older bridges
send neither and must degrade cleanly (no drop record; prompts stay
`transmitted`), so the server treats both as optional.

`delivered: true` disappears from the contended prompt response — the one
deliberate response-shape change, and the correction of a false claim.

No data migration and no config change. Installs on the default timeout see
identical spawn behaviour. Rollback is a straight revert.

## Open Questions

- Should the legacy cwd-FIFO `hidden` residual (D3) be closed by relocating
  `decideDashboardSource` ahead of `register`, or left until legacy bridges age
  out?
- Is a never-recovered `REGISTER_TIMEOUT` retained in `spawn-failures.log`
  indefinitely, or eventually pruned?
- Do the four registries excluded in D1a (`pendingResumeRegistry`,
  `pendingInitialPrompt`, `pendingWorktreeBase`, `pendingGoalLink`) each warrant
  their own analysis, and should that be one follow-up change or four?
