## Context

Cold-start recovery decides "was this session running when the host died?" from
`.meta.json` alone: `live:true ∧ status≠"ended" ∧ closedReason≠"manual" ∧ kind≠"automation"`
(`packages/shared/src/session-meta.ts:184`). The `live` marker is stamped eagerly while a
session runs and is expected to be **cleared** by every clean exit. Recovery is therefore
*proof by absence*: nothing cleared the flag ⟹ assume a crash.

Verified state of the exit paths (this repo, today):

| path | code | clears marker? |
|---|---|---|
| `server.stop()` | `server.ts:2278` loop over `listActive()` | yes |
| manual close / force-kill | `session-action-handler.ts:547,693` | yes (`closedReason:"manual"`) |
| dismiss / retract | `server.ts:790` `retractRecoveryCandidate` | yes |
| `POST /api/restart` | `system-routes.ts:542` → `spawnRestart` → `process.exit(0)` | **no** |
| `POST /api/shutdown` | `system-routes.ts:503` → `process.exit(0)` | **no** |
| SIGTERM / SIGINT | *no handler in `cli.ts`* | **no** |
| SIGKILL / power loss | — | no (correct) |

`server.stop()` is reachable from exactly two callers: `idleTimer.setStopFn(server.stop)`
(`server.ts:2320`) and Electron's `before-quit` → `/api/shutdown`. So the marker-clearing
behaviour is anti-correlated with user intent:

```
                          stop() runs?   marker    outcome
  PC restart (idle-stop     YES          cleared   NO offer   ← false negative
    or Electron quit first)
  POST /api/restart          NO          kept      OFFER      ← false positive
  true crash / power cut     NO          kept      OFFER      ← correct
```

`fix-recovery-offer-bridge-liveness-gate` added a two-channel process-liveness gate to
compensate (Class 1 keeper reclaim, `server.ts:1717`; Class 2 bridge reattach,
`server.ts:373`). It is sound in principle but two implementation facts defeat it on the
restart path:

- `RECOVERY_REATTACH_GRACE_MS = 2500` (`server.ts:226`) vs `RESTART_QUIESCE_MS = 5000`
  (`system-routes.ts:136`). `announceRestart` tells bridges to suppress reconnect for 5 s;
  the retraction window closes at 2.5 s and `liveRecoveryCandidates` is then *finalized*.
  Class 2 cannot fire. No test relates the two constants.
- The `ask` offer is **broadcast immediately** and merely made non-actionable until
  `graceUntil` (its `tasks.md` 3.1 records this as a deliberate deviation from the design's
  "defer the broadcast"), so the card is visible on every restart regardless of retraction.
- Its §4 resume-time liveness re-check was marked optional and, per its own `tasks.md`,
  **not implemented** — justified as "eliminated by construction" by the gate, which the
  two facts above invalidate.

## Goals / Non-Goals

**Goals:**
- Replace proof-by-absence with a **positive, closed** record of deliberate exit intent.
- `/api/restart` and `/api/shutdown` never produce recovery candidates — without relying on
  any timing window.
- An idle auto-stop and an OS-initiated shutdown **do** leave sessions recoverable.
- Keep the 07-22 liveness gate as defense-in-depth and make its window arithmetically capable
  of firing.
- Never under-offer relative to today (unknown/absent record ⇒ recovery allowed).

**Non-Goals:**
- Removing the per-session `live` marker or the liveness gate. Both stay; the boot record
  closes the enumeration they sit on.
- Any new user-facing setting. `reopenSessionsAfterShutdown` semantics are unchanged.
- Per-session pick-and-choose within the offer.
- Reliable OS-shutdown-vs-user-quit discrimination inside Electron (see Open Questions).

## Decisions

### D1 — Server-scoped boot record carrying positive exit intent

One file, `~/.pi/dashboard/boot-state.json`, written atomically (tmp + rename):

```json
{ "bootId": 1785136186530, "exitIntent": null, "at": 1785136186530 }
```

