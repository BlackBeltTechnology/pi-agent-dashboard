## 1. Root-cause gate (systematic-debugging; no production code changes)

- [x] 1.1 Build an isolated repro harness: `HOME=$(mktemp -d)`, ports `--port 18655 --pi-port 18656` (never touch the live :8000 dashboard). Start a "fake Electron" foreground server (`DASHBOARD_STARTER=Electron PI_DASHBOARD_ELECTRON_INSTANCE=<uuid>`) under a parent that stays alive. Verify: its `/api/health` reports `launchSource: "electron"`, no `starter`, `bootParentAlive: true`, `bootParentPid` = the harness parent pid, and the HOME's `instanceId`; `server.pid` and `server.lock.meta.json` name its pid.
- [x] 1.2 Under that HOME, run `pi-dashboard status`, bare `pi-dashboard --port 18655 --pi-port 18656`, and `pi-dashboard stop --port 18655 --pi-port 18656`. Capture stdout/stderr and exit codes, and the foreground failure's error shape: which listener failed first (unix-socket gateway `GatewaySocketConflictError`, TCP gateway fallback, or HTTP), `err.name`, `err.code` vs `err.cause.code` (H2, D5). Check that `server.pid`, the lock metadata and `instances/18656.id` are unchanged after the failed foreground. Verify: the transcripts are pasted into a `## Root-cause log` section appended to `design.md`.
- [x] 1.3 Test H3 (env/port skew: export `PI_DASHBOARD_PORT` / `PI_DASHBOARD_PI_PORT` different from `config.json`) and H4 (CLI version skew: an npm-installed CLI older than the bundle). Record whether each reproduces "status fails". Verify: the outcome of each is recorded in the Root-cause log, along with the H5 (Windows) note.
- [x] 1.4 Test H6: with a non-pinned pi session (no `PI_DASHBOARD_URL`/`PI_DASHBOARD_SOCKET`, `PI_DASHBOARD_PORT=18655 PI_DASHBOARD_PI_PORT=18656`) connected to the harness server, run today's `pi-dashboard stop`. Then poll `/api/health` on 18655 for 30 s. Verify: the Root-cause log records whether a replacement server appeared (and its `launchSource`), plus the auto-start log line.
- [x] 1.5 Confirm H1 on the real app (macOS): launch `pi-dashboard.app`, quit it, and check whether the spawned server pid is still alive. Verify: before/after `ps` output in the Root-cause log.
- [x] 1.6 Gate. If any confirmed cause is NOT covered by `specs/`, stop: amend the specs, design and tasks (openspec-update-change) and re-validate with `openspec validate fix-cli-control-electron-server --strict` before section 2. Verify: the log ends with "Gate: covered" or links the amendment.

## 2. Shared: health owner fields and starter mapping (TDD)

