# DOX — packages/chat-gateway/src/client

Files in this directory. One row per source file. See change: add-chat-gateway.

| File | Purpose |
|------|---------|
| `index.tsx` | Settings-section client entry, claimed by `pi-dashboard-plugin.claims[]` as `ChatGatewaySettings`. Edits config (enabled, token, `allowedRoots`, `defaultCwd`, `fixedMap`, `allowlist`, `admins`, `groupChannels`, `steerPrefix`) and persists via `usePluginSend()`+`plugin_config_write`; a BLANK token is omitted so a save cannot erase the stored secret. Reads the read-only bindings/pairing/status view from `GET /api/chat-gateway/bindings`. The bot token NEVER arrives here: it is `writeOnly` in `configSchema.json` and stripped host-side by `redactWriteOnly`. Tested in `__tests__/ChatGatewaySettings.test.tsx` (jsdom). |
