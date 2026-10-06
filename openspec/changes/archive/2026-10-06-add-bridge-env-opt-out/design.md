## Context

- Server registers the bridge globally: `registerBridgeExtension(extPath)` at `packages/server/src/server.ts:499`, implemented in `packages/shared/src/bridge-register.ts:135`.
- Bridge has exactly one extension entry: `packages/extension/package.json` `pi.extensions = ["src/bridge.ts"]`.
- Bridge factory: `export default function (pi)` at `packages/extension/src/bridge.ts:214` calls `activateProviderRegister(pi)`, `activateRoleManager(pi)`, `initBridge(pi)` inside a try/catch. Every registration (tools, commands, `pi.on` handlers, MCP, connect, auto-start) flows from these three calls.
- `dashboardSpawned` is derived from `PI_DASHBOARD_SPAWN_TOKEN` (`bridge.ts:439`), which is scrubbed on first register — descendants see `false`. Not usable as the gate (would disable nested/subagent bridges).
- Server spawn env: `buildSpawnEnv(baseEnv = process.env, …)` at `packages/server/src/spawn-process/process-manager.ts:265` copies the server's env, deletes `PI_DASHBOARD_ELECTRON` / `PI_DASHBOARD_RESOURCES_PATH` (`:322-323`), pins `PI_DASHBOARD_URL`/`PI_DASHBOARD_SOCKET`, injects `PI_DASHBOARD_SPAWN_TOKEN`. All pi **session** spawns use it: tmux (`:805`), WSL tmux (`:832`), Windows Terminal (`:861`), headless/rpc-keeper (`:919`; keeper base env via `packages/server/src/rpc-keeper/keeper-env.cjs` `Object.assign({}, baseEnv, …)`). The non-session `pi mcp list --json` child (`packages/mcp-client-plugin/src/server/pi-runner.ts:27-33`, shared `buildSpawnEnvForArgv`) is deliberately unstamped — it runs no bridge session.
- tmux panes do NOT see the spawn env: a pane inherits the long-lived tmux SERVER's env (`process-manager.ts:513-528`). Token, endpoint pin and heap ceiling therefore ride per-window `-e` args built in `buildTmuxCommand` (`process-manager.ts:501-547`). `spawnWslTmux` additionally crosses the WSL boundary where host env never reaches the guest.
- `bridge.ts` has no module-load side effects (top level holds literals and pure helper definitions, `:126-153`), so a first-statement gate in the default export covers every registration.
- `loadConfig()` first calls `tightenConfigMode` (`config.ts:1945-1953`), which may chmod the file and `console.warn` on failure — pre-existing behaviour on every bridge activation today.
- Precedent for env-over-config: `AgentPathGateConfig` / `parseAgentPathGate` / `resolveAgentPathGate(cfg, env)` with `PI_DASHBOARD_AGENT_PATH_GATE=off|on` at `packages/shared/src/config.ts:541-568`.
- `writeConfigPartial` merges over the **raw** file (`packages/server/src/config-api.ts:183-188`), so unknown/new top-level keys survive Settings saves.
- `loadConfig()` is a pure read already called by the bridge during init (`bridge.ts:290`); returns defaults on missing/empty/malformed file (`config.ts:1959-1970`).

## Goals / Non-Goals

Goals: per-process opt-out that registers nothing; config-file equivalent; dashboard-spawned sessions + descendants provably unaffected; default byte-identical.

Non-goals: see proposal (Settings UI, skills, terminal env, settings.json registration).

## Decisions

### D1 — Gate at the factory, before `activateProviderRegister`
First statement of the default export, ahead of the existing activation try/catch: a resolution check that returns early when the bridge is disabled. Covers all three activators with one check; no per-feature guards. Failure handling per D4.