- **At startup**, after reading the previous record, write `{ bootId: liveEpoch, exitIntent: null }`.
  `bootId` reuses the existing `liveEpoch` (`server.ts:291`) so sessions already carry their
  owning boot id — no new per-session field.
- **On every deliberate exit**, overwrite `exitIntent` before `process.exit`.
- **A crash never overwrites it** → the record stays `null` → dirty boot.

Why server-scoped rather than per-session: an exit path must write **O(1)**, not O(sessions).
The current `stop()` loop writes N sidecars on the way down and is skipped entirely by the
paths that matter. One atomic rename is cheap enough to run in `/api/restart`, `/api/shutdown`,
and a signal handler.

**Alternative rejected — clear `live:false` per session inside `/api/restart`.** This is what
`fix-recovery-offer-bridge-liveness-gate` considered and dismissed as "insufficient". It *is*
insufficient alone (it misses signals and supervisor kills) and it races the exit with N writes.
The boot record generalises it: one write covers every session, and the signal handler (D4)
covers the paths a per-endpoint fix cannot.

### D2 — Exit-intent → recovery mapping

`ExitIntent = "restart" | "shutdown" | "user-quit" | "idle" | "signal" | null`

The mapping below is governed by **D8** ("suppression requires proof of return"), which
was ratified during implementation and overrides this section's first draft on the
`user-quit` row. Read D8 before reviewing the table — without it the `user-quit: allow`
row reads like a bug.

| intent | recorded by | recovery |
|---|---|---|
| `restart` | `POST /api/restart` | **suppress** — sessions survive via keeper and reattach after the 5 s quiesce |
| `shutdown` | `POST /api/shutdown` (dev reload / force-relaunch) | **suppress** — sessions survive; 60 s quiesce announced, so reattach outlives any grace window |
| `user-quit` | Electron `before-quit` (user-initiated) | **allow** — the quit may have taken the sessions with it; if it did not, they reattach on relaunch and the gate retracts them |
| `idle` | idle timer → `stop()` | **allow** — `stop()` SIGTERMs every spawned pi (`killAll`), so those sessions can never reattach |
| `signal` | new SIGTERM/SIGINT handler | **allow** — OS-initiated (reboot / systemd stop) |
| `null` / absent | crash, SIGKILL, power loss, pre-upgrade | **allow** — the original target case |

The load-bearing distinction: **server-lifecycle intent lives in the boot record; per-session
user intent already lives in `closedReason:"manual"`.** A session the user actually closed is
excluded by `closedReason`, so app-quit and idle-stop do not need to double as "the user
discarded these sessions". That is what lets both `idle` and `user-quit` be *allowed* without
re-introducing nagging.

### D3 — Classification gains one conjunct

```text
recoverable(bootId) = exitIntentFor(bootId) ∉ { "restart", "shutdown" }
                    ≡ exitIntentFor(bootId) ∈ { "user-quit", "idle", "signal", null }

candidate = live === true
          ∧ status !== "ended"
          ∧ closedReason !== "manual"
          ∧ kind !== "automation"
          ∧ recoverable(meta.liveEpoch)          ← NEW
```

`exitIntentFor` resolves a session's `liveEpoch` against a **bounded ring of the last 8 boot
records** (kept in the same file). Rationale: two consecutive dirty boots must not lose a
legitimate offer from the first one, which a single-record "previous boot only" check would
discard. An unknown `liveEpoch` (older than the ring, or absent) resolves to `null` ⇒ allowed,
preserving the never-under-offer property.

Corollary: `stop()` **no longer clears `live` markers**. Clearing was the mechanism being
misused as a signal; intent is now recorded explicitly. Marker consumption on
dismiss / retract / offer-broadcast is unchanged (it enforces "shown once per dirty boot").

