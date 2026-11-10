# Design

## Context

Line numbers refer to `origin/develop` at planning time.

- `register()` stamps `spawnedAt: Date.now()` right after spawn. It deletes the
  entry on the child's `exit` (`headless-pid-registry.ts:404,412-415`). A live
  entry therefore never outlives its process.
- `cleanupOrphans()`:
  - reloads persisted entries with `isProcessAlive` only (`:651`);
  - kills entries older than 7 days by pid (`:661`);
  - reclaims the rest with a dummy `EventEmitter` handle that never emits `exit` (`:674`).
- `piPid` is recorded by:
  - `linkByToken`, from `session_register.pid` (`:429`);
  - the keeper sidecar fill (`:612-625`).

  `relinkByKeeperPid` (`:501`) has no production caller.
- `killEntry` (`:306-360`):
  - `killProcess(piPid)`, then a fire-and-forget 200 ms
    `killProcessGroup(keeperPid)` (`:323-336`);
  - for non-keeper entries, `killProcess(entry.pid)`.

  `killAll` sends `killPidWithGroup(pid, "SIGTERM")` to every entry key (`:555-566`).
  It is called via `shutdownHeadlessProcesses` (`browser-gateway.ts:508,3022-3023`)
  from `server.ts:5488`.
- Keeper discovery (`keeper-manager.ts:446-476`) reads the keeper pid sidecar. When
  that pid is alive and pi is dead, it sends `killPidWithGroup(keeperPid, "SIGTERM")`
  (`:459`), based on liveness alone. It surfaces the pi sidecar pid when that pid
  is alive (`:471-472`).
- The keeper writes its pid sidecar right after binding its socket, and the pi
  pid sidecar right after spawning pi (`keeper.cjs:432,459`). Each sidecar's mtime
  is therefore an upper bound on that process's start time. The keeper never
  respawns pi (`keeper.cjs:157,402-404`).
- `processStartedAt(pid)` (`process.ts:141`):
  - Linux: `/proc` + `btime`;
  - elsewhere: `ps -o lstart=` (1 s granularity);
  - win32 / failure: `null`.
- The terminator (`session-terminator.ts:119-187`) calls `registryRung` → `killBySessionId`.
  It then resolves `pid = session.pid ?? registryPid`. Its identity guard runs only
  when `pid === session.pid && pid !== registryPid` (`:186`). It relies on
  `IDENTITY_TOLERANCE_MS = 2000` (`:31`).

## Decisions

### D1 — Restored entries are verified in the registry; the terminator honours the verdict

`HeadlessEntry` gains a non-persisted `restored: true`, set only by `cleanupOrphans`.
Live entries skip every check.

The registry's session-kill path returns an outcome:
`"signalled" | "no-entry" | "refused-identity"` (with the diagnostic). It is a new
method `killBySessionIdChecked(sessionId, { verifyIdentity })`. `killBySessionId`
keeps its boolean contract for the operator callers.

`registryRung` uses the checked variant. On `refused-identity` the ladder returns
`refused-identity` immediately, with no escalation. A refused pid is therefore
never signalled through `escalate()`'s unguarded `pid === registryPid` branch,
which closes cycle-1 finding A1. The session is reported as a failed reclaim and
is not retried, the same as a terminator refusal.

### D2 — Verifier: one-sided, anchored

`verifyRestored(pid, anchorMs, opts)` returns `"match" | "gone" | "mismatch" | "unverifiable"`:

1. `signalZero(pid) === "esrch"` ⇒ `gone`.
2. `start = await probe(pid)`; `null` ⇒ `unverifiable`.
3. `start ≤ anchorMs + tol` ⇒ `match`, else `mismatch`.

The check is one-sided, as in the terminator. A recycled pid can only start after
the original died, so a lower bound adds no safety. It would also add false
mismatches on a wall-clock step, because Linux `btime` moves with the clock.

The anchors, with `tol = IDENTITY_TOLERANCE_MS`:

| pid | anchor |
|---|---|
| spawn-time pid (keeper, or legacy non-keeper pi) | `spawnedAt` |
| `piPid` with `piLinkedAt` | `piLinkedAt` |
| `piPid` without a stamp (legacy file) | `spawnedAt + W`, with **W = 60 s**. The keeper starts pi once. |
| keeper pid in keeper discovery | mtime of the keeper pid sidecar |
| pi pid in the sidecar fill | mtime of the pi pid sidecar |