### D2 — Resolution: env > config > default
`resolveBridgeEnabled(cfg: BridgeActivationConfig, env = process.env): boolean`
- env trimmed+lowercased ∈ `{off,0,false,no}` → `false`
- ∈ `{on,1,true,yes}` → `true`
- otherwise (unset, empty, unknown) → `cfg.enabled`
Env decided ⇒ config not consulted (no file read on the hot path when the server stamped `on`). Mirrors `resolveAgentPathGate`, extended with the issue's value set.

### D3 — Config shape `bridge: { enabled: boolean }`
`parseBridgeActivation(raw)`: `enabled` is the boolean when `typeof === "boolean"`, else `true`. Object (not a bare boolean) leaves room for future bridge-level keys. Not seeded by `ensureConfig()` (absent ≡ enabled; seeding would churn existing files). `loadConfig` always sets `bridge`; the early-return default paths get it via `DEFAULTS`.

### D4 — Fail open
Any exception during resolution (config read) → bridge activates as today. An opt-out must never be able to silently break the dashboard. Implement as `try { if (!resolve…) return; } catch { /* fall through */ }` ahead of the existing activation block.

### D5 — Server stamps `PI_DASHBOARD_BRIDGE=on` on every session spawn
Two delivery points, both unconditional:
1. `buildSpawnEnv` — `env.PI_DASHBOARD_BRIDGE = "on"` next to the Electron-marker deletes (headless/keeper, Windows Terminal).
2. `buildTmuxCommand` — always append `-e PI_DASHBOARD_BRIDGE=on` to `envArgs` (tmux + WSL tmux), same mechanism as `tokenEnv`/`endpointEnv`/`heapEnv`, because the pane never sees the spawn env.
 Rationale: config is host-global, so a spawned session would otherwise read `bridge.enabled:false`; and the server's own `process.env` may carry a shell-exported `off`. `on` is inherited by descendants (not scrubbed, unlike the token), so nested pi / subagent processes stay attached — satisfying `plugin-spawn-scope` "control channel" (`openspec/specs/plugin-spawn-scope/spec.md:95`).

### D6 — Silent inert
The bridge emits no output of its own on the inert path (TUI cleanliness). The shared `loadConfig()` hygiene (`tightenConfigMode` chmod + its failure warn) is unchanged and may still run when env is unrecognised — same as every activation today. Diagnosability via the documented env/config and the FAQ entry.

### D7 — Testable seam `bridge-activation.ts`
Resolution + fail-open live in a small module `packages/extension/src/bridge-activation.ts` exporting `shouldActivateBridge(env, readConfig)`; `bridge.ts` default export calls it with `process.env` and `() => loadConfig().bridge`. `bridge.ts` is a ~4k-line module with heavy peers and no test imports its default export, so the decision logic is unit-tested via the seam.

## Risks / Trade-offs

- **tmux env propagation**: handled by D5 point 2 (`-e` per window). The spawn-env stamp alone would NOT reach panes.
- **Windows Terminal**: `wtEnv` is passed to the detached spawn; whether an already-running `wt.exe` instance propagates it is unverified — same exposure as today's endpoint pin on that path.
- **Inert sessions in the UI**: an opted-out `pi` is still visible to the process scanner (`packages/server/src/spawn-process/process-classifier.ts:80`) but never registers, so it shows no session card. `npm run reload` no-ops for it (reload command is registered inside `initBridge`). Intended.
- **User forces `off` inside a dashboard session** (e.g. `PI_DASHBOARD_BRIDGE=off pi` launched from an agent): honoured — explicit env wins. Intended.
- **Dashboard terminal panel**: inherits server env without the stamp; pi typed there follows env/config. Accepted (user-launched semantics).
- **Package-manifest surfaces survive**: `pi.skills` (and the dashboard-specific `pi.tools` probe metadata) in `packages/extension/package.json` are outside the extension factory; documented in the FAQ.
- **`bridge-extension` "registers ask_user during `initBridge()`"**: unaffected — scoped to `initBridge`, which the gate never reaches.

## Migration / Compatibility / Rollback

No migration. No protocol change. Older builds ignore a `bridge` key. Rollback = revert; remove `bridge` key optionally.
