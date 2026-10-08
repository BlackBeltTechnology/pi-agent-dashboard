## Why

The dashboard server writes the bridge extension into `~/.pi/agent/settings.json` at startup, so **every** pi process on the host loads it — including TUI sessions the user never asked the dashboard to observe. Once loaded, the bridge registers `ask_user`, canvas, role/model tools, `dashboard-*` commands, an MCP server and a per-turn system-prompt fragment, and tries to connect / auto-start. These collide with third-party extensions and cost prompt tokens. `autoStart: false` only stops the server spawn. There is no per-process escape hatch (GitHub issue #818).

## What Changes

- New env opt-out `PI_DASHBOARD_BRIDGE`, read once at bridge activation **before any registration**. Falsy values (`off`/`0`/`false`/`no`, trimmed, case-insensitive) make the bridge factory return immediately: no tools, commands, event handlers, MCP server, prompt splice, connection or auto-start. Truthy values (`on`/`1`/`true`/`yes`) force-enable.
- New config field `bridge.enabled` (boolean, default `true`) in `~/.pi/dashboard/config.json`, consulted only when the env is unset or unrecognised. Precedence: **env > config > default (on)**.
- The server stamps `PI_DASHBOARD_BRIDGE=on` on every pi session spawn — in `buildSpawnEnv` and, because tmux panes inherit the tmux server's env instead, as a per-window `-e` in `buildTmuxCommand` — overwriting any inherited value. Dashboard-spawned sessions and their descendants (nested pi, subagent processes — they inherit `process.env`) therefore always attach, even when the operator sets `bridge.enabled: false` or exported `PI_DASHBOARD_BRIDGE=off` in the shell that started the server.
- Default behaviour (env unset, config key absent) is unchanged. Not **BREAKING**.
- Deviation from the issue text: the issue proposed the server never sets the variable. That is insufficient once a shared config key exists (config would disable dashboard sessions) and wrong for env (`buildSpawnEnv` copies the server's own `process.env`, so a shell-exported `off` would leak into spawned sessions). Forcing `on` is strictly stronger than stripping.

## Non-goals

- Settings UI toggle for `bridge.enabled` (config-file only for now).
- Suppressing the extension package's manifest surfaces (`pi.skills`: `pi-dashboard`, `browser`, `project-init`, `doctor`; `pi.tools` probe metadata) — loaded from the package manifest, outside the extension factory.
- Changing the dashboard's integrated terminal env: pi typed into a dashboard terminal stays "user-launched" and follows env/config.
- Removing the bridge from `~/.pi/agent/settings.json` or changing `registerBridgeExtension`.

## Capabilities

### New Capabilities
- `bridge-activation-opt-out`: per-process bridge activation gate (env + config resolution, inert factory) and the server's spawn-env force-on stamp.

### Modified Capabilities
- `shared-config`: ADDED requirement for the `bridge.enabled` config field and its parser/default.

## Impact

- `packages/shared/src/config.ts` — `BridgeActivationConfig`, `parseBridgeActivation`, `resolveBridgeEnabled`, `DashboardConfig.bridge`, `loadConfig` wiring.
- `packages/extension/src/bridge-activation.ts` (new) — `shouldActivateBridge` seam; `packages/extension/src/bridge.ts` — gate at the top of the default export.
- `packages/server/src/spawn-process/process-manager.ts` — `buildSpawnEnv` + `buildTmuxCommand` stamp `PI_DASHBOARD_BRIDGE=on`.
- Docs: `docs/faq.md` entry, README env table if present, `AGENTS.md` rows.
- No protocol, schema-version, migration, or dependency change. Rollback = revert commit; an orphan `bridge` key left in `config.json` is ignored by older builds (raw-file preserve in `writeConfigPartial`).

## Discipline Skills

None apply. No auth/secrets/PII/untrusted input (env + local config only), no latency budget, no new endpoint/job/external call, no irreversible step (purely additive, revert-safe).