**Addendum, measured in the docker harness (task 8.5) — the idle-timer path can never carry a
live session, so `idle`'s allow-row is DEFENSIVE, not the fix for the reported false negative.**
The idle timer only arms when `piGateway.connectionCount() === 0` (`idle-timer.ts:39`). For a
non-ended session the only route to that count is heartbeat timeout (`HEARTBEAT_TIMEOUT`
180 s) followed by a reconnect grace (another 180 s), whose expiry calls
`sessionManager.unregister()` — which eagerly clears that session's `live` marker and sets
`status:"ended"`. Observed exactly: marker intact through t+330 s, `{live:false, ended}` by
t+360 s, `No pi sessions for 15s, shutting down...` immediately after, then
`exit intent recorded: idle`. A relaunch offered nothing, which is CORRECT — that session was
cleanly unregistered before the stop.

Two consequences for this design:

1. The `idle` row still earns its place, but via the RING rather than via its own boot: a
   sidecar left `live:true` by an EARLIER crashed boot survives a later idle stop (because
   `stop()` no longer wipes markers) and is resolved against that earlier boot's `null` intent
   on the next cold start. Removing the clearing loop is what stops one boot's clean stop from
   destroying another boot's crash evidence.
2. The reported false negative ("a PC restart preceded by an idle auto-stop offers nothing")
   therefore cannot originate in the idle-timer path. It originates in the *other* `stop()`
   caller — Electron's app-quit via `/api/shutdown` — and in the unhandled-signal path. Both
   are addressed here: `user-quit` allows recovery (D8) and `signal` is now recorded at all (D4,
   verified live in task 8.6).

### D4 — SIGTERM/SIGINT handler recording `"signal"`

`runForeground()` (`cli.ts:151`) installs no signal handlers, so an OS shutdown kills the
server with no trace. Add handlers that record `exitIntent:"signal"`, `flushAll()`, and exit.
This makes the PC-restart case an *explicit recoverable* exit rather than an accident of
"nothing ran". It also stops SIGTERM from silently skipping `metaPersistence` flushes.

Scope note: the handler must be idempotent and must not fight `spawnRestart`'s
SIGTERM→SIGKILL ladder (`restart-helper.ts:158`) — the restart intent is recorded *before* the
ladder runs, and `exitIntent` is write-once-per-boot (first writer wins) so a subsequent
`signal` cannot overwrite `restart`.

**Prerequisite discovered during live verification (task 8.6): the CLI wrapper swallowed the
signal.** `bin/pi-dashboard.mjs` re-execs the server as a CHILD (it must, to inject the jiti
loader) and handled only the child's `exit`. The wrapper owns `argv[1]`, so `kill <pid>`, a
service manager tracking the CLI pid, and Ctrl-C in a foreground shell all land on the
*wrapper* — which died while leaving the server child orphaned and still serving
`/api/health`. In that topology the handler above could never run, so D4 was inert for the
standalone install (it would only fire under systemd, which signals the whole cgroup). The
wrapper now forwards `SIGTERM`/`SIGINT`/`SIGHUP` to the child and re-raises after the child
exits. Covered by `cli-signal-forwarding.test.ts`, which drives the real wrapper end-to-end
and asserts the boot record reads `"signal"`.

### D5 — Derive the grace window from the quiesce window

```ts
// must outlast the window during which bridges are told NOT to reconnect
const RECOVERY_REATTACH_GRACE_MS = RESTART_QUIESCE_MS + RECONNECT_HEADROOM_MS; // 5000 + 2000
```

Both constants move to one shared module so the relation is expressible, plus a test asserting
`RECOVERY_REATTACH_GRACE_MS > RESTART_QUIESCE_MS`. With D1–D3 the restart path no longer
depends on this window at all; the correction matters for the `signal` / crash paths where
keepers or bridges survive the server.

### D6 — Defer the `ask` broadcast until liveness resolves

Broadcast after the grace window closes, per `fix-recovery-offer-bridge-liveness-gate`'s
design, instead of broadcasting immediately with a non-actionable button. The offer is sticky
and non-timed, so a ~7 s delay is imperceptible; a card that appears and then retracts is the
actual defect. `graceUntil` / the "verifying" resume state remain as a safety net for a client
that connects mid-window.

### D7 — Land the resume-time liveness re-check

