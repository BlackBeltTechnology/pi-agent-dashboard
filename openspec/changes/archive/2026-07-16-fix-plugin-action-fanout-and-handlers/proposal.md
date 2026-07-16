# Make plugin_action a real universal seam: pluginId fan-out + per-plugin handlers

## Why

The dashboard's intended way to drive any extension from a client is one generic
message: `{type:"plugin_action", pluginId, sessionId, action, payload}`. As-built
it does not generalize:

1. **Last-writer-wins registry.** `browser-gateway.ts` registers handlers with
   `customHandlers.set(type, handler)` — a single `Map<string, Handler>` keyed by
   message `type`. Every plugin that wants `plugin_action` registers under the
   same `"plugin_action"` key, so the last plugin loaded **overwrites** all
   earlier ones. Load order is `(priority asc, id asc)`; all core plugins share
   `priority:100`, so `goal` (alpha-after `flows`) wins and `flows`' handler is
   silently discarded.
2. **Missing/stub handlers.** Only `goal-plugin` has a working `plugin_action`
   handler. `flows-plugin`'s is a logged stub (`flow.run`/`flow.new` TBD);
   `kb-plugin` and `automation-plugin` register none — their operations are
   REST-only.

Net effect: `plugin("flows"|"kb"|"automation", …)` over the bus reaches the wrong
handler (goal's), fails its `pluginId` guard, and is dropped. The
`add-dashboard-bus-client-scripting` change depends on this being fixed to reach
every extension; it degrades to goal-only until this lands.

## What Changes

- **Fan-out registry.** Change the `plugin_action` dispatch from last-writer-wins
  to a **pluginId-keyed fan-out**: route an incoming `plugin_action` to the
  handler registered by the plugin whose id matches `message.pluginId`. Concretely,
  either key the registry `Map<pluginId, Handler>` for `plugin_action`, or keep a
  `Map<type, Map<pluginId, Handler>>` so multiple plugins coexist. Unknown
  pluginId → explicit "no handler" error surfaced to the client (never a silent
  drop).
- **Real handlers per plugin.** Implement production `plugin_action` handlers for
  `flows-plugin` (replace the stub — wire `flow.run`/`flow.new` to the engine),
  `kb-plugin` (index/reindex/config mutations), and `automation-plugin`
  (create/run/stop) — each dispatching through its existing server core, mirroring
  goal-plugin's working pattern.
- **Contract test.** Assert that every plugin declaring a `plugin_action` handler
  is independently reachable (registering plugin B does not shadow plugin A), and
  that an unknown pluginId yields a structured error.

## Non-Goals

- The bus client / scripting layer itself (that is
  `add-dashboard-bus-client-scripting`).
- New plugin actions beyond wiring each plugin's already-existing server
  operations to `plugin_action`.
- Any REST removal — REST twins remain until each plugin's WS path is proven.

## Dependency

Unblocks the `plugin()` primitive in `add-dashboard-bus-client-scripting` for
flows/kb/automation. That change ships first (goal-only); this one lights up the
rest. No ordering hard-requirement beyond the shared `plugin_action` contract.

## Discipline Skills

- `doubt-driven-review` — changing a shared dispatch registry is a cross-cutting,
  ordering-sensitive change; stress-test before it stands.
- `security-hardening` — each new `plugin_action` handler is a new
  untrusted-input entry point that mutates plugin state.
- `systematic-debugging` — the last-writer-wins bug is load-order-dependent;
  root-cause the registration path before patching.
