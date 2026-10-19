# Test Plan — fix-cli-control-electron-server

Stage: design   Generated: 2026-10-19

Hard gate: no clarifications outstanding. Every Triple slot is concrete:
- `SHUTDOWN_QUIESCE_MS = 60000` (`system-routes.ts:307`);
- the `killProcess` bound is 5000 ms (`shared/platform/process.ts:194`);
- the quit poll is 200 ms with a 5 s cap (design D7);
- bridge frame `{type:"server_restarting", reason:"shutdown", quiesceMs:60000}` (`shared/protocol.ts:1528`).

The section-1 root-cause tasks are investigations, not scenarios.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | electron-server-supervision "Electron health consumers read the published launch source"; D6 | decision-table | L1 | automated | health bodies: `{launchSource:"electron"}`, `{launchSource:"bridge"}`, `{launchSource:"standalone"}`, `{launchSource:"electron",starter:"Standalone"}`, `{starter:"Electron"}`, `{launchSource:"bridge",launchSourceEffective:"bridge-orphaned"}`, `{launchSourceEffective:"bridge-orphaned"}`, `{launchSource:"cli"}`, `{}` | `starterFromHealth(body)` | `Electron`, `Bridge`, `Standalone`, `Electron`, `Electron`, `Bridge`, `undefined`, `undefined`, `undefined` |
| E2 | server-process-management "Status subcommand" (owner fields); D3 | EP | L1 | automated | fake `/api/health` 200 bodies: (a) `launchSource:"electron", bootParentAlive:true, bootParentPid:4242`; (b) the same fields mistyped (`"true"`, `"4242"`); (c) absent | `isDashboardRunning(port)` | (a) result carries the three fields verbatim; (b) and (c) result has none of the three keys; `running:true` in all three |
| E3 | server-process-management "Status subcommand"; D3 | EP | L1 | automated | probe answers owned (instance id match) with `launchSource:"electron", bootParentAlive:false, bootParentPid:7` | `classifyDashboardPort(cfg, deps)` | `{kind:"owned", pid, launchSource:"electron", bootParentAlive:false, bootParentPid:7}` |
| E4 | "Status of a desktop-app-started server", "Status of an orphaned desktop-app server", "Status when running" | decision-table | L1 | automated | classify → owned pid 101 port 18655 with (a) electron + alive true; (b) electron + alive false; (c) standalone | `cmdStatus(cfg, deps)` | stdout line starts `Dashboard server is running (pid 101) on port 18655`. (a) also matches `/desktop app/i` and not `/no longer running/`. (b) matches both `/desktop app/i` and `/no longer running/i`. (c) matches neither. Exit not called (code 0) in all three |
| E5 | "Stop a server owned by the open desktop app", "…whose desktop app is gone", "Stop a CLI-started server prints no app note"; D8 | decision-table | L1 | automated | `healthProven` pid 300 with (a) electron, alive true, bootParentPid 4242, stop succeeds; (b) electron, alive false; (c) standalone; (d) electron, alive true, stop fails (pid survives the fallback kill) | `cmdStop(cfg, {}, deps)` | (a) output has `Dashboard server stopped` and a note matching `/desktop app/i` that contains `4242` and `/reconnect/i`. (b), (c), (d) have no `/desktop app/i` line. Exit code 0 for (a)–(c) |
| E6 | "Stop announces…", "Orphan proven by health identity is stopped by request", "No health proof uses SIGTERM"; D4 | decision-table | L1 | automated | (a) PID file 300 = health pid 300; (b) no PID file, sweep holder 300 = health pid 300; (c) sweep holder 301 owned only via lock metadata; (d) no local instance id (`healthProven:null`), PID file 300; (e) PID file 299 alive, health pid 300 | `cmdStop` with spies `shutdownRequest`, `waitForExit`, `killProcess` | (a) and (b): `shutdownRequest` called once before any `killProcess(300)`; `killProcess(300)` never called when `waitForExit` → true. (c): `killProcess(301)`, no request. (d): no request, `killProcess(300)`. (e): `killProcess(299)`; request only for 300 |
| E7 | Stop requirement (credential, no `userQuit`); D4 | EP | L1 | automated | `healthProven` pid 300, real `shutdownRequest` with stubbed `fetch` | `cmdStop` | the single fetch is `POST http://127.0.0.1:<port>/api/shutdown`. Headers include the local-proof headers produced by `localCredentialHeaders("POST", url)`. Body is undefined or empty (no `userQuit`) |
| E8 | dashboard-starter-identity "Legacy starter field is absent", "/api/health includes starter" | EP | L1 | automated | test server with `DASHBOARD_STARTER=Electron` | `GET /api/health` | body `launchSource === "electron"` and `!("starter" in body)`; `version`, `mode`, `pid` present |
| E9 | dashboard-starter-identity "Lifecycle ownership rule"; electron-server-supervision "Stop only when owned on quit", "Legacy starter field still honoured" | decision-table | L1 | automated | storedSpawnedPid 500; health (a) `launchSource:"electron", pid:500`; (b) `starter:"Electron", pid:500`; (c) `launchSource:"electron", pid:501`; (d) `launchSource:"bridge", pid:500`; (e) `launchSource:"standalone", pid:500` | `stopServerIfNeeded()` with stubbed fetch | `/api/shutdown` POSTed for (a) and (b) only, body `{userQuit:true}`; no POST for (c), (d), (e) |
| E10 | dashboard-starter-identity "Update strategy derived from starter" + "Legacy server reports only starter" | decision-table | L1 | automated | health (a) `launchSource:"electron"`; (b) `"standalone"`; (c) `"bridge"`; (d) `starter:"Standalone"` only; (e) `{}` | update-checker run with stubbed fetch and updater spies | (a) in-app updater path invoked. (b) and (d) `checkGlobalOutdated` / npm recommendation, no in-app updater. (c) bridge notice, no update mechanism. (e) same as today's null-starter path |
| E11 | electron-server-supervision "Doctor shows the starter of a current server", "Neither field present" | EP | L1 | automated | `/api/health` (a) `launchSource:"standalone"`; (b) neither field | Doctor `probeServer()` + starter row builder | (a) row status `ok`, message `Standalone`; (b) status `warning`, message `Unknown (old server?)` |
| E12 | electron-server-supervision "Attach probe records the real starter" | EP | L1 | automated | `/api/health` `launchSource:"bridge"`, no `starter` | launch-source resolver attach probe | attach result `starter === "Bridge"` (not `"Standalone"`) |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | foreground "No classification SHALL run before or during a successful startup" | invariant counter | L1 | automated | foreground handler with `runForeground` resolving | classifier call count = 0 | one invocation |
| P2 | stop "no new latency"; D3 (probe only with local instance id) | invariant counter | L1 | automated | `collectOwnership` with `peekInstanceId → null`, PID file absent, no holders | `fetchHealth` call count = 0 | one invocation |
| P3 | dashboard-starter-identity "Electron quit stops own server" (await ≤ 5 s); D7 | threshold (fake timers) | L1 | automated | fake server keeps answering `/api/health` forever after the shutdown POST | `stopServerIfNeeded` resolves at 5000 ms ≤ t ≤ 5200 ms of fake time; poll interval 200 ms (≈25 polls) | one quit |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | electron-qa-coverage "Zombie-adoption modal…" (Take ownership → quit); dashboard-starter-identity "Lifecycle ownership rule" | state-transition | electron | automated | packaged app attached to a fake `/api/health` with `launchSourceEffective:"electron"`, `launchSource:"electron"`, **no `starter`**, `bootParentAlive:false`, reparented `ppid` | stubbed modal returns "Take ownership", then the app quits | the fake server records exactly one `POST /api/shutdown` with body `{userQuit:true}` before the app process exits |
| F2 | electron-server-supervision "Doctor shows the starter of a current server" | state-transition | electron | automated | packaged app, fake `/api/health` with `launchSource:"standalone"`, no `starter` | Doctor window opens | the starter row text is `Standalone` with ok status (not `Unknown (old server?)`) |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | "Shutdown request fails and stop falls back to SIGTERM" | fault-injection (abort) | L1 | automated | `shutdownRequest` (a) rejects `ECONNRESET`; (b) resolves HTTP 403 `local_proof_required` | `cmdStop` with health-proven PID-file pid 300 | `killProcess(300)` called after the request. A log line names the fallback reason (`ECONNRESET` / `403`). PID-file removal follows today's rule (removed iff pid dead) |
| X2 | "Shutdown request fails…" (survival) | fault-injection (delay) | L1 | automated | `shutdownRequest` → 200, `waitForExit(300, 5000)` → false | `cmdStop` | `waitForExit` awaited with `(300, 5000)`, then `killProcess(300)` called exactly once |
| X3 | "Foreground while the desktop app's server is running"; D5 | fault-injection | L1 | automated | `runForeground` rejects `Object.assign(new Error("listen EADDRINUSE"), {code:"EADDRINUSE"})`; classify → owned pid 77, `launchSource:"electron"` | foreground handler | stdout contains `Dashboard server is already running (pid 77)` and `/desktop app/i`. stderr lacks `Failed to start dashboard`. `exit(1)` called exactly once |
| X4 | "Foreground on a port held by another service" | fault-injection | L1 | automated | `runForeground` rejects `new Error("gateway fallback failed", {cause:{code:"EADDRINUSE"}})`; classify → conflict | foreground handler | the port-conflict lines from `portVerdict` are printed; `exit(1)` |
| X5 | "Foreground fails for an unrelated reason" | fault-injection | L1 | automated | `runForeground` rejects `new Error("boom")`; classify → free | foreground handler | stderr has `Failed to start dashboard:` and `boom`; `exit(1)` |
| X6 | "Shutdown-request stop records the shutdown intent"; D4 lock/pid cleanup | fault-injection (real process) | L1 | automated | real server in a temp HOME on 18655/18656, with an instance id | real `cmdStop --port 18655 --pi-port 18656` | process gone within 5 s. Boot record `exitIntent === "shutdown"`. The lock hold `server.lock.lock` and `server.pid` are absent (`server.lock` / `server.lock.meta.json` persist after any clean exit, by design; the metadata names a dead pid). Output has `Dashboard server stopped` |
| X7 | "Shutdown request under requireLocalProof" | fault-injection (real process) | L1 | automated | as X6, plus `requireLocalProof: true` in the temp HOME's config | real `cmdStop` | boot record `exitIntent === "shutdown"` (not `"signal"`), proving the request was accepted rather than falling back |
| X8 | "Stop announces the shutdown to connected bridges" | fault-injection (real process) | L1 | automated | real server as X6, plus a raw WS client connected to the pi gateway (a fake bridge) | real `cmdStop` | the client receives `{type:"server_restarting", reason:"shutdown", quiesceMs:60000}` before its socket closes; `/api/health` on 18655 refuses afterwards |
| X9 | dashboard-starter-identity "Electron quit stops own server" (await exit) | fault-injection (delay) | L1 | automated | fake server answers `/api/health` for 600 ms after the shutdown POST, then refuses | `stopServerIfNeeded()` | resolves at ≥ 600 ms and < 1000 ms (fake time); POST sent once |
| X10 | "Foreground while the desktop app's server is running" (real) | fault-injection (real process) | L1 | automated | temp HOME. A foreground server runs on 18655/18656 with `DASHBOARD_STARTER=Electron` under a live parent | a second `pi-dashboard --port 18655 --pi-port 18656` in the same HOME | the second process exits with status 1 within the classify budget (≤ 10 s). Its stdout matches `already running (pid <first pid>)` and `/desktop app/i`. The first server's `server.pid`, `server.lock.meta.json` and `instances/18656.id` are byte-identical before and after. The first server still answers `/api/health` |

