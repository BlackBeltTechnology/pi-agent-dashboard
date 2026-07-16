## Context

`plugin_action` is meant to be the one generic Browser→Server message that drives
any extension: `{type:"plugin_action", pluginId, sessionId, action, payload}`. The
transport is in place but the dispatch layer collapses it to a single plugin.

As-built path:

- Plugins register via `ctx.registerBrowserHandler("plugin_action", handler)`
  (`ServerPluginContext`, `packages/dashboard-plugin-runtime/src/server/server-context.ts`).
- The host wires that to `browserGateway.registerHandler(type, handler)`
  (`packages/server/src/server.ts:1776`), inside `createContext: (plugin) => …`,
  so `plugin.manifest.id` is in lexical scope at the wiring site.
- The gateway stores handlers in a single `Map<string, Handler>` keyed by message
  `type` (`packages/server/src/browser-gateway.ts:196`), and dispatch is
  `customHandlers.get(type)!(msg, ws)` in the default case (`:820`).

Because every plugin registers under the same key `"plugin_action"`,
`customHandlers.set("plugin_action", …)` is **last-writer-wins**. Load order is
`(priority asc, id asc)`; core plugins share `priority:100`, so `goal` (alpha after
`flows`) overwrites `flows`. Only `goal-plugin` has a working handler; `flows-plugin`
is a logged stub (`:88`); `kb-plugin` and `automation-plugin` register none.

The same `Map<type,Handler>` also holds legitimate single-owner core handlers
(`watch_files`, `worktree_init_subscribe`) that have no `pluginId` — the fan-out
change must not disturb those.

Each plugin already owns an in-process core the REST routes call:

- **kb**: `registry.start(cwd, () => reindexAll(cwd))`, `loadConfig(cwd)`, config
  PUT logic (`packages/kb-plugin/src/server/kb-routes.ts`).
- **automation**: `hooks.runNow(...)`, `hooks.stopRun(...)`, create/update logic
  (`packages/automation-plugin/src/server/routes.ts`).
- **flows**: `flow:run` event dispatch into the run session (`emitEventToSession` /
  `flowsActionContributions`, `packages/flows-plugin/src/server/automation-actions.ts`).

## Goals / Non-Goals

**Goals:**

- Route `plugin_action` to the handler owned by the plugin whose id equals
  `message.pluginId`, so N plugins service `plugin_action` concurrently, independent
  of load order.
- Unknown `pluginId` produces a structured error to the sender, never a silent drop.
- `flows`, `kb`, `automation` each expose a production `plugin_action` handler that
  dispatches through its existing in-process core (not an HTTP self-call).
- A contract test proving cross-plugin independence + the unknown-pluginId error.

**Non-Goals:**

- The bus client / scripting layer (`add-dashboard-bus-client-scripting`).
- New plugin actions beyond wiring each plugin's already-existing server operations.
- Removing any REST twin; REST endpoints stay until each WS path is proven.
- Request/response correlation for `plugin_action` (the primitive stays
  fire-and-forget; the error is an out-of-band message, not a correlated reply).

## Decisions

### Decision 1 — Dedicated `plugin_action` fan-out registry, alongside the existing type-keyed map

Add a second registry to the gateway: `pluginActionHandlers = Map<pluginId, Handler>`,
plus a new gateway method `registerPluginActionHandler(pluginId, handler)`. The
existing `registerHandler(type, handler)` + `customHandlers` map is **unchanged** and
keeps serving single-owner core types (`watch_files`, `worktree_init_subscribe`).

Dispatch (browser-gateway default case): if `msg.type === "plugin_action"`, look up
`pluginActionHandlers.get(msg.pluginId)` and invoke it; else fall through to the
existing `customHandlers` lookup, then `handlePiGatewayForward`.

- **Why over `Map<type, Map<pluginId, Handler>>`**: the generic nested-map forces a
  `pluginId` onto every custom type, but core handlers (`watch_files`) have none.
  A dedicated `plugin_action` registry keeps the collision fix surgical and leaves
  the core-handler path untouched. `plugin_action` is the only type with the
  multi-owner requirement, so a single special case is proportionate.

### Decision 2 — Source `pluginId` from `plugin.manifest.id` at the host wiring, not from plugin code

Plugin code is unchanged: plugins still call
`ctx.registerBrowserHandler("plugin_action", handler)`. The host closure at
`server.ts` (`createContext: (plugin) => …`) already has `plugin`, so it routes:

```
registerBrowserHandler: (type, handler) =>
  type === "plugin_action"
    ? browserGateway.registerPluginActionHandler(plugin.manifest.id, wrap(handler))
    : browserGateway.registerHandler(type, wrap(handler))
```

- **Why**: the pluginId is authoritative from the manifest at registration time; not
  trusting a self-declared id in the handler closure avoids a plugin registering under
  another plugin's id. No `ServerPluginContext` signature change, so no plugin churn.

### Decision 3 — Unknown `pluginId` → structured `plugin_action_error` to the sender ws

