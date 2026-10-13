## Context

See proposal.md (Why) for the observed flaws. Current state that shapes the approach:

- **`cmdStart`** (`packages/server/src/cli.ts:392-447`) asks `isServerRunning(port)` first, then checks only `portConflict`. A healthy dashboard with no `server.pid` falls through to `launchDashboardServer`. An `EarlyExitError` prints "Failed to start". A `PortConflictError` prints "occupied by another service" even when the occupant is this HOME's dashboard.
- **`isServerRunning`** (`packages/server/src/spawn-process/server-pid.ts:65-80`) makes a single 2 s `isDashboardRunning` call and then `removePid()`, even when the pid is alive. This is pinned by `openspec/specs/server-pid-file/spec.md` "Live process but dashboard not responding (recycled PID)".
- **`stop`** (`cli.ts:500-511`) calls `removePid()` unconditionally after `killProcess`, which can return `{ ok:false }` with the pid still alive (`packages/shared/src/platform/process.ts:196-210`).
- **`isDashboardRunning`** (`packages/shared/src/server-identity.ts:71-152`) has three internal outcomes:
  - success;
  - `portConflict`;
  - `refused` (ECONNREFUSED; stripped from the public shape, `:63-69`).

  An `AbortError` timeout and any other fetch error (ECONNRESET, socket hang-up) collapse to a bare `{ running: false }`. The tests pin that exact shape (`packages/shared/src/__tests__/server-identity.test.ts:62,71,...`).
- **`launchDashboardServer`** (`packages/shared/src/server-launcher.ts:300-330`) resolves `{ childPid, reportedPid }`. An early exit with the port-conflict code becomes `PortConflictError`; any other early exit becomes `EarlyExitError` (`:188-195`).
- **Boot order in `server.ts`:**
  - `establishHomeRendezvous` (lock acquire + metadata write) runs at `packages/server/src/server.ts:3143`;
  - the HTTP bind (`listenWithProofFloor`) at `:4121`;
  - `writePid` at `:4122`.

  The lock record therefore exists before the port is bound. A starter that loses the bind has already acquired the lock and written the record. That is the mechanism behind the observed "lock meta points at a dead pid". Rendezvous errors are caught and logged (`server.ts:~3160`).
- **`acquireOrAttach`** (`packages/server/src/lifecycle/home-lock.ts:350-520`):
  - The first `tryAcquire` calls `proper-lockfile.lock({ stale: 10_000 })` with no guard. proper-lockfile steals any lock whose mtime is older than `stale` (`proper-lockfile/lib/lockfile.js:51-85`), and the holder refreshes mtime from a timer. A `SIGSTOP`'d holder therefore loses its lock after 10 s, with no liveness check at all.
  - Default `onCompromised` throws (`lockfile.js:213`), and `home-lock.ts` does not override it.
  - `isLockHolderResponsive` (`:273-300`) maps "pid alive + probe not running" to `dead`.
  - `home-rendezvous.ts` re-runs `acquireOrAttach` periodically in attach mode (promotion, `:126`).
- **Ownership evidence:** `stop` already has read-only ownership evidence in `packages/server/src/lifecycle/stop-ownership.ts` (`peekInstanceId` vs health `instanceId`; lock metadata pid + port). `peekInstanceId(env, piPort)` (`lifecycle/instance-id.ts:115`) needs the gateway port. `cmdStatus(port)` (`cli.ts:889`) receives only the HTTP port today.
- **Lock path:** the lock is rooted on `getDashboardConfigDir()` (`home-lock.ts:152-158`). The Electron reader roots on its own `canonicalHomedir()` (`packages/electron/src/lib/lock-metadata.ts:31-38`). The base specs `home-lock-single-instance` "Canonical HOME resolution" / "Lock and metadata paths" and `instance-coordination` "Per-HOME advisory lock" still say "canonical home".
- **Bridge auto-start:** it never runs `cmdStart`. It health-checks and then calls `launchDashboardServer` directly (`packages/extension/src/server-launcher.ts:131-177`, passing `--port/--pi-port` explicitly).

## Goals / Non-Goals

**Goals:**
- One port classifier for `start` and `status`, with these kinds:
  - `owned`
  - `starting`
  - `unowned-dashboard`
  - `conflict`
  - `unresponsive`
  - `free`
