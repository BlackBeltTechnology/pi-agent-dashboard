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
| `mintSpawnToken()` | Trusted-gated (priority ≤ 100); untrusted plugin's hook THROWS. Mints a spawn-correlation token BEFORE `spawnSession` — pass it as `opts.spawnToken` so the plugin can persist it as crash-recovery state. Host rejects a token already pending (`{success:false}`). |
| `renameSession(sessionId, name)` | Trusted-gated. Returns `false` for unknown session or empty name. In-memory rename + `session_updated` broadcast + `rename_session` dispatch to pi. |
| `assignSessionRef(sessionId, ref, opts?)` | Trusted-gated. Merge plugin-owned ref onto a session — same sanitization as the register path (core-reserved keys dropped, cross-owner keys dropped, first-writer-wins per key, warn-once). `opts.persist` defaults `true`: memory + `.meta.json` + broadcast. `persist:false` = memory only. `undefined` value clears the key at each layer. Returns `false` for unknown session / untrusted. |
| `networkGuard` | Host's fastify `preHandler` (cookie/token/loopback auth) for plugin-registered routes. NOT trust-gated — attaching a guard only tightens. Mount as `{ preHandler: ctx.networkGuard }`. |
| `onShutdown(fn)` | NOT trust-gated. Runs at server stop BEFORE the pi gateway tears bridges down. try/catch per subscriber. Returns unsubscribe. |

Spawn options (`PluginSpawnOptions`) additions: `spawnToken?: string` (caller-supplied correlation token, used verbatim, trusted-only), `resume?: { sessionFile: string }` (maps to session-level resume/continue), `initialPrompt?: string` (dispatched to the session on register; consumed on spawn failure). See change: relocate-goal-product-to-plugin

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
