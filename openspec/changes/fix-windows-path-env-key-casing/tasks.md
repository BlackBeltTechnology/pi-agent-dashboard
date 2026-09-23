## 1. Primitive: normalizeEnvPathKey (TDD, write tests first and confirm they fail)

- [ ] 1.1 Test: a lone `Path` is renamed on win32. Input `{ Path: "C:\\a", FOO: "1" }` · normalize with `win32` · a new object with `PATH` = `C:\a`, `FOO` = `1`, and no `Path` (test-plan #E1). New file `packages/shared/src/__tests__/env-path-key.test.ts`; see `packages/shared/src/__tests__/ensure-windows-path.test.ts` for the injected-platform style.
- [ ] 1.2 Test: variants are merged. Input `{ PATH: "C:\\managed", Path: "C:\\managed;C:\\Program Files\\Git\\cmd" }` · normalize with `win32` · a single `PATH` = `C:\managed;C:\Program Files\Git\cmd` (test-plan #E2). Same file.
- [ ] 1.3 Test: case-insensitive de-dup. Input `{ Path: "C:\\Windows\\System32;c:\\windows\\system32" }` · normalize with `win32` · `PATH` = `C:\Windows\System32` (test-plan #E3). Same file.
- [ ] 1.4 Test: undefined variant. Input `{ Path: undefined, PATH: "C:\\a" }` · normalize with `win32` · `PATH` = `C:\a`, no `Path`, no throw (test-plan #E4). Same file.
- [ ] 1.5 Test: undefined only. Input `{ Path: undefined, FOO: "1" }` · normalize with `win32` · no PATH-like key, `FOO` kept (test-plan #E5). Same file.
- [ ] 1.6 Test: empty string only. Input `{ Path: "" }` · normalize with `win32` · output deep-equals `{ PATH: "" }` (test-plan #E6). Same file.
- [ ] 1.7 Test: no variant keeps identity. Input `{ FOO: "1" }` · normalize with `win32` · `toBe(input)` (test-plan #E7). Same file.
- [ ] 1.8 Test: already normalized and idempotent. Input `{ PATH: "C:\\a" }` and the #E2 output · normalize with `win32` · `toBe(input)` for both (test-plan #E8). Same file.
- [ ] 1.9 Test: POSIX is untouched. Input `{ PATH: "/usr/bin", Path: "/opt/x" }` · normalize with `linux` and `darwin` · `toBe(input)`, values unchanged (test-plan #E9). Same file.
- [ ] 1.10 Test: variant ordering. Input `{ path: "C:\\c", Path: "C:\\b", PATH: "C:\\a" }` · normalize with `win32` · `PATH` = `C:\a;C:\b;C:\c`, the only PATH-like key (test-plan #E10). Same file.
- [ ] 1.11 Test: empty entries are dropped. Input `{ Path: ";;C:\\a;" }` · normalize with `win32` · `PATH` = `C:\a` (test-plan #E11). Same file.
- [ ] 1.12 Test: no mutation. Input frozen `{ Path: "C:\\a", PATH: "C:\\b" }` · normalize with `win32` · no throw, input values unchanged, output is a different object (test-plan #E12). Same file.
- [ ] 1.13 Implement `normalizeEnvPathKey(env, platform = process.platform)` in `packages/shared/src/platform/env-path-key.ts` (identity fast path, merge, de-dup, delete variants) and re-export it from `packages/shared/src/platform/index.ts`. Tests 1.1–1.12 go green.

## 2. #720 chokepoint: ToolResolver.buildSpawnEnv (TDD)

- [ ] 2.1 Test: the #720 regression. Input env `{ Path: "C:\\Program Files\\Git\\cmd;C:\\Windows\\System32", SYSTEMROOT: "C:\\Windows" }` · `buildSpawnEnv(env, { platform: "win32", exists })` · exactly one PATH-like key, named `PATH`, `;`-split containing Git `cmd` and System32, managed bin before Git, no `:`-joined prepend (test-plan #E13). Extend `packages/shared/src/__tests__/binary-lookup-spawn-env.test.ts`.
- [ ] 2.2 Test: POSIX is unchanged. Input `{ PATH: "/usr/bin", Path: "/opt/x" }` · `buildSpawnEnv(env, { platform: "darwin" })` · `Path` untouched, `PATH` = prepends `:` `/usr/bin` (test-plan #E14). Same file.
- [ ] 2.3 Implement in `packages/shared/src/platform/binary-lookup.ts`: after the `ELECTRON_*` strip, `base = normalizeEnvPathKey(base, opts.platform ?? process.platform)`. Join the prepends with `platform === "win32" ? ";" : path.delimiter`. Audit the existing win32-on-darwin assertions in `binary-lookup-spawn-env.test.ts` (`:26-37`) and update any that encoded the host `:` artefact.

## 3. Overlay sites (TDD)

- [ ] 3.1 Test: runner caller wins in any casing. ctx `{ Path: "C:\\caller" }` · `buildSpawnEnvForArgv("node", ctx, { platform: "win32" })` · a single `PATH` = `C:\caller` (test-plan #E15). Extend `packages/shared/src/__tests__/platform-runner.test.ts`.
- [ ] 3.2 Test: runner with an empty caller PATH. ctx `{ Path: "" }` · the same call · `PATH` = `""`, no other variant (test-plan #E16). Same file.
- [ ] 3.3 Test: runner no-op is unchanged. No ctx, non-Electron exec · `buildSpawnEnvForArgv("node", undefined, {})` · returns `undefined` (test-plan #E17). Same file.
- [ ] 3.4 Implement: `runner.buildSpawnEnvForArgv` adds `deps.platform` and merges `{ ...normalizeEnvPathKey({ ...process.env }, p), ...normalizeEnvPathKey(ctxEnv, p) }` (`packages/shared/src/platform/runner.ts`).
- [ ] 3.5 Test: the shared launcher overlay keeps the augmented PATH. `opts.env = { FOO: "1" }` with the `_spawnNodeScript` seam capturing env · `launchDashboardServer(opts)` · captured `PATH` equals `new ToolResolver({processExecPath}).buildSpawnEnv(process.env).PATH`, `FOO` = `1` (test-plan #E18). Extend `packages/shared/src/__tests__/server-launcher.test.ts` (existing `_spawnNodeScript` spy pattern at `:57`).
- [ ] 3.6 Implement: `packages/shared/src/server-launcher.ts` normalizes `opts.env` before the overlay loop.
- [ ] 3.7 Test: package-manager overlay (POSIX). `options.env = { PATH: "/caller", FOO: "1" }`, adapter spawn mocked · `spawnCaptureCommand` · spawned env `PATH` = `/caller`, `FOO` = `1`, host `HOME` kept (test-plan #E25). Extend `packages/server/src/__tests__/package-manager-wrapper.test.ts`.
- [ ] 3.8 Implement: `packages/server/src/package/package-manager-wrapper.ts` merges with both sides normalized.

## 4. Bridge caller: narrow overrides (TDD)

- [ ] 4.1 Test: the overrides are narrow. `buildBridgeEnvOverrides({ PATH: "/usr/bin", HOME: "/h", NODE_OPTIONS: "--enable-source-maps", PI_DASHBOARD_ELECTRON: "1" }, 2048)` · call · keys ⊆ override set, no `PATH`/`HOME`, `DASHBOARD_STARTER` = `Bridge`, `NODE_OPTIONS` = `--enable-source-maps --max-old-space-size=2048`, both `PI_DASHBOARD_*` = `undefined` (test-plan #E19). Migrate `packages/extension/src/__tests__/server-launcher.test.ts` (`describe("buildSpawnEnv")` at `:68`) to the new builder.
- [ ] 4.2 Test: an operator pin is respected. `NODE_OPTIONS: "--max-old-space-size=4096"`, no marker · `buildBridgeEnvOverrides(env, 2048)` · `NODE_OPTIONS` = `--max-old-space-size=4096`, no `2048`, marker = `undefined` (test-plan #E20). Same file.
- [ ] 4.3 Test: launchServer wiring. `process.env` stubbed with `PI_DASHBOARD_ELECTRON=1`, `launchDashboardServer` mocked · `launchServer(config)` · mock `env` has no `PATH`/`HOME`, `DASHBOARD_STARTER` = `Bridge`, the configured ceiling, `PI_DASHBOARD_ELECTRON` = `undefined` (test-plan #E21). Extend `packages/extension/src/__tests__/server-launcher-heap-stamp.test.ts` (existing `vi.mock` of the shared launcher at `:21`).
- [ ] 4.4 Test: markers are stripped end-to-end. `process.env` with `PI_DASHBOARD_ELECTRON=1`, `PI_DASHBOARD_RESOURCES_PATH=/r`, bridge overrides as `opts.env`, `_spawnNodeScript` capture · `launchDashboardServer` · captured env has neither key, and `PATH` equals the `buildSpawnEnv(process.env).PATH` (test-plan #E22). Extend `packages/shared/src/__tests__/server-launcher.test.ts`.
- [ ] 4.5 Implement: in `packages/extension/src/server-launcher.ts`, replace `buildSpawnEnv` with `buildBridgeEnvOverrides(baseEnv, heapMb)` (`stampHeapFlag` over a two-key seed; absent result → `undefined`; `PI_DASHBOARD_*` → `undefined`) and have `launchServer` pass it. Update the stale comment at `:151`.

## 5. Raw-env entry points (TDD)

- [ ] 5.1 Test: pi-core-updater pass-through (POSIX). Host env with a managed-runtime fixture · default `_envBuilder` through the `_spawn` seam · spawned `PATH` starts with the managed node bin and contains the host `PATH`, with one PATH-like key (test-plan #E23). Extend `packages/server/src/__tests__/pi-core-updater-managed-path.test.ts` (`_spawn` seam at `:65`).
- [ ] 5.2 Implement: the default `_envBuilder` becomes `prependManagedNodeToPath(normalizeEnvPathKey(process.env))` in `packages/server/src/pi/pi-core-updater.ts`.
- [ ] 5.3 Test: terminal env pass-through (POSIX). Host env, `node-pty` mocked · `terminalManager.spawn(cwd)` · the env given to `pty.spawn` has `PATH` = host `process.env.PATH` and `TERM` set (test-plan #E24). Extend `packages/server/src/__tests__/terminal-manager.test.ts` (existing `vi.mock("node-pty")` at `:30`).
- [ ] 5.4 Implement: `packages/server/src/terminal/terminal-manager.ts` normalizes the `{ ...process.env, ...hints }` object before `augmentEnvWithGitSource`.
- [ ] 5.5 Test: doctor test-launch env builder. (a) `buildServerLaunchTestEnv("/b/node", { PATH: "/usr/bin" }, "darwin")` gives `PATH` = `/b:/usr/bin`. (b) `buildServerLaunchTestEnv("C:\\b\\node.exe", { Path: "C:\\Git\\cmd" }, "win32")` gives a single `PATH` = `C:\b;C:\Git\cmd` (test-plan #E26). Extend `packages/electron/src/lib/__tests__/doctor-launch-test.test.ts` (pure-builder style like `buildServerLaunchTestCmd`).
- [ ] 5.6 Implement: extract and export `buildServerLaunchTestEnv` in `packages/electron/src/lib/doctor.ts`, and use it at `:432`.

## 6. Windows VM smoke (L2)

- [ ] 6.1 Author `qa/tests/16-windows-path-casing.ps1`. Create a temp dir holding a stub `tailscale.cmd` and prepend it to `$env:Path` in the pwsh session · `pi-dashboard start`, then `GET /api/tools/tailscale` · HTTP 200, `ok: true`, `path` under the temp dir (test-plan #E27). See `qa/tests/02-server-start.ps1` for the start/health/cleanup harness glue, and add a sibling `16-windows-path-casing.ps1.AGENTS.md` row file.

## 7. Verify & docs

- [ ] 7.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`, then grep the verdict. Every existing `toBe(env)` identity test in `ensure-windows-path.test.ts` / `ensure-bundled-git.test.ts` and the `managed-node-path.test.ts` clone test pass unchanged.
- [ ] 7.2 `npm run quality:changed` (Biome ratchet).
- [ ] 7.3 AGENTS.md rows: add an `env-path-key.ts` row to `packages/shared/src/platform/AGENTS.md`, and append `See change: fix-windows-path-env-key-casing` to the rows for `binary-lookup.ts`, `runner.ts`, `shared/src/server-launcher.ts`, `extension/src/server-launcher.ts.AGENTS.md` (rename `buildSpawnEnv` → `buildBridgeEnvOverrides`), `pi-core-updater.ts`, `terminal-manager.ts`, `package-manager-wrapper.ts` and `electron/src/lib/doctor.ts`.
- [ ] 7.4 Add a CHANGELOG `## [Unreleased]` entry: "Windows: tools on the system PATH no longer resolve as missing; bridge-launched server keeps the dashboard PATH prepends (#720)".
- [ ] 7.5 Manual acceptance on Windows 11 with the Electron build and Git for Windows on the system `Path`. Doctor `git source` shows host, `/api/tools/git` returns `ok: true`, and `git status` succeeds in a spawned session in a git repo. Ask the #720 reporter to confirm (test-plan: manual-only, #X1).
