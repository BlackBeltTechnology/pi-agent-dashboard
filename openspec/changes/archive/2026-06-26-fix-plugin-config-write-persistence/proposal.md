## Why

Plugin settings-section saves never persist. Every plugin settings form commits by sending the WebSocket message `plugin_config_write` (cast `as never` — it is not in the browser-protocol union). **No server handler consumes it**: the browser-gateway `default` case finds no registered handler and forwards it to the pi session, where it is dropped. Meanwhile the correct, fully-featured endpoint `POST /api/config/plugins/:id` (validates against the plugin's `configSchema`, checks enabled, merges, applies defaults, persists atomically, broadcasts `plugin_config_update`) has **zero client callers**. The two halves of the feature were never connected.

Symptom (verified): toggling a plugin setting and clicking Save shows "Settings saved" (the fire-and-forget `commit()` never throws) yet "N unsaved change" persists forever (no `plugin_config_update` round-trips, so the draft source's `isDirty` never clears), and nothing lands in `~/.pi/dashboard/config.json#plugins[id]`. This affects EVERY plugin with a settings section: `flows`, `automation`, `flows-anthropic-bridge`, `demo`, `goal`, `roles`, and the UI path of `subagents`.

## What Changes

- **Connect the two halves at one modular interception point.** The shell-provided plugin `send` (wired into `PluginContextProvider` in `App.tsx`) SHALL route any `plugin_config_write { id, config }` message to `POST /api/config/plugins/:id` instead of the dead WebSocket frame. This is generic by `id` — it works for ANY plugin with no per-plugin code.
- **Auto-handled by manifest, zero wiring.** Because the REST route loads the plugin's `configSchema` via `discoverPlugins`, validates, applies defaults, persists, and broadcasts `plugin_config_update`, a new plugin becomes fully persisted simply by declaring a `settings-section` claim + (optional) `configSchema`. No new server handler, no per-plugin registration, no client changes when adding a plugin.
- **Honor the draft-save contract.** `commit()` SHALL await the POST and reject on non-2xx so the host keeps the draft dirty and surfaces the error (the `SettingsDraftSource.commit` contract says "MUST reject on failure"). On success the server's `plugin_config_update` broadcast updates the client store, `usePluginConfig` re-renders, and the unsaved-change count clears.
- **Make the message a first-class contract.** Add `plugin_config_write` to the browser-protocol message union so plugins stop casting `as never` and the type system enforces `{ id, config }`.
- **No per-plugin migration.** All existing settings sections already send `plugin_config_write`; they start persisting once the interception lands. `subagents`' `onResponse` write-through mirror (keyed to `POST /api/config/plugins/subagents`) begins firing on UI saves too.

## Capabilities

### New Capabilities
- `plugin-config-persistence`: The end-to-end plugin settings write path — the `plugin_config_write` protocol message, its single shell-side interception that routes to the generic `POST /api/config/plugins/:id` route, the schema-validated persist + `plugin_config_update` broadcast round-trip that clears the draft-dirty state, the awaitable/rejecting `commit()` contract, and the modular guarantee that any plugin with a `settings-section` (+ optional `configSchema`) is auto-handled with no per-plugin wiring.

### Modified Capabilities
- (none — `settings-panel` and `dashboard-plugin-loader` behavior is unchanged; this change connects an existing client commit path to an existing server route.)

## Impact

- **Client:** `packages/client/src/App.tsx` — wrap the `send` passed to `PluginContextProvider` to detect `plugin_config_write` and `await` a POST to `/api/config/plugins/:id`; surface non-2xx as a thrown error so `commit()` rejects. A small `writePluginConfig(id, config)` helper in `packages/client/src/lib/` keeps the call testable.
- **Shared:** `packages/shared/src/browser-protocol.ts` — add the `plugin_config_write` message to the browser→server union; plugins drop the `as never` cast.
- **Server:** none required — `POST /api/config/plugins/:id` (`plugin-config-routes.ts`) already validates, persists, and broadcasts. (Confirm it is registered with the broadcast dep.)
- **Plugins:** none — `flows`, `automation`, etc. persist automatically once the interception lands; `subagents`' mirror hook starts firing on UI saves.
- **Backward compatibility:** additive. Plugins that never called the hook are unaffected. The dead WS frame is replaced by a real persist; no config-file format change.
- **Out of scope:** a richer per-field validation UI; migrating `subagents` off its producer-file reconcile; changing the `configSchema` discovery mechanism.