`handleResumeSession`'s `continue` path guards on in-memory `status` plus the grace window
(`session-action-handler.ts:288-303`). Add a real keeper/bridge liveness probe so a stale offer
can never double-spawn one `sessionId` (returns `resume.already_active`). Required, not
optional: it is the only guard that holds when an upstream assumption breaks — which is the
exact failure mode this lineage keeps repeating.

### D8 — Suppression requires PROOF OF RETURN, not proof of intent

**Ratified during implementation; overrides the `user-quit` row of D2's first draft.**
The first draft suppressed recovery for `user-quit` on a Chrome analogy ("restore after a
crash, not after a clean quit"). That is an argument about the user's *intent toward the
app*. It is the wrong question, and it re-commits the original sin of this whole lineage:
inferring session fate from something that is not session fate.

The rule instead is: **offer a session only when it can never reattach, and the user did
not close it.** Recovery exists to rescue sessions that are GONE. So:

1. **Suppress only where the sessions are proven to come back.** An exit qualifies only if
   it (a) leaves the pi processes running AND (b) instructs bridges to suppress reconnection
   for LONGER than `RECOVERY_REATTACH_GRACE_MS`. Both conditions together mean the session
   reattaches *after* the only window in which the liveness gate could retract the offer —
   so the offer would be permanently wrong and nothing downstream can fix it. Exactly two
   exits qualify: `/api/restart` (`RESTART_QUIESCE_MS` = 5 s) and `/api/shutdown`
   (`SHUTDOWN_QUIESCE_MS` = 60 s), both vs a 7 s grace window.
2. **Allow where the sessions are proven dead.** `idle` reaches `stop()`, which calls
   `shutdownHeadlessProcesses()` → `headlessPidRegistry.killAll()` → SIGTERM to every
   dashboard-spawned pi process group. Those sessions cannot reattach by construction.
   This is the false-negative half of the reported bug.
3. **Where session fate is UNKNOWN, do not guess — measure.** `user-quit`, `signal` and a
   crash all leave the outcome genuinely undetermined at classification time (detached pi
   children survive on macOS/Linux; a Windows Job Object or an OS reboot kills them). For
   these we allow the candidate and let the existing process-liveness gate decide: keeper
   reclaim (Class 1) and bridge reattach inside the grace window (Class 2) retract anything
   that proves alive, and D7's resume-time probe refuses anything that slips through.

So the boot record answers only the question it can answer soundly — *"is this session's
return already guaranteed and un-retractable?"* — and delegates every ambiguous case to a
mechanism that observes the process rather than reasoning about the human.

Per-session user intent is NOT part of this decision: `closedReason:"manual"` already
excludes sessions the user closed individually, on every path. `user-quit` therefore does
not need to double as "the user discarded these sessions".

**Exit classes and their scenarios** (one per class; the spec delta carries the normative
form of each):

| class | exits | why | scenario |
|---|---|---|---|
| **A — return proven** | `restart`, `shutdown` | sessions alive + quiesce > grace | ▾ A1 |
| **B — death proven** | `idle` | `stop()` SIGTERMs every spawned pi | ▾ B1 |
| **C — fate unknown** | `user-quit`, `signal`, `null` (crash) | detached children may or may not survive | ▾ C1, C2, C3 |

- **A1 — restart:** three sessions running; `POST /api/restart` records `"restart"` and
  exits; bridges are told to hold off 5 s; the replacement server classifies at t≈0 s and
  finds `live:true` on every sidecar. Suppressed by intent ⇒ **no offer**, and the bridges
  reattach normally at t≈5–7 s. Without D8 the grace window (7 s) would be racing the
  quiesce window (5 s) on every restart — the exact race that shipped broken four times.
- **B1 — idle auto-stop:** the idle timer fires, `stop()` SIGTERMs every spawned pi and
  records `"idle"`; the user later relaunches. Nothing can reattach, the markers are no
  longer cleared (D3), so **all three sessions are offered**. Under the old build the same
  scenario cleared the markers and offered nothing — the reported false negative.
- **C1 — user quit, sessions died with the app** (Windows Job Object, or the OS tore the
  tree down): `"user-quit"` recorded; on relaunch no keeper answers and no bridge reattaches
  within the grace window ⇒ **offered**. Suppressing here (first draft) would have silently
  lost the user's work.
- **C2 — user quit, sessions survived** (macOS/Linux, detached pi + keeper): `"user-quit"`
  recorded; on relaunch keeper reclaim finds them alive at t≈0 s and retracts them before
  the deferred broadcast ⇒ **no offer**, no flash. Same input as C1, opposite output,
  decided by evidence rather than by the intent label.
- **C3 — SIGKILL / power loss:** nothing recorded, `exitIntent` stays `null`; on relaunch
  nothing proves liveness ⇒ **offered**. The original target case, unchanged.

**Falsifiability.** A row moves out of "allow" only by demonstrating that its exit satisfies
both clauses of (1) — sessions alive AND a reconnect ban longer than the grace window. If a
future exit path adds a quiesce longer than `RECOVERY_REATTACH_GRACE_MS`, it belongs in
class A. Conversely, if `/api/shutdown`'s 60 s quiesce were ever dropped, `shutdown` would
move to class C and be decided by liveness like everything else.

## Risks / Trade-offs

- **[Boot-record write fails / disk full]** → `exitIntent` unwritten ⇒ treated as dirty ⇒
  over-offer. Fails toward the conservative side (never under-offers). Log the write failure.
- **[Two servers sharing one HOME]** → the record is HOME-scoped like the rest of
  `~/.pi/dashboard/`. One dashboard per HOME is an existing invariant; a second instance would
  interleave `bootId`s. The ring makes this survivable (unknown epoch ⇒ allowed) rather than
  silently wrong.
- **[`user-quit` allows recovery]** → a user who quits the app with sessions running may be
  offered them on relaunch. Bounded by the liveness gate: if the pi processes survived the
  quit, keeper reclaim (Class 1) or a bridge reattach (Class 2) retracts them before the
  offer is broadcast, so only genuinely-dead sessions reach the user. Sessions the user
  closed individually are excluded by `closedReason:"manual"` as before. Cost when the gate
  misjudges: one dismissible card. Benefit: the Electron OS-restart false negative closes,
  since `before-quit` fires for both a user quit and an OS shutdown.
- **[Deferring the broadcast delays a genuine crash offer]** → by `RECOVERY_REATTACH_GRACE_MS`
  (~7 s). Acceptable: the offer is sticky and the alternative is a flashing false card.
- **[`idle` becoming recoverable increases offers]** → an idle-stopped server now offers its
  sessions back. Intended (it is the user's reported false negative); still dismissible and
  still once-per-dirty-boot.

## Migration Plan

None required. The boot record is created on first startup after the upgrade; until then its
absence resolves to `null` ⇒ recovery allowed ⇒ current behaviour. No sidecar schema change,
no protocol change, no config change, no user action. Rollback = revert; a leftover
`boot-state.json` is ignored by older builds.

## Open Questions

- ~~**Should `user-quit` suppress or allow recovery?**~~ **RESOLVED — allow. See D8.**
  Suppression requires proof of return, not proof of intent; a quit does not tell us whether
  the sessions died, so the liveness gate decides (classes B/C in D8).
- ~~**Electron OS-shutdown discrimination**~~ **MOOT** for recovery correctness: since
  `user-quit` now allows recovery, `before-quit` needs no OS-vs-user discrimination — both
  cases land on "let liveness decide". A future platform signal (Windows
  `WM_QUERYENDSESSION`, macOS `NSWorkspaceWillPowerOffNotification`) would only sharpen
  logging.
- **Should `bootId` be a UUID rather than `Date.now()`?** Reusing `liveEpoch` avoids a new
  per-session field, but two boots inside the same millisecond would collide. Practically
  impossible given startup cost; a monotonic counter persisted in the record would remove the
  question entirely.
