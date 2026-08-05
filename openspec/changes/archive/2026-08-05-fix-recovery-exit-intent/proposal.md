## Why

Cold-start recovery has shipped four times (`reopen-sessions-after-shutdown`,
`fix-recovery-offer-undefined-tokens`, `fix-recovery-offer-dismiss-and-phantom-reopen`,
`fix-recovery-offer-bridge-liveness-gate`) and still misfires in **both** directions:

1. **False positive** — a plain `POST /api/restart` offers to reopen sessions that are
   alive and reattaching. Confirmed in the field.
2. **False negative** — a real PC restart offers nothing, because the exit ran through a
   path that pre-cleared the liveness marker.

Both are the same structural defect: the feature infers "the host crashed" from the
**absence of cleanup** (`live:true` still on disk). That inference is only sound if every
deliberate exit clears the marker — and the set of exit paths is open. Today:

| exit path | clears `live` marker? |
|---|---|
| manual close / force-kill | yes (`closedReason:"manual"`) |
| `server.stop()` (idle timer, Electron quit) | yes |
| dismiss (×) / liveness retract | yes |
| `POST /api/restart` | **no** — `process.exit(0)`, never calls `stop()` |
| `POST /api/shutdown` | **no** — same |
| SIGTERM / SIGINT | **no** — no handler exists in `cli.ts` |
| SIGKILL / power loss | no (correct — this is the only true crash) |

Three of the four "no" rows are deliberate shutdowns misread as crashes. Meanwhile
`stop()` — the only marker-clearing path — fires on the *least* intentional exit (idle
timeout), so an idle auto-stop before a reboot silently destroys the recovery signal.

`fix-recovery-offer-bridge-liveness-gate` diagnosed the `/api/restart` cause exactly, then
declared fixing it a non-goal ("insufficient — the liveness gate is the general fix") and
relied entirely on a downstream timing compensator. That compensator is **arithmetically
unreachable on the restart path**: `RECOVERY_REATTACH_GRACE_MS = 2500` closes the retraction
window before `RESTART_QUIESCE_MS = 5000` even permits bridges to reconnect. No test asserts
any relation between the two constants.

## What Changes

- **Invert the signal: record exit intent positively.** Add a durable, server-scoped **boot
  record** (`~/.pi/dashboard/boot-state.json`, atomic tmp+rename, O(1) — not O(sessions)).
  Startup stamps `{ bootId, exitIntent: null }`; every deliberate exit path overwrites
  `exitIntent` before leaving. A crash leaves `null`. "No record of a deliberate exit" becomes
  the single, closed definition of a dirty boot.
- **Classification consults the boot record.** A session is a recovery candidate only when its
  boot's exit intent permits recovery. `restart` / `shutdown` / `user-quit` suppress recovery
  outright, so `/api/restart` can no longer manufacture phantom candidates — with no timing
  dependency at all.
- **Idle auto-stop becomes recoverable** (`exitIntent: "idle"`). The server choosing to stop is
  not the user closing their sessions; per-session intent is already carried by
  `closedReason:"manual"`. Fixes the false-negative half.
- **Add a SIGTERM/SIGINT handler** that records `exitIntent: "signal"` (recovery allowed) and
  flushes. An OS-initiated shutdown becomes a first-class, *recoverable* exit instead of an
  unhandled kill.
- **Fix the grace/quiesce contradiction.** Derive `RECOVERY_REATTACH_GRACE_MS` from
  `RESTART_QUIESCE_MS` so it always exceeds it, with a test asserting the inequality.
- **Stop broadcasting before liveness resolves.** Defer the `ask` broadcast until the grace
  window closes, as `fix-recovery-offer-bridge-liveness-gate`'s design specified (the
  implementation broadcast immediately and gated only actionability — recorded in its
  `tasks.md` 3.1 — which is why a retracted candidate still flashes on screen).
- **Land the resume-time liveness re-check** that `fix-recovery-offer-bridge-liveness-gate`
  left as optional §4 and never implemented. Reopen must refuse a session whose process is
  provably alive, so a stale offer can never double-spawn one `sessionId`.

The per-session `live` marker and the 07-22 liveness gate are **kept** — they remain necessary
for the `signal` / crash paths where keepers survive the server. This change closes the
enumeration underneath them.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `shutdown-session-recovery`: recovery classification SHALL additionally require that the
  boot which owned the session did not record a recovery-suppressing exit intent; the reattach
  grace window SHALL exceed the restart quiesce window; the `ask` offer SHALL NOT be broadcast
  before liveness is resolved; `resume_session continue` SHALL refuse a provably-live session.

## Discipline Skills

- `systematic-debugging` — both symptoms are timing/state dependent; every change gates on a
  red test that reproduces the exact path (restart→cold-start, idle-stop→cold-start) before any fix.
- `doubt-driven-review` — the exit-intent → recoverable mapping is a semantic contract that is
  expensive to change later, and the grace/quiesce inequality is load-bearing; stress-test both
  before they stand.
- `observability-instrumentation` — reopen spawns a real pi and spends tokens; the
  classify / suppress / retract decision and its reason must be logged so a misfire is
  diagnosable from `server.log` alone.
- `review-code` — non-trivial multi-file change across persistence, lifecycle, and protocol.

## Impact

- **Server**
  - `packages/server/src/persistence/boot-state.ts` *(new)* — read/write the atomic boot record.
  - `packages/server/src/server.ts` — stamp the boot record at startup; consult it during
    classification (~303); defer the `ask` broadcast; derive the grace constant (~226); record
    `exitIntent:"idle"` on the `stop()` path (~2278) and stop unconditionally clearing markers.
  - `packages/server/src/routes/system-routes.ts` — `/api/restart` records `"restart"`,
    `/api/shutdown` records `"shutdown"` (or `"user-quit"` when the caller declares it) before
    `process.exit`.
  - `packages/server/src/cli.ts` — install SIGTERM/SIGINT handlers recording `"signal"`.
  - `packages/server/src/browser-handlers/session-action-handler.ts` — resume-time keeper/bridge
    liveness re-check (`resume.already_active`).
- **Electron**: `packages/electron/src/lib/server-lifecycle.ts` — declare `"user-quit"` when the
  quit is user-initiated.
- **Shared**: `packages/shared/src/config.ts` or a new `boot-state` type module — the
  `ExitIntent` union and the intent→recoverable mapping (single source of truth, consumed by
  server + tests).
- **Tests**: new `boot-state.test.ts`; `recovery-exit-intent.test.ts` (restart→no offer,
  idle→offer, crash→offer); a constant-invariant test asserting
  `RECOVERY_REATTACH_GRACE_MS > RESTART_QUIESCE_MS`; extend `recovery-reattach-retraction.test.ts`
  and `recovery-offer.test.ts`.
- **Backward compatible**: an absent boot record (first run after upgrade) is treated as
  "no deliberate exit recorded" → recovery allowed, i.e. exactly today's behaviour. Never
  under-offers relative to the status quo.
- **No new user-facing setting.** `reopenSessionsAfterShutdown` (`off`/`ask`/`auto`) is unchanged.
- **Rebuild path**: server + shared change → `curl -X POST http://localhost:8000/api/restart`
  (jiti, no build). Electron change → Electron rebuild.
