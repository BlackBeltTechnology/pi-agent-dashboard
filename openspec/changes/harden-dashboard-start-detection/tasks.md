## 1. Probe primitive (shared) — design D1

- [x] 1.1 Write the `timedOut` partition test in `packages/shared/src/__tests__/server-identity.test.ts`, extending that file's fetch-stub cases (test-plan #E20). Triple: fetch stub per case (AbortError ×3, ECONNRESET ×3, ECONNREFUSED, 200 foreign JSON, 200 health) · `isDashboardRunning(P, h, {retries:2})` · `{running:false,timedOut:true}` for abort/reset, no `timedOut` key on refusal, `portConflict:true` for foreign, `{running:true,pid}` for health. Update the existing exact-shape assertions (`:62,71,161,183,204,218,250`) to the new contract. Verify the test fails before 1.2.
- [x] 1.2 Add optional `timedOut?: boolean` to `DashboardStatus` in `packages/shared/src/server-identity.ts`. Set it when no attempt was definitive; fix the `lastResult` reconstruction (`:94`) and rewrite the "deliberately STRIPPED" comment (`:63-69`). Verify that 1.1 passes and that the extension and Electron typechecks pass (`npm run typecheck` or `tsc --noEmit` per package).
- [x] 1.3 Write the usable-port boundary test in `packages/shared/src/__tests__/config.test.ts`, extending its `resolveDashboardPorts` cases (test-plan #E21). Triple: `DASHBOARD_PORT` ∈ {"8000.5","-1","0","65536","70000","1","65535"}, config port 8001 · `resolveDashboardPorts(env,{port:8001})` · invalid → 8001, "1" → 1, "65535" → 65535. Then correct the stale "finite and > 0" comment at `config.ts:1173-1175`. Verify the test passes (code already conforms).

## 2. PID file (server) — design D3

- [x] 2.1 Write the live-pid-kept test in `packages/server/src/__tests__/server-pid.test.ts`, following that file's pid-path fixtures (test-plan #E16). Triple: `server.pid` = live pid, probe stub always `{running:false,timedOut:true}` · `isServerRunning(P)` · returns null, `server.pid` byte-identical. Verify the test fails on current code.
- [x] 2.2 Write the dead-pid cleanup regression test in `server-pid.test.ts` (test-plan #E17). Triple: `server.pid` = exited child pid · `isServerRunning(P)` · null, file removed.
- [x] 2.3 Change `isServerRunning` (`packages/server/src/spawn-process/server-pid.ts`) to probe with `{timeoutMs:2000, retries:2}` and remove the file only when `!isProcessAlive(pid)`. Verify that 2.1 and 2.2 pass.
- [x] 2.4 Write the failed-kill test in `packages/server/src/__tests__/cli-stop.test.ts`, following its injected `StopDeps` (test-plan #E18). Triple: `readPid`=4242, `isProcessAlive` true before and after, `killProcess` → false · `cmdStop` · `removePid` not called. Verify the test fails on current code.
- [x] 2.5 Write the stale-pid stop regression test in `cli-stop.test.ts` (test-plan #E19). Triple: `readPid` = dead pid · `cmdStop` · `removePid` called once, line begins `Dashboard server is not running`.
- [x] 2.6 In `cmdStop` (`packages/server/src/cli.ts:~500-511`), call `removePid` only when the pid is not alive after the kill attempt. Verify that 2.4, 2.5 and the existing `cli-stop.test.ts` / `cli-stop-real.test.ts` pass.

## 3. Lock takeover (server) — design D5

- [x] 3.1 Write the unresponsive-holder test in `packages/server/src/__tests__/home-lock.test.ts`, following its `AcquireHooks` (`probeHealth`, `isProcessAlive`) fixtures (test-plan #X3). Triple: lock held by holder A, meta pid live, httpPort P, probe always times out · second `acquireOrAttach` · rejects `E_INSTANCE_UNRESPONSIVE` reason `timeout`, `<lockPath>.lock` exists, meta byte-identical.
- [x] 3.2 Write the past-stale-window test in `home-lock.test.ts` (test-plan #X4). Triple: `<lockPath>.lock` mtime = now-60s (`utimesSync`), meta pid live, probe times out · `acquireOrAttach` · rejects `E_INSTANCE_UNRESPONSIVE`, dir and meta unchanged.
- [x] 3.3 Write the holder-still-starting test in `home-lock.test.ts` (test-plan #X5). Triple: meta `{pid: live, startedAt: now-5s}`, probe refused on both loopbacks · `acquireOrAttach` · rejects reason `starting`, dir and meta unchanged.
- [x] 3.4 Write the recycled-pid reclaim test in `home-lock.test.ts` (test-plan #X6). Triple: meta `{pid: live unrelated, startedAt: now-120s}`, all probes refused · `acquireOrAttach` · `mode:"acquired"`, new meta pid = `process.pid`.
- [x] 3.5 Write the `bindHost` verdict test in `home-lock.test.ts` (test-plan #X7). Triple: meta `{pid: live, startedAt: now-120s, bindHost:"10.0.0.5"}`, loopbacks refused, bindHost probe answers matching identity · `acquireOrAttach` · `mode:"attach"`, lock not reclaimed.
- [x] 3.6 Write the immediate dead-holder reclaim test in `home-lock.test.ts` (test-plan #X8). Triple: `<lockPath>.lock` mtime = now, meta pid dead · `acquireOrAttach` · `mode:"acquired"` in one call, with no wait for the 10 s window; meta pid = `process.pid`.
- [x] 3.7 Write the compare-and-remove race test in `home-lock.test.ts` (test-plan #X9). Triple: dead holder recorded, two concurrent `acquireOrAttach` via `Promise.all` · both resolve · exactly one `acquired`, the other `attach` or `E_INSTANCE_UNRESPONSIVE`/`starting`; final meta identity = the acquirer's; lock dir exists.
- [x] 3.8 Write the fresh-lock missing-metadata test in `home-lock.test.ts` (test-plan #X10). Triple: `<lockPath>.lock` mtime = now, no meta · `acquireOrAttach` · rejects reason `starting`, dir present.
- [x] 3.9 Write the stale-lock missing-metadata test in `home-lock.test.ts` (test-plan #X11). Triple: `<lockPath>.lock` mtime = now-30s, no meta · `acquireOrAttach` · `mode:"acquired"`, meta written for `process.pid`.
- [x] 3.10 Write the compromised-holder release test in `packages/server/src/__tests__/home-lock-release.test.ts`, following its release fixtures (test-plan #X12). Triple: A acquires, takeover simulated (A's dir removed, B acquires + writes meta), A's `onCompromised` fires · A calls `release()` · no throw / no uncaught exception, B's dir and meta byte-identical.
- [x] 3.11 Write the unreadable-metadata regression test in `home-lock.test.ts` (test-plan #X13; POSIX skip on win32). Triple: meta chmod 000 · `acquireOrAttach` · rejects with an error naming the meta path, lock dir untouched.
- [x] 3.12 Write the `bindHost` metadata read test in `home-lock.test.ts` (test-plan #E23). Triple: meta JSON without and with `bindHost:"10.0.0.5"` · `readMetadataDetailed` · both `status:"ok"`, second exposes `bindHost`.
- [x] 3.13 Implement D5 in `packages/server/src/lifecycle/home-lock.ts`:
  - no `lock()` while `<lockPath>.lock` exists;
  - compare-and-remove on the dir mtime, then `tryAcquire` with the CAS guard;
  - missing/corrupt metadata stolen only when the dir mtime is > 10 s old;
  - `onCompromised` logs and sets `compromised`; a compromised `releaseOnce` skips `release()` and `removeMetadata`;
  - `isLockHolderResponsive` returns `alive-unresponsive` / `alive-starting` (30 s grace) and probes `127.0.0.1`, `::1` and `meta.bindHost` with the D2 budget;
  - `InstanceLockUnresponsiveError` (`E_INSTANCE_UNRESPONSIVE`, `{meta, reason}`);
  - optional `bindHost` written by `buildMeta` when the bind host is specific and non-loopback.

  Verify that 3.1–3.12 and the full existing `home-lock*.test.ts` suites pass.
- [x] 3.14 Write the promotion-tolerance test in `packages/server/src/__tests__/home-rendezvous.test.ts`, following its attach-mode fixtures (test-plan #X14). Triple: attach-mode rendezvous, `acquireOrAttach` stub rejects `E_INSTANCE_UNRESPONSIVE` each tick · 3 promotion ticks · mode stays `attach`, no record written, no unhandled rejection.
- [x] 3.15 Make `packages/server/src/lifecycle/home-rendezvous.ts` treat `E_INSTANCE_UNRESPONSIVE` as "stay attached, retry next tick", and drop the HOME-default role when its acquired handle reports `compromised`. Pass `bindHost` through from the server config. Verify that 3.14 and the existing `home-rendezvous.test.ts` pass.
- [x] 3.16 Run the `doubt-driven-review` skill on the D5 implementation diff (shared by the CLI, bridge-spawned servers and Electron attach) before moving on. Verify that the findings are reconciled and noted in the PR description.

## 4. Port classifier (server) — design D2

- [x] 4.1 Write the ownership-parity test in a new `packages/server/src/__tests__/classify-dashboard-port.test.ts`, modelled on `stop-ownership.test.ts` (test-plan #E7). Triple: 4 combos (instanceId match/mismatch × lock-meta pid+port match/no) · classifier and the `stop-ownership` predicate on the same fixtures · identical verdicts, owned iff either matches.
- [x] 4.2 Write the both-loopbacks test in `classify-dashboard-port.test.ts` (test-plan #E9). Triple: `127.0.0.1` refused, `::1` answers owned · `classifyDashboardPort` · kind `owned`; stub invoked for both addresses.
- [x] 4.3 Write the single-attempt-on-refusal test in `classify-dashboard-port.test.ts` (test-plan #E10). Triple: every address refused · `classifyDashboardPort` · each address probed exactly once, zero sleep calls.
- [x] 4.4 Write the silent-port budget test in `classify-dashboard-port.test.ts` with an injected `_sleep` and a fake clock (test-plan #P1). Triple: every attempt AbortError on 3 addresses · `classifyDashboardPort` · 3 attempts and 2 sleeps per address, run in parallel, ≤ 7 s fake-elapsed; kind `unresponsive`.
- [x] 4.5 Write the starting-grace test in `classify-dashboard-port.test.ts` (test-plan #E5). Triple: lock meta `{pid: live, httpPort: P, startedAt: now-29s}`, P refused · classifier · kind `starting`, pid = meta.pid.
- [x] 4.6 Write the starting-grace boundary test in `classify-dashboard-port.test.ts` (test-plan #E6). Triple: same with `startedAt: now-31s` · classifier · kind `free`.
- [x] 4.7 Extract the ownership predicate from `packages/server/src/lifecycle/stop-ownership.ts` (no behaviour change for `stop`). Add `classifyDashboardPort(config, deps)` in `packages/server/src/lifecycle/` with the kinds `owned` / `starting` / `unowned-dashboard` / `conflict` / `unresponsive` / `free`. It is read-only and takes message pids from lock meta only. Verify that 4.1–4.6 and the existing `stop-ownership.test.ts` / `cli-stop*.test.ts` pass.
- [x] 4.8 Add rows for the classifier module to `packages/server/src/lifecycle/AGENTS.md`, and update the `stop-ownership.ts`, `home-lock.ts`, `home-rendezvous.ts` and `server-pid.ts` rows in their directory `AGENTS.md` files. Verify the rows exist with `See change: harden-dashboard-start-detection`.

## 5. `start` / `status` CLI — design D4, D8

- [x] 5.1 Write the conflict-row test in `packages/server/src/__tests__/cli-start-call-shape.test.ts`, using its `vi.mock` of server-launcher / server-identity (test-plan #E3). Triple: `/api/health` 200 `{"foo":1}` on P · `cmdStart` · port-conflict message, exit 1, launch mock called 0 times.
- [x] 5.2 Write the stale-unrelated-pid test in `cli-start-call-shape.test.ts` (test-plan #E4). Triple: `server.pid` = live `sleep 60` pid, P refused, no lock meta · `cmdStart` · launch mock called once, `server.pid` not removed by the classifier.
- [x] 5.3 Write the slow-first-answer test in `cli-start-call-shape.test.ts` (test-plan #E8). Triple: probe attempt 1 AbortError, attempt 2 owned · `cmdStart` · `already running`, exit 0, launch mock not called, probe called exactly 2 times.
- [x] 5.4 Write the started-on-match test in `cli-start-call-shape.test.ts` (test-plan #E11). Triple: launch `{childPid:111, reportedPid:111}`, post-readiness classifier `owned` pid 111 · `cmdStart` · `Dashboard server started (pid 111)`, exit 0, kill mock not called.
- [x] 5.5 Write the lost-launch test in `cli-start-call-shape.test.ts` (test-plan #E12). Triple: launch `{childPid:111, reportedPid:222}`, classifier `owned` pid 222, child alive · `cmdStart` · no `started` line, `already running (pid 222)`, exit 0, kill mock called with 111.
- [x] 5.6 Write the crashing-launch test in `cli-start-call-shape.test.ts` (test-plan #X15). Triple: launch rejects `EarlyExitError(1)`, post-exit classifier `free` · `cmdStart` · contains `Check logs at`, exit 1, no `started` / `already running`.
- [x] 5.7 Write the bind-race-loss test in `cli-start-call-shape.test.ts` (test-plan #X16). Triple: launch rejects `EarlyExitError(1)`, post-exit classifier `owned` pid 333 · `cmdStart` · `already running (pid 333)`, exit 0.
- [x] 5.8 Write the unconfirmed-child test in `cli-start-call-shape.test.ts` (test-plan #X17). Triple: launch `{childPid:111, reportedPid:111}`, post-readiness classifier `unresponsive`, child alive · `cmdStart` · kill mock called with 111 before output, `running but not responding`, exit 1.
- [x] 5.9 Rewrite `cmdStart` (`packages/server/src/cli.ts:392-447`): pre-launch classifier gate mapped to the spec table, post-readiness confirmation (full budget, kill an unconfirmed child), and reclassification of every early exit. The `unresponsive` message names `pi-dashboard stop`. Verify that 5.1–5.8 and the existing `cli-start-call-shape.test.ts` / `cli-restart.test.ts` pass.
- [x] 5.10 Write the explicit-port status test in a new `packages/server/src/__tests__/cli-status.test.ts`, using the `vi.mock` pattern of `cli-start-call-shape.test.ts` plus a mock of `mdns-discovery.js` (test-plan #E13). Triple: mDNS local record on 8000, P refused · `cmdStatus({port:P, piPort:Q})` · `Dashboard server is not running`, exit 1, output lacks `8000`.
- [x] 5.11 Write the same-port-other-HOME status test in `cli-status.test.ts` (test-plan #E14). Triple: mDNS record on P, health instanceId `X`, no persisted id, no lock meta · `cmdStatus` · `not owned by this HOME`, exit 1.
- [x] 5.12 Write the running-via-mDNS status test in `cli-status.test.ts` (test-plan #E15). Triple: mDNS record on P host `h.local`, owned health · `cmdStatus` · `Dashboard server is running (pid N) on port P`, exit 0.
- [x] 5.13 Rewrite `cmdStatus` to take `{port, piPort, host}`, and update its call site (`cli.ts:~1069`). Keep only mDNS records with `isLocal && port === config.port` and take the verdict from the classifier per the Status table. Verify that 5.10–5.12 pass.
- [x] 5.14 Update the `cli.ts` row in `packages/server/src/cli.ts.AGENTS.md`. Verify it mentions the classifier gate, "started only on classifier-confirmed child pid" and `cmdStop`'s pid-file rule.

## 6. Real-process scenarios (server, POSIX)

- [x] 6.1 Write the pid-less-healthy-dashboard real-process test in a new `packages/server/src/__tests__/cli-start-real.test.ts`, copying the harness glue (temp HOME under repo tmp, `freePort()`, `bin/pi-dashboard.mjs`, `waitFor`) from `cli-stop-real.test.ts` (test-plan #E1). Triple: HOME B dashboard running on P, `server.pid` deleted · `pi-dashboard start --port P --pi-port Q` · `already running (pid N)` with N = health pid, exit 0, no second listener, `server.pid` still absent.
- [x] 6.2 Write the other-HOME refusal real-process test in `cli-start-real.test.ts` (test-plan #E2). Triple: dashboard of HOME A on P, HOME B empty · `pi-dashboard start --port P` with HOME=B · contains `not owned by this HOME` and A's pid, exit 1, A still answers, no instance-id file under B.
- [x] 6.3 Write the frozen-dashboard start test in `cli-start-real.test.ts` (test-plan #X1; skip on win32). Triple: HOME B dashboard on P, `kill -STOP` · `pi-dashboard start --port P --pi-port Q` · `running but not responding (pid N)`, exit 1, `server.pid` and `server.lock.meta.json` byte-identical; after `kill -CONT`, health answers with the same pid.
- [x] 6.4 Write the frozen-dashboard status test in `cli-start-real.test.ts` (test-plan #X2; skip on win32). Triple: same frozen setup · `pi-dashboard status --port P --pi-port Q` · contains `running but not responding`, exit 1, `server.pid` unchanged.
- [x] 6.5 Write the survives-SIGKILL restart-edge real-process test in `cli-start-real.test.ts` (test-plan #X18; skip on win32). Triple: dashboard A on P (temp HOME) frozen with `kill -STOP`; a second foreground server B on the same ports and HOME · B runs to exit · B exits non-zero within 30 s; A's lock meta, lock dir and `server.pid` byte-identical; after `kill -CONT`, A answers.

## 7. Electron lock root — design D6

- [x] 7.1 Write the reader/writer path-parity test in a new `packages/electron/src/lib/__tests__/lock-metadata.test.ts`, following the HOME-override setup of `packages/electron/src/lib/__tests__/server-lifecycle-config.test.ts` (test-plan #E22). Triple: `HOME=<tmp>` · Electron `getLockMetaPath()` vs server `getMetaPath()` · equal, both under `<tmp>/.pi/dashboard/`. Verify the test fails on current code.
- [x] 7.2 Change `packages/electron/src/lib/lock-metadata.ts::getLockMetaPath()` to root on `getDashboardConfigDir()` from shared `dashboard-paths`, and remove the private `canonicalHomedir()` together with its stale comments (`:4-6`, `:25-30`). Verify that 7.1 passes and that the Electron build job bundles it (`_electron-build.yml`).
- [x] 7.3 Update the `lock-metadata.ts` row in the nearest Electron `AGENTS.md`. Verify the row is present with `See change: harden-dashboard-start-detection`.

## 8. Bridge visibility (no behaviour change)

- [x] 8.1 Add a comment at the injected-probe call site in `packages/extension/src/server-auto-start.ts` (`:42` type, `:193` use): `timedOut` intentionally falls through to launch, and the doomed child is accepted (design Risks). Verify that the existing `server-auto-start.test.ts` passes.

## 9. Cross-OS smoke

- [x] 9.1 Extend `qa/tests/02-server-start.sh` and `qa/tests/02-server-start.ps1` (their existing start/health/cleanup glue) with the start-twice + status check (test-plan #X19). Triple: clean VM install · `pi-dashboard start`, `pi-dashboard start`, `pi-dashboard status` · first `Dashboard server started (pid N)` exit 0; second `already running (pid N)` with the same N, exit 0; status `running (pid N)` exit 0. Update `qa/tests/02-server-start.sh.AGENTS.md`. Verify with a local Linux run of the `.sh` script.

## 10. Docs

- [x] 10.1 Delegate to DocScribe: correct `docs/faq.md:242` ("fail harmlessly with EADDRINUSE"), which is not true across HOMEs, and add FAQ entries for the `start` / `status` lines `running but not responding`, `not owned by this HOME` and `starting`, plus the `E_INSTANCE_UNRESPONSIVE` log line. Verify with `grep -n "not owned by this HOME" docs/faq.md`.

## 11. Integration verification

- [ ] 11.1 Run `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`, then `grep -nE 'FAIL|Tests +[0-9]+ (failed|passed)' /tmp/pi-test.log`, then `openspec validate harden-dashboard-start-detection --strict`. Verify zero failures and a valid change.
