## 1. Shared config

- [x] 1.1 Test (test-plan #E1): add `packages/shared/src/__tests__/config-bridge-activation.test.ts` (see `packages/shared/src/__tests__/config-host-gate.test.ts`) — input `cfg.enabled=true`, env `off`/`" OFF "`/`0`/`false`/`No` · trigger `resolveBridgeEnabled(cfg, env)` · observable returns `false` for each
- [x] 1.2 Test (test-plan #E2): same file — input `cfg.enabled=false`, env `on`/`1`/`TRUE`/`" yes "` · trigger `resolveBridgeEnabled` · observable returns `true` for each
- [x] 1.3 Test (test-plan #E3): same file — input env unset/`""`/`"  "` × `cfg.enabled` true/false · trigger `resolveBridgeEnabled` · observable returns `cfg.enabled` in all 6 cells
- [x] 1.4 Test (test-plan #E4): same file — input env `offf`/`disabled`/`n`/`2`/`o n` × `cfg.enabled` true/false · trigger `resolveBridgeEnabled` · observable returns `cfg.enabled`
- [x] 1.5 Test (test-plan #E5): same file, temp HOME (see `config-host-gate.test.ts`) — input `bridge` absent/`{}`/`{enabled:false}`/`{enabled:"no"}`/`{enabled:0}`/`null`/bare `false` · trigger `loadConfig()` · observable `bridge.enabled` true/true/false/true/true/true/true
- [x] 1.6 Test (test-plan #E6): same file — input no config file / empty file / `{not json` · trigger `loadConfig()` · observable `bridge.enabled === true` each
- [x] 1.7 Test (test-plan #E7): same file — input temp HOME without config dir · trigger `ensureConfig()` then parse raw file · observable no `bridge` key
- [x] 1.8 Add `BridgeActivationConfig`, `DEFAULT_BRIDGE_ACTIVATION`, `parseBridgeActivation`, `resolveBridgeEnabled(cfg, env)` to `packages/shared/src/config.ts` (mirror `resolveAgentPathGate`)
- [x] 1.9 Add `bridge` to `DashboardConfig`, `DEFAULTS`, and `loadConfig` (not `ensureConfig`); 1.1–1.7 green

## 2. Bridge gate

- [x] 2.1 Test (test-plan #E8): add `packages/extension/src/__tests__/bridge-activation.test.ts` (see `packages/extension/src/__tests__/empty-actionable-guard-config.test.ts`) — input env `{PI_DASHBOARD_BRIDGE:"off"}`, `readConfig` spy → `{enabled:true}`, console spies · trigger `shouldActivateBridge(env, readConfig)` · observable returns `false`, `readConfig` 0 calls, 0 console calls
- [x] 2.2 Test (test-plan #E9): same file — input env `{}`, `readConfig` spy → `{enabled:false}` · trigger `shouldActivateBridge` · observable returns `false`, `readConfig` exactly 1 call
- [x] 2.3 Test (test-plan #X1): same file — input env `{}`, `readConfig` throws `Error("EACCES")`, console spies · trigger `shouldActivateBridge` · observable returns `true`, no throw, 0 console calls
- [x] 2.4 Create `packages/extension/src/bridge-activation.ts` exporting `shouldActivateBridge(env, readConfig)`: env-recognised short-circuits `readConfig`; any throw → `true`; no output; 2.1–2.3 green
- [x] 2.5 Call it as the first statement of the default export in `packages/extension/src/bridge.ts` (`process.env`, `() => loadConfig().bridge`), before `activateProviderRegister`; return early when `false`

## 3. Server spawn env

- [x] 3.1 Test (test-plan #E10): extend `packages/server/src/__tests__/process-manager-spawn-env.test.ts` — input base env with `PI_DASHBOARD_BRIDGE:"off"` and without it, each with/without `spawnToken` · trigger `buildSpawnEnv(base, opts)` · observable returned `PI_DASHBOARD_BRIDGE === "on"` in all 4, base still `"off"`
- [x] 3.2 Test (test-plan #E11): extend `packages/server/src/__tests__/process-manager.test.ts` `buildTmuxCommand` block — input `sessionExists` true/false × options none / token+endpoint+heap · trigger `buildTmuxCommand(...)` · observable adjacent `-e`,`PI_DASHBOARD_BRIDGE=on` exactly once, before `-c`, in all 4
- [x] 3.3 Stamp `env.PI_DASHBOARD_BRIDGE = "on"` in `buildSpawnEnv` (`packages/server/src/spawn-process/process-manager.ts`) next to the Electron-marker deletes; 3.1 green
- [x] 3.4 Always append `-e PI_DASHBOARD_BRIDGE=on` to `envArgs` in `buildTmuxCommand` (tmux + WSL tmux); 3.2 green

## 4. Process smoke (qa)

- [x] 4.1 Test (test-plan #X2): add `qa/tests/41-bridge-opt-out.sh` (see `qa/tests/10-faux-model.sh` for the `/api/sessions` snapshot diff only — NO faux fixture/model: `faux-model-integration-tests` permits exactly one faux-backed VM smoke) — input user-launched `pi --mode rpc` without a model, arm A `PI_DASHBOARD_BRIDGE=off`, arm B unset · trigger start pi, wait 15 s · observable arm A 0 new sessions, arm B exactly 1
- [x] 4.2 Test (test-plan #X3): same script — input `config.json` `bridge.enabled:false` (trap-restored), arm A env unset, arm B `PI_DASHBOARD_BRIDGE=on` · trigger start `pi --mode rpc` (no model), wait 15 s · observable arm A 0 new sessions, arm B 1
- [x] 4.3 Test (test-plan #X4): same script — input `config.json` `bridge.enabled:false` · trigger dashboard REST spawn of a headless session in a temp cwd · observable session with that cwd appears in `/api/sessions` within the readiness timeout
- [x] 4.4 Test (test-plan #X5): same script, tmux arm (skip exit 0 when tmux absent; see `qa/tests/19-tmux-spawn-injection.sh`) — input `bridge.enabled:false`, tmux spawn strategy · trigger dashboard spawn in a temp cwd · observable session registers within the readiness timeout
- [x] 4.5 Register `41-bridge-opt-out.sh` in `qa/tests/run-all.sh` and add its `qa/tests/41-bridge-opt-out.sh.AGENTS.md` row

## 5. Manual verification

- [ ] 5.1 Manual (test-plan: manual-only, #M1): interactive TUI `PI_DASHBOARD_BRIDGE=off pi` with a third-party `ask_user` extension — no dashboard tools/commands, no dashboard startup output, third-party `ask_user` works
- [ ] 5.2 Manual (test-plan: manual-only, #M2): Windows host, `bridge.enabled:false`, `wt.exe` already running — dashboard Windows Terminal spawn still registers

## 6. Docs

- [x] 6.1 `docs/faq.md` entry "How do I keep the bridge out of my own pi sessions?" (env values, config key, precedence, manifest-surface caveat, inert sessions not shown) — via DocScribe
- [x] 6.2 Update `AGENTS.md` rows: `packages/shared/src/config.ts.AGENTS.md`, `packages/extension/src/AGENTS.md` (new `bridge-activation.ts` row) + `bridge.ts.AGENTS.md`, `process-manager.ts.AGENTS.md`
- [x] 6.3 `CHANGELOG.md` `[Unreleased]` entry referencing #818
