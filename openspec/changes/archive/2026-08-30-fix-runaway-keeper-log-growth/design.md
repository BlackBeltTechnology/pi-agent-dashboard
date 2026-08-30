## Context

`keeper.cjs` opens `~/.pi/dashboard/sessions/keeper-<sessionId>.log` with `fs.openSync(logPath, "a")` and never bounds it. When `config.keeperLog.capturePiOutput` is on, the same descriptor becomes pi's stdout and stderr (`stdio: ["pipe", logFd, logFd]`). Measured residue on one developer machine: 17 GB across three files, 99.9 % of `sessions/`.

Three properties of this log make the obvious fixes wrong:

1. **The descriptor is shared across a process boundary.** `stdio: [_, logFd, logFd]` dups `logFd` into the child, which holds an independent reference to the *same open file description*. Rename-and-reopen — the pattern in `model-proxy/request-log.ts` — rebinds only the parent's path lookup; pi keeps writing into the renamed inode. Growth continues, invisibly, into a file nobody is looking at.
2. **The keeper's event loop is on the RPC path.** `writeRpc` gives each connect+write attempt `WRITE_RPC_ATTEMPT_TIMEOUT_MS = 350` ms, 3 attempts (`keeper-manager.ts:200`). Any synchronous work in the keeper measured in hundreds of milliseconds can drop RPC lines to pi. That rules out copying the log at rotation time.
3. **The keeper is CJS-pure.** It imports only Node built-ins — no TS loader, no jiti, no `packages/shared`. Rotation must be `node:fs` alone, and any tunable has to arrive as an env var (the `PI_KEEPER_CAPTURE_PI_OUTPUT` precedent, `process-manager.ts:597`).

Constraints carried in: Windows cannot rename or unlink a file another process holds open. A logging concern must never crash the keeper, stall RPC forwarding, or alter lifecycle. The sweep deletes files irreversibly, so its liveness gate is load-bearing.

## Goals / Non-Goals

**Goals:**
- A stated per-session bound on keeper-log disk usage that holds whether or not `capturePiOutput` is on.
- Rotation that demonstrably still bounds the file while pi is writing through the inherited descriptor — verified by evidence (inode identity + post-rotation child output), not by "the code ran".
- Reclaim pre-existing residue without ever removing a log a live — or still-starting — keeper owns.
- Make keeper-log size visible in `/api/health`, *including* the case where rotation silently isn't working.

**Non-Goals:**
- Changing *what* the keeper logs, or the `capturePiOutput` default (still `false`).
- Preserving log history across a rotation (see D2 — explicitly traded away).
- Compression, remote shipping, or a scheduled background reaper. One startup sweep is the whole maintenance story.
- Touching keeper lifecycle, discovery, socket, or PID sidecar behaviour.

## Decisions

### D1 — Truncate in place. No rename, no reopen, no copy.

At the cap: `fs.ftruncateSync(logFd, 0)`. Nothing else.

`ftruncate` acts on the descriptor, so the inode survives. Both the keeper and the pi child hold `O_APPEND` handles to that same open file description; after truncation each subsequent write recomputes the append offset against the now-zero-length file. Neither writer needs to know rotation happened, and neither has to be signalled, reopened, or restarted.

*Alternatives considered:*
- **Rename + reopen** (the `request-log.ts` precedent): breaks exactly in the capture case that produced the 12.3 GB file — pi keeps writing to the renamed inode. Rejected.
- **Copy-truncate keeping a `.log.1` generation** (the first draft of this design): rejected on three independent grounds. (a) `copyFileSync` of a capped file blocks the keeper's single event loop for 50–200 ms+, against a 350 ms RPC attempt timeout — a logging concern stalling RPC forwarding, which contract-level constraint 3 forbids. (b) The `.1` file has no owner: keeper shutdown unlinks the socket and PID sidecars but never the log, so session churn accumulates one retained generation per dead session — the same unbounded-directory disease, one order down. (c) On ENOSPC the copy fails forever, once per check interval, and rotation never happens — the fix silently reverts on exactly the full disk it exists to prevent, and leaves a partial `.1` behind. Truncate-only removes all three: no copy, no second file, and truncation *frees* space so a full disk self-heals.
- **Piping pi's output through the keeper**: gives clean rotation control but adds backpressure the keeper must drain, makes the keeper responsible for pi's output liveness, and changes the stdio contract `rpc-keeper-sidecar` already specifies. Rejected.
- **External `logrotate`**: not cross-platform, not in the Docker image, invisible to the dashboard. Rejected.