An anchor that cannot be determined is `unverifiable` (G5): a non-finite
`spawnedAt`, an unparseable `piLinkedAt`, or a sidecar `stat` that fails. A
`piLinkedAt` in the future is clamped to now, so a skewed stamp cannot widen the
window.

`probe` is an injectable async function. Each call is bounded by 2000 ms (G6); a
timeout is `unverifiable`. Its default is
`async (pid) => processStartedAt(pid)`, which is null on win32. #913
(`add-windows-process-identity`, task 2.3) replaces it with
`(pid) => probeProcessStart(pid, {kind:"host"})`.

### D3 — `piLinkedAt`: the moment the pi pid was proven live

`linkByToken` records `piPid` from a live bridge's `session_register` (the token
tier, an identity-bearing resolution). At that instant pi is alive and is that
process. Any process that later reuses the pid started after pi died, and so
after the link.

The registry persists `piLinkedAt = Date.now()` synchronously. It does no probe,
so there is no stamp race (cycle-2 finding: a probe after the link could stamp a
recycled pid's start). The check `start ≤ piLinkedAt + tol` is the terminator's
own `pidRecordedAt` rule.

The sidecar fill records a sidecar pid only when
`verifyRestored(pid, mtime(piPidFile))` is `match`, and then sets
`piLinkedAt = mtime`. A mismatched sidecar pid is never recorded, which prevents
the clear → refill loop.

### D4 — Outcomes per site

The key rule is "U-attended": `unverifiable` is refused on **unattended** paths
and signalled on **operator** paths (D5).

| Site | match | gone | mismatch | unverifiable |
|---|---|---|---|---|
| `cleanupOrphans` reclaim (spawn pid) | reclaim | drop | reclaim, marked `identityRefused`; logged | reclaim |
| `cleanupOrphans` 7-day kill (spawn pid) | kill | drop | drop, no signal; logged | no signal; reclaim |
| `killEntry`, piPid rung | signal | skip | skip; clear `piPid` + `piLinkedAt`; logged | per D5 |
| `killEntry`, spawn-pid rung (non-keeper / no pi) | signal | skip | skip; logged | per D5 |
| `killAll` on server stop (spawn pid, keeper group) | signal | skip | skip; logged | signal only for exit intent `shutdown` / `user-quit` / `restart`; a null or absent intent is unattended (G1) |
| keeper discovery, orphan-keeper SIGTERM (keeper pid vs pid-sidecar mtime) | signal | skip | skip, leave the sidecars; logged | skip |
| keeper discovery, registration (keeper + pi alive) | register | not registered; sidecars removed | treated as dead: not registered, no signal, sidecars left; logged (G4) | register (liveness only, as today) |

The 200 ms keeper-group timer re-probes the keeper pid when it fires (G3):
- `mismatch` ⇒ skip (the only proof of a foreign process);
- `unverifiable` ⇒ per D5: fires on an operator path, skipped on an unattended one;
- `match` ⇒ fires;
- `gone` ⇒ still fires `killProcessGroup(keeperPid)`. It is a no-op when the group
  is gone, and a live pgid cannot be reused while members exist. This keeps the
  shipped *Orphaned pi children are reaped after the keeper exits* behaviour.

An `identityRefused` entry's spawn-time pid is never signalled, on any path. That
includes the keeper group: a refused keeper pid is never group-signalled, even when
the pi pid matched (G7). The pi rung alone runs.

`linkByPid` skips `identityRefused` entries in every tier (G8): a refused entry's
pid belongs to a different process, so a pi that merely holds that pid must not
own it. `linkByToken` still links a refused entry, because the spawn token is
identity-bearing. It records a live `piPid` with a `piLinkedAt` anchor, so the pi
rung can then verify and signal it. The spawn-time pid stays refused. The entry is
re-evaluated at the next restart.

**Partial outcome.** `killBySessionIdChecked` returns `signalled` when at least
one rung's pid matched and was signalled. For example, the keeper matched while
the `piPid` mismatched: the keeper group is killed and the pi refusal is logged.
It returns `refused-identity` only when no pid of the entry could be signalled.
The terminator stops its ladder only on `refused-identity`.

Every refusal logs:
`[headless-pid-registry] identity <outcome> pid=<p> kind=<spawn|pi|keeper> session=<id|->`

### D5 — `unverifiable`: refused when unattended, allowed for operators (Q1)

This mirrors `force-kill-handler`, where operator shutdown and force-kill are not
subject to the identity requirement:
- The unattended paths refuse: the terminator with `verifyIdentity`, the 7-day
  kill, and keeper discovery.
- The operator paths signal: `handleForceKill`, `shutdownSession`
  (`verifyIdentity: false`), and `killAll` when the stop's `ExitIntent`
  (`packages/shared/src/boot-state.ts:18`) is `shutdown`, `user-quit` or `restart`.
- An idle auto-stop (`idle`, `server.ts:5575`), `signal` or `ephemeral` stop is
  unattended.
- Token reclaims (`killByToken`, the terminator's `reclaimByToken`, the watchdog,
  automation stop) are unattended. `killEntry` takes an explicit `verifyIdentity`,
  which defaults to unattended.

A proven `mismatch` is never signalled on any path. On an operator path the
refusal is not a success (G2): `killBySessionId` returns `false`, and force-kill
returns `success:false` with a message naming the identity reuse. Today `unverifiable` occurs
only on win32, so Windows headless sessions restored after a restart can still be
stopped by the operator. #913 removes most of this branch.

### D6 — Residual race

The verdict is taken immediately before the first signal. The 200 ms keeper-group
timer fires after `await killProcess(piPid)` (up to 2 s). It re-probes the keeper
pid when it fires and skips on `mismatch` (D4, G3). The SIGTERM → 2 s →
SIGKILL ladder inside `killProcess` / `killProcessGroup` is not re-verified. The
residual window is a pid that dies and is recycled within that ladder. This is the
same residual the terminator and live entries already accept. It is stated in the
spec rather than claimed as covered.

### D7 — Async probe, `killAll` becomes async

`killAll(): Promise<void>` works as follows:
- it snapshots the entry keys;
- it verifies restored entries concurrently, bounded by the 2 s probe timeout, by a
  5 s total verification budget (G6), and by the platform probe limiter once
  `add-windows-process-identity` lands (at most 2 in flight on Windows). A probe or
  budget timeout is `unverifiable`; a rejected probe never rejects `killAll`;
- it signals;
- it deletes only the snapshotted keys.

`exitIntent` is `ExitIntent | null`; a null or absent value is unattended (G1), so
an omitted intent never widens kill rights. `stop()` already defaults the recorded
intent to `idle`.

The signature change ripples to
`BrowserGateway.shutdownHeadlessProcesses({ exitIntent }): Promise<void>`
(`browser-gateway.ts:508,3022`) and to its caller `server.ts:5488`. That caller
passes `stop()`'s `exitIntent` and awaits. `killAll` keeps the
`killPidWithGroup(pid, "SIGTERM")` primitive (`headless-pid-registry.ts:562`); the
spec scenario is reworded to match the code. Existing
tests are updated. The `isUnsafeTestHomeScan` guard (`:556`) is kept.

## Decisions from the scenario-design gate

All accepted. Q1 and Q2 are confirmed as written in D2/D5.

- **Q1** `unverifiable` is refused on unattended paths, allowed on operator paths (D5).
- **Q2** The legacy `piPid` window is `spawnedAt + 60 s` (D2).
- **G1** `killAll({ exitIntent })`: null or absent ⇒ unattended (D7).
- **G2** An operator path hitting a registry mismatch ⇒ `killBySessionId` returns `false`; force-kill returns `success:false` naming identity reuse (D5). The `force-kill-handler` blocks are not edited here, because `add-windows-process-identity` also modifies them; the behaviour is a `headless-spawn` scenario.
- **G3** The 200 ms timer: skip on `mismatch`, `gone` still group-kills, `unverifiable` follows D5 (D4). Task 2.8 is corrected.
- **G4** A mismatched keeper pid is treated as dead for registration (D4 table).
- **G5** Unparseable or missing anchor ⇒ `unverifiable`; a future anchor clamps to now (D2).
- **G6** Probe timeout 2 s; `killAll` budget 5 s; timeout ⇒ `unverifiable`; a rejected probe never rejects `killAll` (D2, D7).
- **G7** A refused keeper spawn pid is never group-signalled, even if pi matched (D4).
- **G8** `linkByPid` skips `identityRefused` entries (D4).

## Not in scope

- `isProcessLikePi` command-line checks. Start time is the stronger signal.
