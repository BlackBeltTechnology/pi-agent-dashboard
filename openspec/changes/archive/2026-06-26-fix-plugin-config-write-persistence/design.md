## Context

The dashboard has a unified settings-save contract: a section calls `useSettingsDraftSource({ id, page, isDirty, commit, reset })`; the host `SettingsPanel` aggregates dirtiness and invokes each dirty source's `commit()` on Save. Plugin settings sections implement `commit()` as `send({ type: "plugin_config_write", id, config })` via `usePluginSend`.

Two facts make this a no-op:
1. `plugin_config_write` is not in the browser-protocol union (every caller casts `as never`). The server browser-gateway `default` case has no registered handler for it, so it falls through to `handlePiGatewayForward` and is dropped.
2. The correct endpoint already exists: `POST /api/config/plugins/:id` (`plugin-config-routes.ts`) — 404/409 guards, Ajv validation against the plugin's `configSchema`, merge, `applySchemaDefaults`, atomic write, and a `plugin_config_update` broadcast. It has zero client callers.

The client already consumes `plugin_config_update` (`applyPluginConfigUpdate` → `pluginConfigs` store → `usePluginConfig` re-render). So the only missing wire is: client commit → that route.

## Goals / Non-Goals

**Goals:**
- Plugin settings actually persist and the unsaved-change indicator clears.
- One modular interception — every plugin auto-handled by `id`, no per-plugin code.
- Honor the draft contract: `commit()` rejects on failure, keeping the draft dirty.
- Type the message so plugins drop `as never`.

**Non-Goals:**
- Re-architecting the settings panel or the draft registry.
- Changing the server route's validation/persistence (already correct).
- Migrating `subagents` off its producer-file reconcile.
- A new per-field error UI beyond the existing save-failure surface.

## Decisions

**D1 — Intercept at the shell `send`, route to the REST route.** `App.tsx` wires `PluginContextProvider send={(msg) => send(msg)}`. Change it to: if `msg.type === "plugin_config_write"`, `await writePluginConfig(msg.id, msg.config)` (a `fetch` POST to `/api/config/plugins/:id`); else pass through to the WS `send`. *Alternative — server WS handler (add `registerHandler("plugin_config_write")`):* rejected. It would duplicate the route's validate/merge/defaults logic AND would NOT fire `subagents`' Fastify `onResponse` hook (keyed to the REST route), silently breaking its producer-file write-through. Routing to the real route keeps one source of truth and preserves that hook. *Alternative — per-plugin `fetch`:* rejected; touches 9 plugins and bypasses `usePluginSend`.

**D2 — Reuse the generic route; nothing per-plugin.** The route resolves `configSchema` via `discoverPlugins(repoRoot)` at request time and keys everything off `:id`. So modularity is inherent: a new plugin with a `settings-section` + `configSchema` is auto-covered. No registry to extend, no switch to update.

**D3 — Make `commit()` awaitable and rejecting (A-robust).** The interception returns a Promise; `writePluginConfig` throws on non-2xx (surfacing the route's `{ error }`). Plugin `commit()` becomes `await send(...)`-able. *Problem:* `usePluginSend` currently types `send` as `(message: unknown) => void`. *Resolution:* widen the plugin send contract to `(message: unknown) => void | Promise<void>` so `commit()` can `await` it; non-config messages still return void. Plugins change `commit` from `send({...})` to `await send({...})`. This honors `SettingsDraftSource.commit` ("MUST reject on failure → kept dirty + retry"). *Alternative — A-minimal (fire-and-forget, rely on broadcast to clear dirty):* simpler but a 400/409 would flash "Settings saved" with no error and a silently-still-dirty draft; rejected for correctness.

**D4 — First-class protocol type.** Add `PluginConfigWriteBrowserMessage { type, id, config }` to the browser-protocol union and include it in `BrowserToServerMessage`. Plugins drop `as never`. The shell interception consumes it before it reaches the WS, so the server never receives it as a frame (no server-union change needed).

## Risks / Trade-offs

- **Widening the plugin `send` return type** could ripple to other `send` callers → keep it `void | Promise<void>` (superset; existing void callers unaffected). Verify `usePluginSend` consumers compile.
- **`commit()` now awaits a network call** → a slow/failed POST blocks the host Save's `Promise.allSettled` for that source only; failures are isolated per source (existing behavior) and surface via the existing partial-fail message.
- **Route requires the plugin be enabled (409)** → editing a disabled plugin's settings now errors instead of silently "saving". This is correct; the form is only reachable when the plugin is enabled.
- **`discoverPlugins` at request time** is already how the route works; no new cost introduced by this change.

## Migration Plan

1. Add the protocol type; drop `as never` in plugin settings (mechanical).
2. Add `writePluginConfig(id, config)` client helper + the `App.tsx` interception.
3. Widen plugin `send` to `void | Promise<void>`; make each `commit()` await.
4. Confirm `registerPluginConfigRoutes` is mounted with the broadcast dep.
5. Verify end-to-end with `flows` (toggle → Save → config.json updated, unsaved clears, survives reload) and one schema-validated failure (400 keeps dirty).

Rollback: revert the interception; plugins fall back to the (dead) WS frame — no data loss, just the prior no-op behavior.

## Open Questions

- Should a successful save show an explicit per-section confirmation, or is the existing host "Settings saved" banner enough? (Lean: host banner is enough.)
- Do we also want an awaitable result (the merged config) returned to `commit()` for optimistic UI, or is the broadcast-driven re-render sufficient? (Lean: broadcast is sufficient; keep `commit()` returning `void`.)