Cost, stated plainly: **rotation discards the window.** After a rotation the log contains only output written since. Nothing reads these files programmatically; a human tailing one keeps the newest output, which is the part that matters mid-debug.

### D2 — 128 MiB cap, zero retained generations

`KEEPER_LOG_MAX_BYTES` defaults to `128 * 1024 * 1024`. With no `.1`, per-session steady-state disk is **one** cap, not two — so the cap is set at twice the earlier draft's to keep the post-rotation debugging window generous, at the same worst-case footprint. Against the observed incident, 128 MiB is ~0.75 % of the 12.3 GB file.

The bound is **steady-state, not instantaneous**: the size is sampled on a cadence (D3), so a burst writer overshoots by `writeRate × KEEPER_LOG_CHECK_INTERVAL_MS` before the next check catches it. The specs state the bound in that form rather than as an absolute SHALL, because an absolute claim is false and would make a correct implementation fail its own contract.

Dated suffixes (`request-log.ts` style) were rejected for the same reason as `.1`, more so: unbounded *generation count* is the same disease as unbounded file size, and `request-log.ts` is itself a live instance of it (it never deletes what it rotates).

### D3 — Two size-check triggers, both throttled, both fully guarded

- In `log()`: at most one `fs.fstatSync(logFd)` per `KEEPER_LOG_CHECK_INTERVAL_MS` (5 s default). Keeps the hot path a timestamp comparison in the common case. With no copy step, a check that fires is an `fstat` plus, at most, an `ftruncate` — two constant-time syscalls whose cost does not scale with file size, unlike the copy variant that killed the first draft. (On a pathological filesystem — FUSE, network, cloud-sync — even a constant-time blocking syscall can be slow; that is a property of the mount, not of this design, and it degrades to the same skipped rotation as any other failure.)
- A `setInterval(...).unref()` timer on the same interval: necessary and non-redundant. With capture on, growth is entirely child-driven; a keeper that logs nothing for an hour would otherwise never look. `unref()` so it cannot keep the process alive past pi's exit.

**Both call sites are wrapped in `try/catch` inside the callback.** This is load-bearing, not defensive habit: the keeper installs `process.on("uncaughtException", …) → shutdown(1)` (`keeper.cjs:128-131`). An unguarded throw from the timer callback would tear the session down — a logging concern altering lifecycle, precisely what the constraints forbid. The `log()` path is guarded for the same reason.