- No CLI path deletes `server.pid` of a live process.
- No lock takeover of a live holder that is unresponsive or still starting, whether by the lock library's mtime staleness or by our own verdict.
- A taken-over holder never deletes its successor's lock directory or metadata.
- `start`, `status` and `stop` share one ownership predicate.
- Spec and code agree on the lock root, restart handoff, port rule, start timeout and pid-write timing.

**Non-Goals:**
- Changing the `stop` sweep or ownership rules. The only `stop` change is to keep the pid file of a process that survived the kill.
- Changing restart-helper code.
- Making `buildConfig` read `DASHBOARD_PORT`.
- Moving `establishHomeRendezvous` after the HTTP bind. It must precede the gateway listen (`server.ts:3133-3140`). The takeover guards below make the early record safe.
- The Electron attach / pre-wizard probes (`packages/electron/src/lib/server-lifecycle.ts:385`, `main.ts:302,335`) keep their own `isDashboardRunning` options. Only the lock reader moves.
- A bridge-side classifier. The bridge's doomed spawn against a frozen server is accepted (see Risks).
- A fencing-token lock library. proper-lockfile stays; D5 works around its in-process `unlock` and its mtime steal.

## Decisions

### D1. `timedOut` on `DashboardStatus`: "no definitive answer"
`isDashboardRunning` returns `{ running: false, timedOut: true }` when no attempt produced a definitive outcome (success, conflict or refusal). That covers AbortError, ECONNRESET and hang-ups. The flag is absent on a refusal.
- *Why:* the classifier and the lock verdict need "held but silent" vs "nothing there". An overloaded loopback often resets rather than timing out.
- *Compatibility:* the field is optional; no consumer reads it today.
- *Required updates:*
  - the pinned exact-shape tests (`server-identity.test.ts:62,71,161,183,204,218,250`);
  - the "deliberately STRIPPED" comment at `server-identity.ts:63-69`;
  - the `lastResult` reconstruction at `:94`.
- *Alternative rejected:* a separate `net.connect` check. It is redundant and races the health probe.

### D2. `classifyDashboardPort(config, deps)`
The module lives in `packages/server/src/lifecycle/` and takes `config = { port, piPort, host }`.
- *Probe:* `isDashboardRunning` with `{ timeoutMs: 2000, retries: 2 }` on `127.0.0.1` and `::1`, run in parallel. When `host` is a specific non-loopback address, that address is probed too. The probe result (pid + health body) is shared with the ownership check, so there is no second fetch.
- *Address precedence:* any dashboard answer beats `free`/`starting`. An `owned` answer beats an unowned one.
- *Worst-case latency:* refusals short-circuit, so a free port costs ≈0. Probes run in parallel, so a silent port costs ≈7 s (3 × 2 s + 2 × 0.5 s), whatever the address count.
- *Ownership:* the exact rule of `stop` (`packages/server/src/lifecycle/stop-ownership.ts:75-110`): health `instanceId` equals `peekInstanceId(env, piPort)`, OR the lock metadata records the reported pid + `httpPort === port`. The predicate is extracted and shared, so `start`, `status` and `stop` can never disagree about the same process. `server.pid` is never ownership proof (PIDs are reused across HOMEs). Message pids come from lock metadata only.
- *Kinds:*

  | Kind | Condition |
  |---|---|
  | `owned` | an owned dashboard answers |
  | `unowned-dashboard` | a dashboard answers, ownership unproven (message: `not owned by this HOME`; does not assert another HOME) |
  | `conflict` | a non-dashboard service answers |
  | `unresponsive` | `timedOut` |
  | `starting` | refused, and the lock metadata has a live pid for this port with `startedAt` within 30 s |
  | `free` | refused, otherwise |

  A stale `server.pid` naming an unrelated live pid does not block `free`.
- *Why `127.0.0.1` and not `localhost`:* on macOS a second instance can bind `127.0.0.1:8000` next to `*:8000` (spike observation, unverified in-repo). `localhost` may resolve to `::1` first and reach a different socket.
- *Read-only:* the classifier reads only; it never writes an instance-id, lock, metadata or pid file.

### D3. PID file is removed only for a dead pid
- `isServerRunning` probes with the D2 budget and calls `removePid` only when `!isProcessAlive(pid)`.
- `stop` calls `removePid` only if the pid is not alive after the kill attempt.
- `server-pid-file` "Server Liveness Detection with Stale Cleanup" is MODIFIED to match.

