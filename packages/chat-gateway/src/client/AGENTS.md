# DOX — packages/chat-gateway/src/client

Files in this directory. One row per source file. See change: add-chat-gateway.

| File | Purpose |
|------|---------|
| `index.tsx` | Settings-section client entry, claimed by `pi-dashboard-plugin.claims[]` as `ChatGatewaySettings`. Reads plugin config via `usePluginConfig<ChatGatewayConfig>()` and writes via `usePluginSend()` with `plugin_config_write`. The bot token NEVER arrives here: it is `writeOnly` in `configSchema.json` and stripped host-side by `redactWriteOnly`. |
