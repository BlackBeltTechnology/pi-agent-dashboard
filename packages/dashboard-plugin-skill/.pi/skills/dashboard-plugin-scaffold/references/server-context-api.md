# ServerPluginContext

If your plugin manifest declares a `server` entry, the loader dynamic-imports it after server bootstrap completes (Fastify, session manager, event store all ready) and invokes a default `registerPlugin(ctx)` function.

## Default export

```ts
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";

export default async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  // Register routes, handlers, polling, etc. here.
}
```

The loader awaits the function (if async) before proceeding to the next plugin.

## Surface

| Field | Purpose |
|---|---|
| `fastify: FastifyInstance` | Register REST routes via `ctx.fastify.register(routes, { prefix: "/api/<plugin-id>" })` |
| `sessionManager` | Read/subscribe to the session registry |
| `eventStore` | Read/subscribe to the event store |
| `broadcastToSubscribers(msg)` | Push browser-protocol messages to all subscribed clients |
| `directoryService` | Per-cwd session discovery + OpenSpec polling state |
| `registerPiHandler(type, handler)` | Handle WebSocket messages from pi extensions |
| `registerBrowserHandler(type, handler)` | Handle WebSocket messages from browsers |
| `pluginConfig: T` | Typed plugin config (validated against manifest's `configSchema`) |
| `getPluginConfig<T>()` | Re-fetch current config (post-write) |
| `updatePluginConfig<T>(partial)` | Validated write; broadcasts `plugin_config_update` |
| `logger` | Pino-style logger namespaced to the plugin id |
| `isPiExtensionInstalled?(name)` | Boolean-only installed-check vs pi's package registry (global+local union, ~30s cached). OPTIONAL — absent on older hosts/injected test contexts; plugin owns the fallback. Scan failure REJECTS (never resolves `false`). See change: add-blackhole-session-pipeline |

## Failure isolation

A plugin's `registerPlugin` throwing or rejecting:

1. Logs the error with the plugin id.
2. Marks the plugin failed in the in-memory `PluginStatusStore`.
3. Surfaces via `/api/health.plugins[]`.
4. Loader **continues** loading other plugins.

A bad plugin must never break the dashboard. See `dashboard-plugin-loader/spec.md` Requirement 7.

## Example

```ts
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";

interface MyConfig { pollIntervalSeconds: number }

export default async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  const cfg = ctx.pluginConfig as MyConfig;

  // REST route
  ctx.fastify.get("/api/my-plugin/status", async () => ({
    ok: true,
    pollIntervalSeconds: cfg.pollIntervalSeconds,
  }));

  // Polling
  setInterval(async () => {
    const sessions = ctx.sessionManager.list();
    ctx.broadcastToSubscribers({ type: "my_plugin_tick", count: sessions.length });
  }, cfg.pollIntervalSeconds * 1000);

  ctx.logger.info("my-plugin server entry ready");
}
```