When `pluginActionHandlers` has no entry for `msg.pluginId`, the gateway sends a new
`ServerToBrowserMessage`, `{ type: "plugin_action_error", pluginId, action, error }`,
to the originating `ws` (via the existing `sendTo(ws, …)`), and logs it. It does not
throw and does not fall through to pi-gateway forward.

- **Why a new message type over reusing an error channel**: the client needs to
  distinguish "no such plugin handler" from generic failures; a typed message keeps
  the surface explicit and testable. Added to `src/shared` protocol types.
- **Delivery, not correlation**: `plugin()` is fire-and-forget, so this is a
  best-effort out-of-band signal to the sender, not a reply. Correlated
  request/response is the other change's concern (Non-Goal).

### Decision 4 — Real handlers dispatch through the in-process core, not HTTP re-entry

Each new handler mirrors goal-plugin's pattern: parse `{pluginId, sessionId, action,
payload}`, switch on `action`, call the same core function the REST route calls.

- **flows** — replace the stub: `flow.run` → dispatch a `flow:run` event into the run
  session through the existing flows action path (`emitEventToSession` /
  `flowsActionContributions`), the same mechanism the automation action uses;
  `flow.new` → the flow-scaffold path. No slash-command round-trip where a direct
  core call exists.
- **kb** — `reindex` → `registry.start(cwd, () => reindexAll(cwd))`; config mutation →
  the same load/patch/persist the PUT route runs.
- **automation** — `create`/`run`/`stop` → `hooks.runNow` / `hooks.stopRun` / create
  logic, guarding on the same required fields the routes enforce (`name`, `runId`).

- **Why in-process over self-HTTP**: avoids a second auth hop, keeps the handler on
  the same trust boundary as the plugin, and reuses validated core logic (DRY).
- Keep each handler's existing `if (m.pluginId !== PLUGIN_ID) return;` guard as
  defense-in-depth — redundant post-fan-out but harmless.

### Decision 5 — Advertise the newly-working handlers to bus clients

`KNOWN_PLUGIN_HANDLERS` in `packages/bus-client/src/client.ts` currently lists only
`["goal"]` and `plugin()` throws `NoPluginHandlerError` for anything else. Extend it to
`["goal","flows","kb","automation"]` so the client-side guard matches server reality.

- **Why here despite the bus-client Non-Goal**: the Non-Goal excludes building the
  scripting *layer*; keeping its allow-list truthful about which handlers now exist is
  part of "lighting up the rest." One-line data change, no new client behavior.
  (See Open Questions if this should instead be derived server-side.)

## Risks / Trade-offs

- **New untrusted-input mutation entry points (flows/kb/automation)** → each handler
  dispatches only to cores already exposed via REST, reuses their field validation,
  and inherits the plugin's existing trust gate (`priority<=100` = trusted). No new
  privilege is granted over the REST twin.
- **`sessionId`/`cwd` scoping mistakes across plugins** → each handler validates its
  own required fields (goal/flows need `sessionId`; kb/automation need `cwd`/`name`/
  `runId`) exactly as the REST routes do; malformed payload → structured error/no-op,
  never a partial mutation.
- **Regression to core custom handlers** (`watch_files`, `worktree_init_subscribe`) →
  they stay on the untouched `registerHandler`/`customHandlers` path; only
  `type==="plugin_action"` diverts to the new registry. Covered by keeping the
  existing register-handler test green.
- **Two registration surfaces could drift** (a plugin registers a non-`plugin_action`
  type and expects fan-out) → documented: fan-out is `plugin_action`-only; other types
  remain single-owner. Contract test asserts the split.
- **Silent overwrite reappearing if two plugins share a pluginId** →
  `registerPluginActionHandler` logs a warning on duplicate key (should be impossible;
  manifest ids are unique) rather than silently replacing.

## Migration Plan

1. Gateway: add `pluginActionHandlers` map + `registerPluginActionHandler` +
   dispatch branch + `plugin_action_error` send. Add the message type to `src/shared`.
2. Host: route `type==="plugin_action"` in the `registerBrowserHandler` wiring to the
   new method with `plugin.manifest.id`.
3. Handlers: flows (replace stub), kb (new), automation (new), each → its core.
4. bus-client: extend `KNOWN_PLUGIN_HANDLERS`.
5. Contract test: two plugins both reachable regardless of order; unknown pluginId
   yields `plugin_action_error`; core custom handlers still dispatch.
6. Rebuild: server change → restart; extension/plugin changes → reload. No client
   build needed unless the error message is surfaced in UI (out of scope here).

Rollback: revert the gateway branch; handlers become inert (guarded no-ops) and the
old last-writer-wins behavior returns. No persisted state, no schema migration.

## Open Questions

- Should `KNOWN_PLUGIN_HANDLERS` be derived from a server-advertised capability list
  (e.g. `/api/health.plugins[].handlesPluginAction`) instead of a hand-maintained
  array? Deferred to `add-dashboard-bus-client-scripting`; static list for now.
- Should `plugin_action_error` also carry a machine code (e.g. `"NO_HANDLER"`) for the
  client to branch on, or is the `error` string sufficient? Leaning string-only until
  a client consumer needs the code.