- [x] 2.1 Test (test-plan #E1): add a `starterFromHealth` decision table to `packages/shared/src/__tests__/dashboard-starter.test.ts` (exemplar: the `parseDashboardStarter` `describe` in the same file).
  - Input: the nine bodies listed in E1, including the orphan pair `{launchSource:"bridge", launchSourceEffective:"bridge-orphaned"}` and the effective-only body.
  - Trigger: `starterFromHealth(body)`.
  - Observable: `Electron, Bridge, Standalone, Electron, Electron, Bridge, undefined, undefined, undefined`.
  - Verify: fails before 2.3, passes after.
- [x] 2.2 Test (test-plan #E2): add owner-field cases to `packages/shared/src/__tests__/server-identity.test.ts` (exemplar: the file's existing `instanceId` parsing cases).
  - Input: fake `/api/health` bodies, (a) well-typed `launchSource` / `bootParentAlive` / `bootParentPid`, (b) mistyped, (c) absent.
  - Trigger: `isDashboardRunning`.
  - Observable: (a) the fields are copied verbatim; (b) and (c) have no such keys; `running:true` throughout.
  - Verify: fails before 2.3, passes after.
- [x] 2.3 Implement `starterFromHealth` in `packages/shared/src/dashboard-starter.ts` (D6) and the optional `DashboardStatus` owner fields plus parsing in `packages/shared/src/server-identity.ts` (D3). Verify: test-plan E1/E2 tests pass; `npx vitest run packages/shared` is green.

## 3. Electron + health contract: read the published launch source (TDD)

- [x] 3.1 Test (test-plan #E8): in `packages/server/src/__tests__/health-shape.test.ts` (exemplar: its "launchSource is 'electron' when DASHBOARD_STARTER=Electron" case), assert that `GET /api/health` with `DASHBOARD_STARTER=Electron` gives `launchSource === "electron"`, `!("starter" in body)`, and `version` / `mode` / `pid` present. Update the header comment to cite this change. Verify: passes (it pins current behaviour).
- [x] 3.2 Test (test-plan #E9): add a quit-ownership decision table to `packages/electron/src/lib/__tests__/server-lifecycle-shutdown.test.ts` (exemplar: its existing `decideShutdownOnQuit` cases, with a stubbed `fetch`).
  - Input: storedSpawnedPid 500 and health bodies (a)–(e) from E9.
  - Trigger: `stopServerIfNeeded()`.
  - Observable: `/api/shutdown` POSTed with body `{userQuit:true}` for (a) and (b) only.
  - Verify: (a) fails before 3.6, all pass after.
- [x] 3.3 Test (test-plan #X9): in the same file, a fake server answers `/api/health` for 600 ms after the POST, then refuses. `stopServerIfNeeded()` resolves at ≥ 600 ms and < 1000 ms of fake time, and the POST is sent once. Verify: fails before 3.8, passes after.
- [x] 3.4 Test (test-plan #P3): in the same file, a fake server answers forever. `stopServerIfNeeded()` resolves between 5000 and 5200 ms of fake time, polling every 200 ms. Verify: fails before 3.8, passes after.
- [x] 3.5 Test (test-plan #E10): in `packages/electron/src/__tests__/update-checker.test.ts` (exemplar: its existing strategy cases). Observable: health (a) `launchSource:"electron"` → in-app updater; (b) `"standalone"` or (d) starter-only `Standalone` → npm recommendation, no in-app updater; (c) `"bridge"` → bridge notice, no update mechanism; (e) neither → today's null path. Verify: (a)–(d) fail before 3.8, all pass after.
- [x] 3.6 Test (test-plan #E11): in `packages/electron/src/lib/__tests__/doctor-launch-test.test.ts` (or a sibling `doctor-starter.test.ts`; exemplar: the file's `probeServer` fetch stub). Observable: `/api/health` (a) `launchSource:"standalone"` → starter row `ok` / `Standalone`; (b) neither field → `warning` / `Unknown (old server?)`. Verify: (a) fails before 3.8, passes after.
- [x] 3.7 Test (test-plan #E12): in `packages/electron/src/lib/__tests__/launch-source.test.ts` (exemplar: its attach-probe cases near ~:293), `/api/health` `launchSource:"bridge"` with no `starter` gives attach `starter === "Bridge"`. Update the `starter` mocks there and in `launch-source-shared-primitive.test.ts` to the real shape. Verify: fails before 3.8, passes after.
- [x] 3.8 Implement:
  - Route `server-lifecycle.ts`, `update-checker.ts`, `doctor.ts` and the `launch-source.ts` attach probe through `starterFromHealth`, normalising `?? null` at the `string | null` sites (`update-checker.ts:92`, `:107`; `doctor.ts:119`).
  - Add the D7 bounded exit wait (200 ms poll, 5 s cap) to `stopServerIfNeeded`.
  - Verify: 3.2–3.5 pass. `grep -nE "(data|health|body)\.starter\b" packages/electron/src --include=*.ts | grep -v __tests__` shows only allowed matches: `decideShutdownOnQuit`'s `params.starter`, the Doctor probe type, and typed probe-object reads such as `launch-source.ts:~357`.
- [x] 3.9 Test (test-plan #F1): in `tests/e2e-electron/zombie-adoption.electron.spec.ts` (exemplar: its existing "Take ownership" flow), switch the fake `/api/health` to `launchSource:"electron"`, `launchSourceEffective:"electron"` and **no `starter`**. Assert that the stubbed modal choice "Take ownership", followed by app quit, makes the fake server record exactly one `POST /api/shutdown` with body `{userQuit:true}` before the app exits. Verify: passes with `npx playwright test -c playwright.electron.config.ts zombie-adoption` on macOS after 3.8.
- [x] 3.10 Test (test-plan #F2): in `tests/e2e-electron/doctor-version-skew.electron.spec.ts` (exemplar: its doctor-window row assertions), drop `starter` from the fake health (`launchSource:"standalone"`). Assert that the Doctor starter row reads `Standalone` with ok status. Also:
  - drop `starter` from the other fakes (`tray-ownership`, `server-windows`, `dmg-build-launch`, `electron-lifecycle.ts`);
  - fix `dmg-build-launch`'s invalid `"cli"` values to `"standalone"`;
  - keep exactly one fake legacy-only (`starter` without `launchSource`), named in a comment.
  - Verify: `npx playwright test -c playwright.electron.config.ts` passes locally; the `ci-e2e-electron.yml` dispatch result is noted in the PR.

## 4. CLI: status, stop, foreground (TDD)

- [x] 4.1 Test (test-plan #E3): in `packages/server/src/__tests__/classify-dashboard-port.test.ts` (exemplar: its owned-via-instance-id case), a probe answering owned with `launchSource:"electron", bootParentAlive:false, bootParentPid:7` yields `{kind:"owned", pid, launchSource:"electron", bootParentAlive:false, bootParentPid:7}`. Verify: fails before 4.4, passes after.
- [x] 4.2 Test (test-plan #E4): in `packages/server/src/__tests__/cli-status.test.ts` (exemplar: its injected-`classify` running case), classify → owned pid 101 port 18655 with (a) electron + alive, (b) electron + not alive, (c) standalone. Observable:
  - every line starts `Dashboard server is running (pid 101) on port 18655`;
  - (a) matches `/desktop app/i` only;
  - (b) matches `/desktop app/i` and `/no longer running/i`;
  - (c) matches neither;
  - `exit` is never called.
  - Verify: fails before 4.4, passes after.
- [x] 4.3 Test (test-plan #P2): in `packages/server/src/__tests__/stop-ownership.test.ts` (exemplar: its `collectOwnedPids` injected-deps cases), `collectOwnership` with `peekInstanceId → null`, no PID file and no holders makes 0 `fetchHealth` calls. Verify: passes after 4.4 (and stays green).
- [x] 4.4 Implement:
  - add owner fields to the `owned` variant in `classify-dashboard-port.ts`;
  - widen `probeHealth` and add `collectOwnership() → { owned, healthProven }` in `stop-ownership.ts`, keeping the `collectOwnedPids` wrapper;
  - add the status running-line suffix (D8) in `cli.ts`.
  - Verify: 4.1–4.3 pass; existing classify / status / stop-ownership tests stay green.
- [x] 4.5 Test (test-plan #E6): in `packages/server/src/__tests__/cli-stop.test.ts` (exemplar: its injected `StopDeps` sweep cases), inject the new `collectOwnership`, `shutdownRequest`, `waitForExit` and `killProcess` spies for cases (a)–(e) from E6. Observable:
  - (a) and (b): request before any `killProcess(300)`, and no `killProcess(300)` when `waitForExit` → true;
  - (c): `killProcess(301)` with no request;
  - (d): no request, `killProcess(300)`;
  - (e): `killProcess(299)`, with the request only for 300.
  - Verify: fails before 4.10, passes after.
- [x] 4.6 Test (test-plan #E7): in the same file, with the real `shutdownRequest` and a stubbed `fetch`, the single fetch is `POST http://127.0.0.1:<port>/api/shutdown`. Its headers include `localCredentialHeaders("POST", url)` output and its body is empty (no `userQuit`). Verify: fails before 2.3TOP, passes after.
- [x] 4.7 Test (test-plan #X1): in `cli-stop.test.ts` (exemplar: its injected `StopDeps` cases), `shutdownRequest` (a) rejects `ECONNRESET`, (b) resolves 403 `local_proof_required`, for health-proven PID-file pid 300. Observable: `killProcess(300)` is called exactly once after the request; a log line names `ECONNRESET` / `403`; the PID-file removal follows today's rule. Verify: fails before 2.3TOP, passes after.
- [x] 4.8 Test (test-plan #X2): in the same file, `shutdownRequest` → 200 but `waitForExit(300, 5000)` → false. Observable: `waitForExit` is awaited with `(300, 5000)`, then `killProcess(300)` is called exactly once. Verify: fails before 2.3TOP, passes after.
- [x] 4.9 Test (test-plan #E5): in the same file, `healthProven` pid 300 with (a) electron + alive + bootParentPid 4242 + stopped; (b) not alive; (c) standalone; (d) stop failed. Observable: (a) prints `Dashboard server stopped` plus a `/desktop app/i` note containing `4242` and `/reconnect/i`; (b)–(d) print no `/desktop app/i` line. Verify: fails before 2.3TOP, passes after.
- [x] 4.10 Test (test-plan #X6): extend `packages/server/src/__tests__/cli-stop-real.test.ts` (exemplar: its X4–X6 real-server temp-HOME cases). A real server on 18655/18656 plus a real `cmdStop`: the process is gone within 5 s; boot-record `exitIntent === "shutdown"`; `server.lock`, `server.lock.meta.json` and `server.pid` are absent; the output has `Dashboard server stopped`. Verify: fails before 2.3TOP, passes after.
- [x] 4.11 Test (test-plan #X7): same file and setup with `requireLocalProof: true` in the temp HOME config. A real `cmdStop` leaves `exitIntent === "shutdown"` (not `"signal"`). Verify: fails before 2.3TOP, passes after.
- [x] 4.12 Test (test-plan #X8): same file and setup, plus a raw WS client connected to the pi gateway (fake bridge). On a real `cmdStop` the client receives `{type:"server_restarting", reason:"shutdown", quiesceMs:60000}` before its socket closes, and `/api/health` on 18655 refuses afterwards. Verify: fails before 2.3TOP, passes after.
- [x] 4.13 Implement D4 + D8 in `cmdStop` (`cli.ts`):
  - add the optional `StopDeps.collectOwnership` / `shutdownRequest` / `waitForExit`;
  - send the request for the health-proven pid in the PID-file step or the sweep, with `localCredentialHeaders` and no body;
  - fall back to `killProcess` on error, refusal or survival, logging the reason;
  - print the success line;
  - add the `desktopAppNote`.
  - Verify: 4.5–4.9 pass; all existing `cli-stop*.test.ts` cases stay green.
- [x] 4.14 Test (test-plan #P1): new `packages/server/src/__tests__/cli-foreground-failure.test.ts` (exemplar: `cli-status.test.ts` deps injection) against the extracted foreground handler. When `runForeground` resolves, the classifier is called 0 times. Verify: passes after 4.19.
- [x] 4.15 Test (test-plan #X3): same file. `runForeground` rejects with an HTTP `EADDRINUSE` (`.code`) and classify → owned pid 77 `launchSource:"electron"`. Observable: stdout has `Dashboard server is already running (pid 77)` and `/desktop app/i`; no `Failed to start dashboard`; `exit(1)` is called exactly once. Verify: fails before 4.19, passes after.
- [x] 4.16 Test (test-plan #X4): same file. A gateway wrapper `Error` with `cause.code === "EADDRINUSE"`, and classify → conflict, prints the `portVerdict` port-conflict lines and calls `exit(1)`. Verify: fails before 4.19, passes after.
- [x] 4.17 Test (test-plan #X5): same file. `Error("boom")`, and classify → free, prints `Failed to start dashboard:` and `boom` and calls `exit(1)`. Verify: fails before 4.19, passes after.
- [x] 4.18 Test (test-plan #X10): new real-process case in `packages/server/src/__tests__/cli-foreground-real.test.ts` (exemplar: `cli-start-real.test.ts` temp-HOME spawn helpers).
  - Input: a temp HOME with a foreground server on 18655/18656 under `DASHBOARD_STARTER=Electron` and a live parent.
  - Trigger: a second `pi-dashboard --port 18655 --pi-port 18656`.
  - Observable:
    - the second process exits 1 within 10 s, its stdout matching `already running (pid <first>)` and `/desktop app/i`;
    - the first server's `server.pid`, `server.lock.meta.json` and `instances/18656.id` are byte-identical;
    - the first server still answers `/api/health`.
  - Verify: fails before 4.13, passes after.
- [x] 4.19 Implement D5: extract the default-branch handling of `main()` into a testable function. Catch any `runForeground` error, classify once, print the verdict plus the desktop-app mention (or the generic message for `free`), and call `exit(1)` explicitly. Verify: test-plan P1/X3/X4/X5/X10 tests pass.
- [x] 4.20 Re-run the section-1 harness end to end against the fixed tree: status → foreground → stop, with a connected non-pinned bridge (H6). Verify: outputs match the spec scenarios; no replacement server appears within 30 s after `stop`; append the after-transcript to the Root-cause log.

## 5. Integration, manual checks, docs, review

- [x] 5.1 Full test run: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`, then `grep -nE 'FAIL|Tests +[0-9]+ (failed|passed)' /tmp/pi-test.log`. Verify: no failures.
- [ ] 5.2 Manual (test-plan: manual-only, #M1): the real packaged macOS app with a terminal pi session.
  - `pi-dashboard status` shows the desktop-app mention.
  - `stop` → the app shows its reconnect page; no server respawns (none from the terminal session either).
  - Start server, then quit the app → the spawned server pid is gone.
  - The Doctor starter row shows Electron.
  - Verify: observations recorded in the Root-cause log.
- [ ] 5.3 Manual (test-plan: manual-only, #M2): Windows. With the packaged app running, `pi-dashboard stop` from PowerShell stops the server through `/api/shutdown` (boot record `shutdown`), and the app shows the reconnect page. Verify: result recorded in the Root-cause log (H5).
- [x] 5.4 Docs:
  - README `stop`/`status` command reference (announced shutdown, desktop-app note);
  - a `docs/faq.md` entry "pi-dashboard CLI vs the desktop app's server", via DocScribe (caveman style);
  - CHANGELOG `## [Unreleased]` → `Fixed`: quitting the app stops its own server again (behaviour change since 2026-05-26); `stop` no longer races bridge auto-start (exit intent `shutdown`); the Electron update checker and Doctor see the real starter (Bridge skips the managed check, Standalone gets the npm recommendation).

  Then run `npm run quality:changed`. It applies Biome `--write` fixes and runs tests; commit its fixes. Verify: the files are updated and the quality run exits 0.
- [x] 5.5 AGENTS.md closeout rows: `packages/shared/src/` (`server-identity.ts`, `dashboard-starter.ts`), `packages/server/src/lifecycle/` (`stop-ownership.ts`, `classify-dashboard-port.ts`), `packages/server/src/` (`cli.ts`), `packages/electron/src/lib/` (`server-lifecycle.ts`, `update-checker.ts`, `doctor.ts`, `launch-source.ts`), `tests/e2e-electron/AGENTS.md`, each with `See change: fix-cli-control-electron-server`. Verify: `grep -rln "fix-cli-control-electron-server" --include=AGENTS.md packages tests` lists every touched directory.
- [ ] 5.6 Run `doubt-driven-review` on the stop path (D4: request-then-SIGTERM ordering, the health-proven-pid precondition, the exit-intent change) and on the quit-behaviour change (D6/D7), then `review-code` on the full diff. Verify:
  - findings resolved or recorded;
  - follow-up issues filed for the pre-existing `server-launch` normal-path port-conflict gap (exit 1 → `EarlyExitError`) and for the pure-TCP gateway bind error that `installCrashSafetyNet` swallows (`pi-gateway.ts:~1165`);
  - a comment posted on issue #924 with the root cause and the fix.
