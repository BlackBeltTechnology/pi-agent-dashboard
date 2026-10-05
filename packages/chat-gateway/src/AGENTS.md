# DOX — packages/chat-gateway/src

Files in this directory. One row per source file. See change: add-chat-gateway.

| File | Purpose |
|------|---------|
| `configSchema.json` | Plugin config JSON Schema. `token` is `writeOnly: true` — the HOST's `redactWriteOnly` strips it from every client-facing document (`plugin_config_update` broadcast, `POST /api/config/plugins/:id`, `GET /api/config`), while the server-side `getPluginConfig()` the entry reads still carries the real value. `allowedRoots` is the mandatory spawn whitelist (empty ⇒ every spawn refused). `groupChannels` is the L4 opt-in list. `additionalProperties: false`. See change: align-ui-with-theme-tokens: `allowedRoots` / `toolPolicy` / `guardExtension` descriptions say new/started session, not spawn. `sessionVisibility` enum hidden|shown, default hidden — board visibility of gateway-started/resumed sessions. See change: hide-chat-gateway-sessions. |