### Manual-only

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | end-to-end on the real packaged app (macOS) | exploratory | — | manual-only | installed `pi-dashboard.app` with its bundled server, plus a terminal pi session | `pi-dashboard status` → `stop` → Start server in the app → quit the app | status shows the desktop-app mention. After stop the app shows the reconnect page and no server respawns (no replacement from the terminal session). After quit the spawned server pid is gone. [judgment: needs the real packaged app with a real bundled server; the `_electron` suite fakes health] |
| M2 | H5 (Windows) stop of an app-owned server | exploratory | — | manual-only | Windows host, packaged app running | `pi-dashboard stop` from PowerShell | the server stops through `/api/shutdown` (boot record `shutdown`), and the app shows the reconnect page. [hardware/OS: needs a Windows desktop session] |

---

## Coverage summary

- Requirements covered: 19/19 delta requirements and scenarios mapped (server-process-management: Stop, Status, Foreground; dashboard-starter-identity: Starter exposed, Lifecycle ownership, Update strategy, boot-parent (unchanged behaviour, no new row); electron-server-supervision: Spawned-server ownership, Electron health consumers)
- Scenarios by class: edge 12 · perf 3 · frontend 2 · error 10 · manual 2
- Scenarios by level: L1 25 · electron 2 · L2 0 · L3 0
- Scenarios by disposition: automated 27 · manual-only 2

## New infra needed

- None. X6–X8 and X10 extend the existing real-process vitest harness (`packages/server/src/__tests__/cli-stop-real.test.ts`, `cli-start-real.test.ts`). F1 and F2 extend `tests/e2e-electron/`.
- An automated real-app + real-server quit check (M1) would need new infra and is not proposed.
