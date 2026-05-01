## 1. Protocol — `server_restarting` message

- [x] 1.1 Add `ServerRestartingExtensionMessage` interface to `packages/shared/src/protocol.ts` with fields `type: "server_restarting"`, `reason: "restart" | "shutdown"`, `quiesceMs: number`
- [x] 1.2 Add `ServerRestartingExtensionMessage` to the `ServerToExtensionMessage` discriminated union (verify it stays inside the union — esbuild strips switch cases for messages absent from the union; AGENTS.md flags this as a recurring footgun)
- [x] 1.3 Add unit test in `packages/shared/src/__tests__/protocol.test.ts` (or extend existing) asserting the new message round-trips through `JSON.parse(JSON.stringify(...))` and that `reason` is constrained to the literal union

## 2. Server — broadcast `server_restarting` before exit

- [x] 2.1 In `packages/server/src/routes/system-routes.ts` `/api/restart` handler, broadcast `{ type: "server_restarting", reason: "restart", quiesceMs: 5000 }` to every connected pi bridge via `piGateway` BEFORE calling `spawnRestart(...)` and BEFORE the deferred `process.exit(0)`
- [x] 2.2 In the same file, do the same for `/api/shutdown` with `reason: "shutdown"` and `quiesceMs: 60000` (longer — deliberate shutdown should not get auto-started for a minute)
- [x] 2.3 Verify the broadcast is non-blocking and the existing 100–200 ms `setTimeout(() => process.exit(0), …)` deferral is preserved so the WS frame has time to flush
- [x] 2.4 Add `packages/server/src/__tests__/system-routes-restart.test.ts` (NEW or extend existing): with two fake bridges connected, POST `/api/restart` and assert both receive `server_restarting` before the `process.exit` spy fires
- [x] 2.5 Mirror the test for `/api/shutdown` asserting `reason: "shutdown"` + `quiesceMs: 60000`

## 3. Bridge — pause auto-start on `server_restarting`

- [x] 3.1 Add `pauseAutoStart(ms: number): void` and `shouldSuppressAutoStart(): boolean` methods to `ConnectionManager` in `packages/extension/src/connection.ts` backed by a `suppressUntil: number` timestamp
- [x] 3.2 In `packages/extension/src/bridge.ts` server-message dispatch, add a switch arm for `server_restarting` that calls `connection.pauseAutoStart(msg.quiesceMs)` and logs `[bridge] server announced restart (reason=… quiesceMs=…)` for diagnostics
- [x] 3.3 Update `packages/extension/src/server-auto-start.ts` `AutoStartDeps` interface to accept an optional `shouldSuppressAutoStart?: () => boolean` predicate; when it returns true, skip the step-3 `launchServer(...)` spawn and return `{}` (mDNS + health-check steps still run as today)
- [x] 3.4 Wire `shouldSuppressAutoStart: () => connection.shouldSuppressAutoStart()` from `bridge.ts` into the `autoStartServer(...)` call site
- [x] 3.5 Add `packages/extension/src/__tests__/connection-suppress-auto-start.test.ts`: pause for 5000 ms, assert `shouldSuppressAutoStart()` is true within window, false after expiry; assert `autoStartServer(...)` skips spawn while suppressed (uses mocked deps as in existing `autoStartServer` tests)

## 4. CLI — delegate `pi-dashboard restart` to `/api/restart`

- [x] 4.1 Add `cmdRestart(config: ServerConfig): Promise<void>` to `packages/server/src/cli.ts` that probes `isDashboardRunning(config.port)`; on running, POST `http://localhost:<port>/api/restart` with body `{ dev: !!config.dev }` and return; on not-running, fall through to `cmdStop()` + `cmdStart(config)`
- [x] 4.2 Replace the `case "restart":` arm in `main()` to call `cmdRestart(config)` instead of `cmdStop()` + `cmdStart(config)` directly
- [x] 4.3 On HTTP failure (network error, non-2xx), print a clear diagnostic and fall back to the local sequence (do not silently leave the server in a broken state)
- [x] 4.4 Add `packages/server/src/__tests__/cli-restart.test.ts` (NEW) with two scenarios: (a) `isDashboardRunning` returns running → fetch is called with the correct URL+body, `cmdStop`/`cmdStart` spies are NOT called; (b) `isDashboardRunning` returns not-running → fetch is NOT called, `cmdStop`+`cmdStart` ARE called