### D4. "Started" requires the classifier to see the child
The launcher's readiness probe dials `localhost`, which can reach a different socket than `127.0.0.1` (`server-launcher.ts:222,312`). It is the only signal of readiness. The launcher is not changed. After readiness, `cmdStart` runs the classifier with the full budget:
- *`owned` with `pid === childPid`:* "started", exit 0.
- *Anything else:* if `childPid` is still alive, kill it (platform `killProcess`) so no unconfirmed second server is left. Then print the verdict: exit 0 for `owned` / `starting`, 1 otherwise.
- *Early child exit (any code):* a foreground bind failure exits 1 via `main().catch`, and only the recovery path exits 2 (`server-launcher.ts:75-79,188-195`). Every early exit therefore reclassifies once. `owned` / `starting` → that verdict, exit 0 (this covers losing the bind race to a parallel start). Otherwise → launch failure with a log pointer, exit 1.
- *Budget:* pre-launch classification takes ≈0 on a free port (≈7 s on a silent one, which does not launch). Readiness ≤30 s ("Start fails" counts only this). Confirmation ≤7 s.
- *Containers:* `cmdStart` and its child share one PID namespace, so the pids are comparable.

### D5. Lock takeover only through the liveness verdict
proper-lockfile facts this decision rests on:
- the lock is the directory `<lockPath>.lock`, and `lockPath` is a sentinel file that always exists (`lockfile.js:16-18`);
- `unlock()` acts only on locks held in-process and returns `ENOTACQUIRED` otherwise (`lockfile.js:268-292`). The existing `unlock` calls in the steal paths (`home-lock.ts:~463,~495`) are therefore no-ops cross-process, and today's dead-holder reclaim actually works only through `lock()`'s own mtime steal, after 10 s;
- `lock()` clamps `stale` to ≥2000 ms (`:219`), steals any directory older than that (`:51-85`), and its default `onCompromised` throws (`:213`).

1. **We remove the directory, never the library.** `tryAcquire` never calls `lock()` while `<lockPath>.lock` exists; it reports ELOCKED itself. A directory created after our existence check cannot be old enough for the library's internal steal.
2. **Compare-and-remove for dead holders.** On a `dead` verdict, stat the lock directory. Remove it (`fs.rmSync`, recursive) only if its mtime equals the mtime observed before the verdict, then `tryAcquire` with the existing CAS guard (`home-lock.ts:~495-515`). Metadata is replaced only after the new lock is held. A racer that loses the compare simply re-enters ELOCKED.
   - *Why:* dead-holder reclaim becomes immediate and no longer depends on the 10 s staleness. The stat→rm window is microseconds, and the CAS guard catches a racer that slips through.
3. **Missing or corrupt metadata.** After the 500 ms poll, the takeover follows step 2 only if the lock directory's mtime is older than 10 s; a live winner refreshes it every 5 s. Otherwise throw `starting`. This narrows the old residual from "winner stalled > 500 ms" to "winner frozen > 10 s before writing its record". Unreadable metadata still refuses (`home-lock.ts:~440-450`, unchanged).
4. **Compromise disarms, never crashes.** `onCompromised` logs a warning and sets `compromised` on the acquired handle. Once compromised, `releaseOnce` (`home-lock.ts:413-425`) skips both `release()` and `removeMetadata`, because they belong to the successor, and `home-rendezvous` drops the HOME-default role.
5. **Verdict for a live pid.** The probe uses the D2 budget on `127.0.0.1` and `::1`, plus `meta.bindHost` when present (a new optional metadata field, written when the server binds a specific non-loopback host; `meta.url` is always `localhost`, `home-lock.ts:382`).

   | Probe result | Verdict |
   |---|---|
   | match / mismatch | `alive-match` / `alive-mismatch` (as today) |
   | `timedOut` | `alive-unresponsive` |
   | all refused, `startedAt` < 30 s ago | `alive-starting` |
   | all refused, older | `dead` |
6. **Error.** On `alive-unresponsive` / `alive-starting`, throw `InstanceLockUnresponsiveError` (`E_INSTANCE_UNRESPONSIVE`, `{ meta, reason }`). The lock and the metadata are untouched, and the CAS guard treats both as "abandon".
7. **Callers.**
   - Boot rendezvous: the error is caught (`server.ts:~3160`). If the holder still holds the port, the new server then exits on its bind (`:4121`). The holder's records are unharmed.
   - Promotion loop (`home-rendezvous.ts:126`): stays attached and retries on the next tick.
