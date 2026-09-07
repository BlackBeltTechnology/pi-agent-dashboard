# @blackbelt-technology/dashboard-plugin-runtime

Plugin loader, slot registry, slot consumers, plugin context API, and Vite plugin for pi-dashboard.

## Import paths

| Path | Contents |
|------|----------|
| `@blackbelt-technology/dashboard-plugin-runtime` | Slot consumers, registry types, barrel |
| `@blackbelt-technology/dashboard-plugin-runtime/context` | Client-side hooks (`usePluginConfig`, `useAllSessions`, etc.) |
| `@blackbelt-technology/dashboard-plugin-runtime/server` | Loader, `ServerPluginContext`, config validator |
| `@blackbelt-technology/dashboard-plugin-runtime/vite-plugin` | `viteDashboardPluginsPlugin` |

**Plugins MUST only import from these public paths.** Importing from `packages/client/`, `packages/server/`, or any other internal package is banned and will fail the lint suite.

## Minimum manifest

Add a `pi-dashboard-plugin` field to your package's `package.json`:

```json
{
  "name": "@blackbelt-technology/my-feature-plugin",
  "pi-dashboard-plugin": {
    "id": "my-feature",
    "displayName": "My Feature",
    "priority": 100,
    "client": "./dist/client/index.js",
    "server": "./dist/server/index.js",
    "claims": [
      { "slot": "session-card-badge", "component": "MyFeatureBadge" }
    ]
  }
}
```

Fields:
- `id` — globally unique kebab-case id.
- `priority` — sort order for multi-contribution slots. Lower = rendered first. Default 1000; first-party = 100.
- `client` — path to the built client entry (exporting React components by name).
- `server` — optional path to the server entry (exports `default function registerPlugin(ctx: ServerPluginContext)`).
- `bridge` — optional path to a pi-extension/bridge entry (auto-registered into `~/.pi/agent/settings.json` under `dashboard-<id>`).
- `configSchema` — optional relative path to a JSON Schema 7 file for plugin config validation.
- `claims` — array of slot claims.

## Slot claims

Each claim targets one slot:

```json
{ "slot": "session-card-badge", "component": "MyBadge" }
{ "slot": "tool-renderer", "toolName": "MyTool", "component": "MyToolRenderer" }
{ "slot": "command-route", "command": "/myfeature", "component": "MyFeatureView" }
{ "slot": "anchored-popover", "trigger": "my-trigger-button", "component": "MyPopover" }
{ "slot": "settings-section", "component": "MySettings", "tab": "general" }
```

### `settings-section` tab field

Use `tab` to control which tab of the Settings page your section appears in:

| Value | Tab |
|-------|-----|
| `general` (default) | General |
| `servers` | Servers |
| `packages` | Packages |
| `providers` | Providers |
| `security` | Security |
| `advanced` | Advanced |

## Client-side PluginContext API

Plugin client components receive props from the slot consumer. Hooks are available via the nearest `PluginContextProvider`:

```ts
import {
  usePluginConfig,
  useAllSessions,
  useSessionState,
  usePluginLogger,
  usePluginSend,
  usePluginRouter,
} from "@blackbelt-technology/dashboard-plugin-runtime/context";

function MyBadge({ session }) {
  const config = usePluginConfig<{ enabled: boolean }>();
  const logger = usePluginLogger(); // logs as [plugin:my-feature]
  const send = usePluginSend();
  // ...
}
```

`usePluginConfig<T>()` is reactive — it re-renders when `POST /api/config/plugins/<id>` succeeds and the server broadcasts `plugin_config_update`.

**You MUST call these hooks from within a slot contribution component** (i.e. inside a `CurrentPluginLayer`). Calling them from outside throws a descriptive error.

### Slot-claims invalidation store

A plugin whose `shouldRender` gate depends on a signal that resolves AFTER first render (e.g. a boot-time installed check) calls `bumpSlotClaimsVersion()` once the signal lands. Every mounted gate wrapper — including cards of idle/ended sessions that never broadcast `session_updated` again — re-invokes `shouldRender` synchronously. Global signals only; no per-session payload rides a bump. See change: add-blackhole-session-pipeline.

```ts
import { bumpSlotClaimsVersion } from "@blackbelt-technology/dashboard-plugin-runtime";
```

## Server-side ServerPluginContext API

Your server entry must export a default `registerPlugin` function:

```ts
// packages/my-feature-plugin/server/index.ts
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";

export default async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  ctx.fastify.get("/api/my-feature/status", async () => {
    return { ok: true };
  });

  ctx.logger.info("my-feature plugin loaded");
}
```

Available on `ctx`:
- `fastify` — Fastify instance for REST routes.
- `sessionManager` / `eventStore` — read-only dashboard state.
- `broadcastToSubscribers(msg)` — send a WebSocket message to all subscribed browsers.
- `registerPiHandler(type, handler)` / `registerBrowserHandler(type, handler)` — hook into WebSocket message flows.
- `getPluginConfig<T>()` — read this plugin's config from `~/.pi/dashboard/config.json#plugins.<id>.*`.
- `updatePluginConfig<T>(partial)` — validate, merge, persist, and broadcast `plugin_config_update`.
- `isPiExtensionInstalled?(name)` — boolean-only installed-check against pi's package registry (union of global+local scopes, ~30s cached). Optional: absent on older hosts / injected test contexts — the plugin owns a fallback. A scan failure REJECTS (never resolves `false`), so a `false` is authoritative. See change: add-blackhole-session-pipeline.
- `logger` — namespaced logger (`[plugin:<id>]`).

## Bridge auto-register

If your manifest declares `bridge`, the dashboard auto-registers it in `~/.pi/agent/settings.json` under `dashboardPluginBridges["dashboard-<id>"]` on server startup. The dashboard removes the entry when the plugin is disabled.

The `dashboard-` key prefix is reserved. User-owned extension entries in `packages[]` are never touched.

## Plugin config persistence

Plugin settings live at `~/.pi/dashboard/config.json#plugins.<id>.*`.

```json
{
  "plugins": {
    "my-feature": { "enabled": true, "pollInterval": 30 }
  }
}
```

If your manifest declares `configSchema`, the loader:
- Applies schema `default` values on read.
- Validates writes before persisting (rejects with `ValidationError` on schema violation).

## Failure isolation rules

- A plugin throwing during manifest validation, server-side load, or client-side render does NOT crash the dashboard.
- Failures are reflected in `/api/health.plugins[]` as `{ loaded: false, error: "..." }`.
- Slot consumer error boundaries catch React render errors per-claim (not per-slot), so one plugin crashing does not suppress siblings.

## Demo plugin

`packages/demo-plugin/` is a private fixture package that exercises the runtime end-to-end. It is **excluded from production builds** (manifest declares `fixture: true`). Do not use it as a template for real plugins.