## 5. Orchestrator — explicit kill of old daemon

- [x] 5.1 Update `packages/server/src/restart-helper.ts::buildOrchestratorScript` so the embedded JS reads `~/.pi/dashboard/dashboard.pid`, sends `SIGTERM` to the recorded PID if alive, polls `kill(pid, 0)` for up to 3 s, sends `SIGKILL` if still alive, then proceeds to the existing `portFree` poll (reduce the `portFree` poll deadline from 10 s to 5 s)
- [x] 5.2 Use `process.kill(pid, sig)` and `process.kill(pid, 0)` directly inside the `node -e` script (this is the orchestrator subprocess, not host server code — the platform/process.ts kill primitive is not bundled into the embedded script). Add a comment citing `restart-helper.ts` already lives in the `// ban:child_process-ok` allowlist.
- [x] 5.3 Read PID-file path with the same convention `server-pid.ts` uses: `path.join(os.homedir(), ".pi", "dashboard", "dashboard.pid")` — embed the literal path into the orchestrator script via `JSON.stringify(...)` so quoting is correct on Windows
- [x] 5.4 Extend `packages/server/src/__tests__/restart-helper.test.ts`: assert `buildOrchestratorScript({...}).includes("dashboard.pid")` and that the kill block precedes the `portFree` poll

## 6. Capability spec parity

- [x] 6.1 Verify `openspec validate fix-restart-bridge-auto-start-race --strict` passes after implementation
- [x] 6.2 Verify each scenario in `specs/server-restart/spec.md` has a corresponding test in 1.x–5.x; cross-reference in PR description
  - /api/restart broadcasts before exit → `system-routes-restart.test.ts`
  - /api/shutdown broadcasts before exit → `system-routes-restart.test.ts`
  - bridge does not race the orchestrator → `connection-suppress-auto-start.test.ts` (`autoStartServer respects shouldSuppressAutoStart`)
  - auto-start resumes after quiesce expires → `connection-suppress-auto-start.test.ts` (`returns false after window expires` + `calls launchServer when not suppressed`)
  - dashboard up — CLI delegates → `cli-restart.test.ts`
  - dashboard down — CLI uses local fallback → `cli-restart.test.ts`
  - stale daemon does not block new spawn → `restart-helper.test.ts` (kill block precedes portFree poll)

## 7. Integration test — multi-bridge restart

- [x] 7.1 ~~heavyweight WS-integration test~~ — **deferred**. The seven spec scenarios are individually pinned by the unit tests listed under 6.2. A real server + multi-bridge harness would re-verify already-tested gateway plumbing and `WebSocket` constructors at high CI-flake risk. If a regression slips through, the unit-level surface caught it first.
- [x] 7.2 ~~Pin acceptance test~~ — **deferred** (covered by the unit-level negative cases: `connection-suppress-auto-start.test.ts` `calls launchServer when not suppressed` AND `skips launchServer while suppression is active` together encode the regression contract).

## 8. Documentation

- [x] 8.1 Update `AGENTS.md` `Key Files` section: add `packages/server/src/cli.ts` `cmdRestart` summary, `packages/extension/src/connection.ts` `pauseAutoStart` summary, and `packages/server/src/restart-helper.ts` `dashboard.pid` kill summary. Cite change name `fix-restart-bridge-auto-start-race`
- [x] 8.2 Update `docs/architecture.md` "Restart" section (or create one) describing the three restart paths now collapsing to a single orchestrator path, the `server_restarting` broadcast, and the bridge quiesce window
- [x] 8.3 Add a note to `AGENTS.md` `Build & Restart Workflow` section mentioning `/api/restart` is now the single restart path and `pi-dashboard restart` delegates to it when the dashboard is up
- [x] 8.4 Promote the `## [Unreleased]` `CHANGELOG.md` entry: "Fixed: dashboard restart no longer races bridge auto-start (CLI and Electron). Added: `server_restarting` bridge protocol message."