`fstatSync(logFd)` — not `statSync(logPath)` — so the check reads the same object the writes go to, immune to a path swapped or unlinked underneath (see D5's TOCTOU window).

**Load-bearing invariant: every writer holds `O_APPEND`.** `ftruncate` does not reset the shared file offset; correctness after truncation rests entirely on both writers ignoring their offset and appending at EOF. That holds today (the keeper opens `"a"`, the child dups the same description) and is what makes truncation safe without signalling anyone. A future positioned write (`pwrite`, or reopening the log without `"a"`) would carve a sparse hole after a rotation and silently reinstate multi-GB apparent files. Stated here because nothing in the type system enforces it.

### D4 — Windows truncate is a *verify-first* assumption with a fallback, not an assertion

Both reviewers flagged the same hazard: on Win32, libuv opens `O_APPEND` files without `FILE_WRITE_DATA` (append is enforced via `FILE_APPEND_DATA` alone), and `SetEndOfFile` needs `FILE_WRITE_DATA`. If that reading is right, `ftruncateSync(logFd, 0)` throws `EPERM` on every Windows rotation — and a bare "degrade" would mean Windows *never rotates, silently*, which is the exact failure D4 claims to prevent.

So: `ftruncateSync(logFd, 0)` first; on throw, fall back to `fs.truncateSync(logPath, 0)`, which opens its own `O_RDWR` handle (libuv shares read/write/delete, so the keeper's and the child's handles do not block it) and truncates the same inode. If both fail, the rotation is skipped and the condition becomes *observable* rather than silent — see D6's `overCapFiles`.

The fallback SHALL check inode identity before truncating by path (`fstatSync(logFd).ino` vs `statSync(logPath).ino`): D3 rejects path stats precisely because a path can be swapped underneath, and a fallback that truncates a *different* inode would report success while the measured file kept growing.

This must be **verified on a real Windows runner**, not reasoned about: a `qa/tests` case that drives a keeper past a tiny cap and asserts the file shrank. An untested platform claim here is how the original 12.3 GB happened.

### D5 — The sweep truncates. It never unlinks.

This decision was reversed under review, and the reversal is the most important thing in this design.

The draft gated an `unlink` on "no live keeper". Every liveness predicate available to the server is defeatable here, and two of them are defeated by code already in the repo:

- **The sidecar is gone before the sweep reads it.** `discoverExistingKeepers()` SIGTERMs a keeper whose pi is dead and then unlinks `pidFile`, `sockPath`, and `piPidFile` *unconditionally, without verifying the kill took* (`keeper-manager.ts:415-437`). A wedged keeper — the exact case the gate was written for — cannot run its SIGTERM handler, because libuv delivers signals through the event loop it is stuck in. It survives, still holding `logFd`, with every sidecar naming it already deleted. Sidecar-absence therefore does not mean process-absence, and no ordering fixes this: putting the sweep before discovery just trades it for stale sidecars from crashed keepers.
- **The keeper is not the only fd holder.** With capture on, the pi child holds a dup of the same descriptor. If the keeper is SIGKILLed (OOM, `kill -9`), its shutdown path never runs, so it never SIGKILLs pi; the reparented pi keeps writing — the orphan `keeper.cjs:118-127` explicitly documents as real. A keeper-PID-only gate says "dead", and the unlink detaches a live writer.

An unlinked inode with a live writer is the worst reachable outcome in this whole change: the file keeps growing, and it is invisible to every size check, to `readdir`, and therefore to the health stats. Strictly worse than the 17 GB bug, because at least that one could be found with `du`.

So the sweep does not unlink. **It truncates oversized logs to zero** (`fs.truncateSync(p, 0)`), which reclaims exactly the same bytes and is *safe under every liveness misjudgement*: no writer is ever detached, the inode stays reachable by path, and a still-live writer simply continues appending into a now-bounded file that the next sweep and every stats refresh can still see. The failure mode degrades from "invisible unbounded growth" to "lost log content for a session we believed dead" — an acceptable loss for a human debugging aid, and the same loss the keeper's own rotation already takes.

This inverts the draft's rejected alternative. The rejection reasoning ("a zero-byte file for a dead session is noise") weighed tidiness against a catastrophic failure mode, which is not a real trade. Zero-byte tombstones join the 2 762 small files already in that directory totalling 0.1 MB.

The liveness and age conditions are **kept anyway**, demoted from safety gate to politeness: don't destroy a log someone is probably still using. All required to truncate: no live keeper process (PID sidecar → `isProcessAlive`), size ≥ cap, and `mtime` older than `KEEPER_LOG_SWEEP_MIN_AGE_MS` (5 min). Being wrong about any of them now costs log content, not correctness.

Two further gates, both from existing repo convention:
- **Reuse `isUnsafeTestHomeScan()`** (`auth/test-env-guard.ts`), exactly as `cleanupKeeperOrphans` does (`headless-pid-registry.ts:525,556,615`). Vitest runs with a real `HOME`; an ungated readdir+unlink at server boot would delete real files from a developer's `~/.pi/dashboard/sessions` during `npm test`.
- **Match only `keeper-<sessionId>.log`, explicitly excluding `keeper-launch-*.log`** (written by `keeper-manager.ts:253` for bootstrap stderr). A naive `/^keeper-(.+)\.log$/` reads `keeper-launch-<uuid>.log` as session `launch-<uuid>` — always "dead", and counted in the health stats as if it were a keeper log.

Live, or too young, or under cap → left alone. Dead + oversized + old → truncated to zero, never removed. Under-cap dead logs are untouched: they are useful post-mortems and cost nothing.

**Windows note:** truncating by path a file another process holds open is permitted — libuv opens with `FILE_SHARE_READ|WRITE|DELETE` — which is why truncation, unlike `unlink`, does not run into the platform constraint that shaped the rest of this design.

### D6 — Cached stats, plus a `runawayFiles` heuristic that makes silent non-rotation loud

`/api/health` has no `preHandler` guard and is polled, so a `readdir` + N `stat` per request is a filesystem-scan amplifier. Stats are computed by the startup sweep and refreshed lazily at most once per `KEEPER_LOG_STATS_TTL_MS` (60 s), and read into the payload next to `storeTrim` via an explicitly-typed `EMPTY_KEEPER_LOG_STATS` constant — the convention `system-routes.ts:919` already documents for `storeTrim` (an inline zero literal is not type-checked against the shape, so a later added field can be silently omitted).

`keeperLogs` reports `totalBytes`, `fileCount`, `largestBytes`, `reclaimedBytes`, and **`runawayFiles`** — the count of keeper logs at or above **twice** the cap. The keeper cannot report its own rotation failures to the server (separate process, and the failure line goes into a file nobody reads), so this is the only cross-process observable for "rotation is not working here", including the Windows case in D4.

The threshold is `2 × cap`, not `cap`. Because the bound is steady-state (D2), a *healthy* log oscillates through `[cap, cap + rate × checkInterval]` on every refill: at 10 MB/s a 128 MiB log refills in ~13 s, so a `≥ cap` counter would fire on a large fraction of 60 s snapshots for a keeper rotating perfectly — noise in the one observable that exists to catch silent failure, which is worse than no observable.

`2 × cap` is a **heuristic, not a proof**, and the specs say so. It is exceeded by a healthy keeper only when a single check interval carries more than one full cap of output (>25 MB/s sustained for 5 s at the default). That is possible with capture on, so `runawayFiles` is a *lead*, not a verdict; `largestBytes` is the raw number, and a genuinely unrotatable log climbs monotonically into the gigabytes where no honest reading is ambiguous. A deployment that wants a crisper signal lowers `checkIntervalMs`, which narrows the overshoot band directly.

One further false-positive source, stated because it is invisible otherwise: a keeper carries the cap it was **spawned** with. Lowering `maxBytes` while sessions are running leaves long-lived keepers bounding at the old value, which the new threshold may read as runaway until those sessions end.

**One enumeration helper, not two.** The sweep and the stats refresh need the same naming rule, the same cap, and the same test-home gate. Separate call sites on separate schedules with their own regexes will drift, and the stats would then describe a different file set than the sweep acts on. Both go through a single `listKeeperLogs()` helper.

`reclaimedBytes` is **owned by the sweep, not recomputed by the refresh** — reclaimed bytes are by definition no longer on disk, so a naive rescan would zero the field and destroy the evidence the migration plan tells operators to look for.

`keeper-launch-*.log` files are excluded from the sweep but **counted separately** (`launchLogFiles`, `launchLogBytes`). One is opened per spawn with a fresh transport id (`keeper-manager.ts:253`), append-only, never truncated and never unlinked — an unbounded accumulation channel of the same family as the bug being fixed. Bounding them is out of scope here; making them visible is one field and stops the next instance from being another archaeology exercise.

### D7 — The cap and interval are config knobs, not duplicated literals

The keeper is CJS-pure and cannot import the constant, and the sweep needs the same threshold in TS. Hardcoding both is two sources of truth that drift, and leaves tests with no seam (rotation tests would have to write a real 128 MiB).

So the existing `config.keeperLog` block (`packages/shared/src/config.ts:172-185`) gains `maxBytes` and `checkIntervalMs`, plumbed to the keeper as `PI_KEEPER_LOG_MAX_BYTES` / `PI_KEEPER_LOG_CHECK_INTERVAL_MS` at spawn time — exactly the path `capturePiOutput` already takes (`process-manager.ts:597`). One *operator-facing* source of truth, an existing convention, and rotation tests that run in milliseconds instead of writing 128 MiB and waiting 5 s.

**The server-side seam is `KeeperManagerOptions`, not a new `loadConfig()` import.** `createKeeperManager` today takes only `sessionsDir` / `keeperPath` / `nodeBinary` / `platform` and imports no config — that independence is what makes its tests cheap, and the sweep must not spend it. `maxBytes`, `sweepMinAgeMs`, and `statsTtlMs` become optional options with the documented defaults; the composition root passes `loadConfig().keeperLog` values in. Sweep and stats thresholds are therefore read **at server start**, while the keeper's cap is read **at spawn**: two different staleness semantics for one knob, which is exactly the discrepancy the `runawayFiles` note above warns about.

Two consequences the plumbing pulls in, both easy to miss:

- **`parseKeeperLogConfig` must be extended.** It currently returns only `capturePiOutput` and drops unknown keys (`config.ts:815-821`). Without the parse change, an operator setting `keeperLog.maxBytes` sees it silently discarded while `config.json` shows the value they set — a silent misconfiguration, the exact failure class this change's observability exists to eliminate.
- **The new vars must be stripped before spawning pi.** The keeper already does `delete env.PI_KEEPER_CAPTURE_PI_OUTPUT` before the spawn (`keeper.cjs:307`) and `keeper-env.cjs` strips `PI_KEEPER_PI_ARGS` / `PI_KEEPER_PI_CMD`, for the obvious reason: keeper-internal tuning is not pi's business, and pi's env is observable downstream. New keeper-internal vars follow the same rule.

The defaults still appear twice — in `DEFAULT_KEEPER_LOG` and as the keeper's env-unset fallback — because a CJS process with no shared import has nowhere else to get them. That residue is bounded (it only applies when the env is absent, i.e. a hand-run keeper or a test) and is the price of constraint 1, not something D7 eliminates.

## Risks / Trade-offs

- **Rotation silently does nothing while looking correct** (the central risk; why `systematic-debugging` is on this change) → tests must assert *inode identity across rotation* and *post-rotation child-written bytes landing in the live file*, with a real spawned child holding the fd. A "file got smaller" assertion would pass against the broken rename implementation too. On Windows the same claim gets a real-runner qa case (D4), plus `overCapFiles` as the runtime backstop.
- **History is lost at every rotation** (accepted, chosen by the user over a stalling copy) → mitigated by the 128 MiB window; documented at the rotation site in the keeper source.
- **The bound is steady-state, not instantaneous** → a burst writer overshoots by one check interval of output. Stated as such in the specs; lowering `checkIntervalMs` is now a config knob if a deployment needs a tighter bound.
- **A live or still-starting session's log destroyed underneath it** (`doubt-driven-review` target) → structurally bounded by D5: the sweep truncates and never unlinks, so no liveness misjudgement can detach a writer. The residual cost of a wrong gate is lost log content. Still test the false-negative direction — a live keeper with an oversized log, and a fresh log with no sidecar yet, must both survive a sweep untouched.
- **PID reuse can make a dead keeper look alive** (inherited from `isProcessAlive`) → its oversized log is skipped this boot and reclaimed on a later one. Under-reclaiming is the safe direction; accepted.
- **Windows may need the path-truncate fallback on every rotation** → one extra open per rotation, per 128 MiB of output. Irrelevant cost; the risk is only that neither path works, which `runawayFiles` surfaces.
- **A dead session's oversized log is not reclaimed promptly** → the sweep is once-per-boot, and `shutdown()` writes its final lines (`pi exited`, `shutdown`) which refresh `mtime`, so the age gate blocks reclamation for 5 minutes after exit. Effective reclamation = session exit + 5 min + a server start. Accepted: this is a disk-hygiene sweep, not a real-time reaper, and a periodic reaper was explicitly rejected as scope.

## Migration Plan

No data migration. `config.keeperLog.maxBytes` / `checkIntervalMs` are additive with defaults, so an existing `config.json` needs no edit.

The cap applies to keepers **started after** the upgrade. Keepers already running are long-lived by design and survive a server upgrade, so they keep the old unbounded behaviour until their session ends — the server cannot even detect a pre-rotation keeper (no vintage marker). Operational consequence, stated rather than buried: **on a machine already carrying the incident, restart the affected sessions after upgrading.** Their logs are then reclaimed by a startup sweep — but not the very next one: the keeper's own shutdown lines refresh `mtime`, so the file must also age past `KEEPER_LOG_SWEEP_MIN_AGE_MS`. In practice: restart the sessions, then restart the server again ≥5 minutes later, or wait for the next natural server start. `runawayFiles` shows what is still outstanding in the meantime.

Rollback is a straight revert: the log is not a contract surface, no second file is produced, and removing the rotation restores the previous (unbounded) behaviour with no state to unwind.