- *Alternative rejected:* reclaiming after N retries. A frozen live server may resume.
- *Alternative rejected:* pid start-time recycling detection. Not portable without native deps.
- *Alternative rejected:* replacing proper-lockfile with a fencing-token lock. Too broad for this change; compare-and-remove plus the CAS guard close the observed paths.

### D6. Electron reader uses the server's root
`packages/electron/src/lib/lock-metadata.ts::getLockMetaPath()` roots on `getDashboardConfigDir()` from `@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js`. Electron already imports shared (`packages/electron/src/lib/health-check.ts:20`). The private `canonicalHomedir()` and the "inlined because shared resolution can't be relied on" note (`lock-metadata.ts:4-6`) are removed. Bundling is verified by the Electron build job.
- *Trade-off:* an Electron process whose `HOME` was overridden no longer sees a dashboard started under the real HOME, and vice versa. This is the same isolation the server applies. A GUI-launched Electron gets `HOME` from launchd (the real home), so there is no change for normal use. No canonical-path fallback, because a fallback would show a dashboard of a different HOME.

### D7. Spec-only reconciliations (no code)
- Restart handoff: SIGTERM, ≤3 s, SIGKILL, then a ≤5 s port wait (`restart-helper.ts:185-211`).
- Usable port: integer 1–65535 (`packages/shared/src/config.ts:1194-1203`). The stale comment at `:1173-1175` gets corrected.
- `buildConfig` does not read `DASHBOARD_PORT` (`cli.ts:191`).
- Start timeout: 30 s (`cli.ts:428`).
- `server.pid` is written after the bind (`server.ts:4122`); the lock metadata before it (`:3143`).
- The lock root and the stale "attach → openBrowser + exit 0" wording are corrected in the MODIFIED base requirements.

### D8. `status` = mDNS hint + classifier verdict
- `cmdStatus({ port, piPort, host })`; the call site passes the full config.
- mDNS records are kept only when `isLocal && port === config.port` and contribute the hostname.
- The verdict and exit code always come from the D2 classifier.
- A matching record whose health is silent prints `running but not responding`, exit 1.

## Risks / Trade-offs

- **`start` against a hung server now exits 1 instead of attempting a launch.** → Intended. The message points to `pi-dashboard stop`.
- **Bridge's injected probe type (`packages/extension/src/server-auto-start.ts:42`) reads only `running`/`portConflict`, so `timedOut` falls through to launch.** → Intentional (non-goal). A comment is added at the call site so the blindness is visible.
- **Bridge auto-start against a frozen dashboard still spawns a doomed child.** → The child's rendezvous hits `E_INSTANCE_UNRESPONSIVE` (logged, no lock damage), then exits on `EADDRINUSE`. Observable: `[home-lock] could not establish the rendezvous` plus the bind failure in `server.log`. Accepted; no lock or pid corruption.
- **Same-HOME dashboard predating `instanceId`, with no lock metadata.** → It reports `unowned-dashboard` (exit 1, no spawn). Nothing is damaged. The message deliberately does not claim "another HOME".
- **Holder frozen for > 10 s between lock acquire and the metadata write.** → It can still be taken over (missing-metadata path, D5.3). Residual; it is far narrower than today's 500 ms.
- **Compare-and-remove race (stat → rm, microseconds).** → The CAS guard re-verifies the record under the new lock, and the loser re-enters ELOCKED.
- **Old server survives SIGKILL (uninterruptible sleep).** → The replacement fails its rendezvous (unresponsive), then exits on its bind. The old server's records are intact. The next restart retries. Spec scenario "Old server survives SIGKILL".
- **The 30 s `starting` grace could hide a crashed-before-bind holder whose pid was recycled within 30 s.** → Negligible; self-heals once the grace expires.
- **Scripts parsing `pi-dashboard status` stdout.** → None found in-repo (Electron and doctor use `isDashboardRunning` directly). The existing "running" and "not running" lines are unchanged; the new lines are additive.

## Migration Plan

- No data migration. Server and CLI changes take effect on restart; the Electron change ships with the next desktop build.
- Rollback: revert the commit. The formats of `server.pid` and the lock metadata are unchanged.
