## Why

pi 0.99 ships MCP as a built-in extension: stdio and streamable-HTTP servers from `~/.pi/agent/mcp.json` and trusted `<cwd>/.pi/mcp.json`, `${ENV}` / `!command` headers, OAuth, resources, per-tool exposure, codemode, `tool_search`, `pi.registerMcpServer()` and the `pi mcp` CLI. The dashboard is built on the third-party `pi-mcp-adapter` instead:
- `mcp-client-plugin` runs the adapter's loaders in a worker thread and mirrors its ~30-key schema, layer model and version floor.
- `mcp-server-plugin` writes its own `pi-dashboard` entry into `mcp.json`, with an adapter-only `requestHeadersCommand` plus a `header-command.mjs` script that reads `PI_DASHBOARD_MCP_TOKEN` from the pi process environment.
- apple-tools appends `pi-mcp-adapter` to `settings.json#packages` and uses the adapter's `directTools`.

An installed adapter **disables** pi's built-in MCP (it takes `/mcp`), so the two stacks are mutually exclusive. The owner chose **built-in only**: the dashboard drops `pi-mcp-adapter` entirely.

## What Changes

- **Dashboard MCP server via registration:** the bridge calls `pi.registerMcpServer("pi-dashboard", { url, headers: { Authorization: "Bearer <token>" } })` once the per-session token is delivered, and re-registers on re-mint. No `mcp.json` write, no header script. **The token is no longer placed in `process.env`**, which removes the documented "every subprocess inherits `PI_DASHBOARD_MCP_TOKEN`" exposure.
- **Migration:** on first run, remove the previously provisioned `pi-dashboard` entry from `~/.pi/agent/mcp.json` (merge-only, atomic). Otherwise it would take precedence over the registration, and since it has no `Authorization` header pi would treat it as an OAuth server.
- **BREAKING (`mcp-client` plugin):** rebuilt on pi's MCP config.
  - Two Pi layers only (global + trusted folder).
  - pi's entry shape (`command`/`args`/`env`/`cwd`, `url`/`headers`/`oauth`, `exposure`, `toolExposure`, `timeout`, `enabled`).
  - Whole-entry folder overrides, matching pi's "project entry replaces global".
  - Server status from `pi mcp list --json`.
  - Removed: the adapter worker, adapter version floor, adapter global-settings form, `adapterLoadTimeoutMs`, and the shared/import layers (`.mcp.json`, `~/.config/mcp`, host imports).
- **BREAKING (apple-tools):** writes the iMCP entry with `exposure`/`toolExposure` instead of `directTools`. It no longer adds `pi-mcp-adapter` to `settings.json#packages`.
- Remove `pi-mcp-adapter` from `mcp-client-plugin` dependencies and `requires.piExtensions`, and from `shared/src/recommended-extensions.ts`.
- The dashboard SHALL NOT register a pi `/mcp` command.
- Doctor: report when an installed `pi-mcp-adapter` has disabled the built-in MCP (diagnostic only; the dashboard does not remove the user's package).

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `dashboard-mcp-server`: per-session registration replaces file provisioning; credential not in the process environment; no adapter floor; no `/mcp` command.
- `mcp-client-config`: pi's two-layer `mcp.json` replaces the adapter's discovery, layer model, disabled semantics, global settings, schema, version floor and service port.
- `mcp-client-settings`: adapter status, global settings form and plugin timeout setting are removed; the editor and secret masking follow pi's fields; shared-server override is removed.
- `mcp-client-folder-section`: adapter-status and adapter-timeout rules are removed; folder overrides are whole-entry; untrusted folders are shown as inactive.
- `apple-tools-provisioning`: no adapter package registration; exposure instead of `directTools`.

## Impact

- **Code:** `packages/mcp-client-plugin/**` (core writer, effective view, worker/adapter port removed, schema, client editor, folder surfaces), `packages/mcp-server-plugin/src/server/{provisioning.ts,header-command.mjs,index.ts}`, `packages/extension/src/mcp-token-delivery.ts` + bridge registration, `packages/apple-tools/**`, `packages/shared/src/{recommended-extensions.ts,protocol.ts}`, doctor MCP module.
- **Dependencies:** remove `pi-mcp-adapter` (and `ajv` / `strip-json-comments` if no longer used) from `mcp-client-plugin`.
- **Users:**
  - Adapter users lose adapter-only features: host-config discovery, rmcp-mux, lifecycle modes, `approveTools`, output guard, trace, sampling, elicitation, MCP Prompts, MCP Apps UI.
  - Keeping the adapter installed disables pi's built-in MCP, and with it the dashboard's `pi-dashboard` MCP tools.
  - Needs a **BREAKING** CHANGELOG entry.
- **Depends on** `update-pi-core-0-99-adopt-apis` (pi ≥ 0.99.1 for built-in MCP and `registerMcpServer`).
- **Rollback:** revert. The migration only deletes the dashboard-owned `pi-dashboard` entry, which a reverted build re-provisions.

## Discipline Skills

`security-hardening` (MCP bearer token delivery; removing it from `process.env`) · `doubt-driven-review` (dropping a user-facing dependency and its features) · `review-code` · `react-expert` checkpoint (mcp-client editor/settings/folder surfaces) · `nodejs-expert` checkpoint (bridge registration lifecycle, config writer).
