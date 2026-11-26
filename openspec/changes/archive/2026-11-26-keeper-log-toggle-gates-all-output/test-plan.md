# Test Plan — keeper-log-toggle-gates-all-output

Stage: design   Generated: 2026-11-26

All harnesses exist. Keeper scenarios run the real `keeper.cjs` against the mock pi in `packages/server/src/rpc-keeper/__tests__/keeper.test.ts`. KeeperManager scenarios use the injected `sessionsDir` + fake `spawnDetached` in `packages/server/src/__tests__/keeper-manager.test.ts`. Env and message scenarios use the `state.spawnCalls` capture in `packages/server/src/__tests__/process-manager-keeper-spawn.test.ts`.

**Hermeticity precondition (all keeper.test.ts rows):** the harness env builder deletes any inherited `PI_KEEPER_CAPTURE_PI_OUTPUT` (any case) before merging `extraEnv`. Otherwise a dev shell exporting it falsifies every "no file" row.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | rpc-keeper-sidecar: RPC keeper sidecar… / Capture disabled by default discards pi output | decision-table (capture=off) | L1 | automated | keeper env without `PI_KEEPER_CAPTURE_PI_OUTPUT`; mock pi echoes stdout | keeper started → wait for socket ready → write one JSON line → SIGTERM | mock pi received the line; keeper exit 0; `existsSync(keeper-<id>.log) === false` both while running and after exit (inverts the existing test at `:475`) |
| E2 | rpc-keeper-sidecar: Capture enabled archives pi output | decision-table (capture=on) | L1 | automated | env `PI_KEEPER_CAPTURE_PI_OUTPUT="1"`; mock pi writes `MOCK_STDOUT` | keeper started, line forwarded | `keeper-<id>.log` contains `keeper starting:` AND `MOCK_STDOUT` |
| E3 | rpc-keeper-sidecar: Keeper log size-bounded… / No rotation machinery when capture is disabled | state (rotation never armed) | L1 | automated | capture unset; `PI_KEEPER_LOG_CHECK_INTERVAL_MS="50"` | keeper running for ≥ 500 ms (≥ 10 intervals) then one RPC line | keeper still alive, line forwarded, no `keeper-<id>.log`, exit code on SIGTERM is 0 (guards `logRotation.start()` at `keeper.cjs:443`) |
| E4 | rpc-keeper-sidecar: capture enabled only on exactly `"1"` | equivalence partitioning | L1 | automated | `PI_KEEPER_CAPTURE_PI_OUTPUT` ∈ {`""`, `"0"`, `"true"`, `"yes"`} | keeper started per value | no `keeper-<id>.log` for any value; keeper reaches ready |
| E5 | rpc-keeper-sidecar: Keeper SHALL record pi's PID in a sidecar (regression with capture off) | state | L1 | automated | capture unset | keeper ready | `<sock>.pid` holds the keeper PID integer AND the `.pi-pid` sidecar exists and holds the mock-pi PID |
| E6 | rpc-keeper-sidecar: Launch-stderr log is created only when capture is enabled / Capture disabled spawns no launch log | decision-table (off) | L1 | automated | `spawnKeeperFor` env without the var; temp `sessionsDir` | spawn call returns | fake `spawnDetached` received `logFd === undefined`; `readdirSync(sessionsDir)` has no `keeper-launch-*` entry |
| E7 | rpc-keeper-sidecar: Capture enabled spawns a launch log + Server closes its launch-log descriptor | decision-table (on) | L1 | automated | env `PI_KEEPER_CAPTURE_PI_OUTPUT="1"`; temp `sessionsDir` | spawn call returns success | `keeper-launch-<id>.log` exists; fake received numeric `logFd`; `fstatSync(thatFd)` throws `EBADF` after return |
| E8 | rpc-keeper-sidecar: Inherited env var cannot enable logging when the toggle is off | decision-table (config off × inherited on) | L1 | automated | `config.keeperLog.capturePiOutput=false`; `process.env` has `PI_KEEPER_CAPTURE_PI_OUTPUT="1"` and `pi_keeper_capture_pi_output="1"` | `spawnPiSession(cwd,{strategy:"headless"})` | `Object.keys(state.spawnCalls[0].env)` has no key equal, case-insensitively, to `PI_KEEPER_CAPTURE_PI_OUTPUT`; `process.env` unchanged afterward |
| E9 | shared-config: capturePiOutput gates all keeper log output | decision-table (config on) | L1 | automated | `config.keeperLog.capturePiOutput=true`; clean `process.env` | headless spawn | `state.spawnCalls[0].env.PI_KEEPER_CAPTURE_PI_OUTPUT === "1"` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | settings-panel: Help text states off disables all keeper logs | EP over locales | L1 | automated | locales en (inline default in `SettingsPanel.tsx`), hu (`i18n-hu.ts`), zh-CN (`i18n-zh-CN.ts`) | read `settings.capturePiOutputHint` per locale | each value is non-empty and differs from the pre-change string. The en value mentions that new sessions write no keeper log when off. `ui-copy-no-spawn.test.ts` passes (no "spawn" in user copy; hu and zh keys present) |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | rpc-keeper-sidecar: pi binary missing with capture disabled leaves no file | fault-injection (abort) | L1 | automated | `PI_KEEPER_PI_CMD` points at a nonexistent binary; capture unset | keeper started | keeper exit code ≠ 0 within 2 s; no `keeper-<id>.log`; no `<id>.rpc.sock` |
| X2 | rpc-keeper-sidecar: Stale socket file… (capture off) | fault-injection (stale state) | L1 | automated | pre-created stale `<id>.rpc.sock` file; capture unset | keeper started | keeper binds and reaches ready; no `keeper-<id>.log` |
| X3 | rpc-keeper-sidecar: Server closes its launch-log descriptor (failure path) | fault-injection (abort) | L1 | automated | capture `"1"`; fake `spawnDetached` returns `{ok:false,error:"boom"}` | `spawnKeeperFor` | result `{success:false}`; opened fd closed (`fstatSync` → `EBADF`); no throw |
| X4 | rpc-keeper-sidecar: Server closes its launch-log descriptor (throw path) | fault-injection (abort) | L1 | automated | capture `"1"`; fake `spawnDetached` throws `Error("boom")` | `spawnKeeperFor` | the call rejects with "boom" (or returns failure, matching existing contract); opened fd closed (`EBADF`) |
| X5 | rpc-keeper-sidecar: launch-log open failure is non-fatal | fault-injection (abort) | L1 | automated | capture `"1"`; `keeper-launch-<id>.log` pre-created as a **directory**, so `openSync` throws | `spawnKeeperFor` | spawn proceeds; fake received `logFd === undefined`; result `success:true`; no `closeSync(undefined)` throw |
| X6 | process-manager: Keeper crashes immediately with capture disabled | fault-injection (abort) | L1 | automated | config capture off; fake keeper child emits `exit(1)` at 20 ms | `spawnPiSession` headless | `code === "PI_CRASHED"`; message contains `code 1` and `Capture pi session output`; message does not contain `keeper-`; `result.stderr === undefined` |
| X7 | rpc-keeper-sidecar: Crash-window error with capture enabled points at both logs | fault-injection (abort) | L1 | automated | config capture on; fake keeper child emits `exit(1)` at 20 ms | `spawnPiSession` headless | message contains `code 1`, `keeper-<transportId>.log`, and `keeper-launch-<transportId>.log` |

---

## Coverage summary

- Requirements covered: 9/9 delta requirements: rpc-keeper-sidecar ×5, headless-spawn ×2 (via E1/E2 stdio), process-manager ×1, shared-config ×1, settings-panel ×1. The settings-panel placement scenario is unchanged behavior and already covered.
- Scenarios by class: edge 9 · perf 0 · frontend 1 · error 7
- Scenarios by level: L1 17 · L2 0 · L3 0
- Scenarios by disposition: automated 17 · manual-only 0

## New infra needed

- none. The only harness change is the env scrub in the `keeper.test.ts` env builder (hermeticity precondition).
