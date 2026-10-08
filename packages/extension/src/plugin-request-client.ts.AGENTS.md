# plugin-request-client.ts — index

Bridge half of the private plugin request lane (no pi dep). `createPluginRequestClient({send,timeoutMs=15_000,newId})` → `request(pluginId,type,payload)` (`plugin_request` frame; `request_too_large` >256 KiB never sent; `timeout`), `handleReply` (late/unknown ids dropped), `failAll(error)`. `installPluginRequest(fn)` sets `globalThis[Symbol.for("pi-dashboard.pluginRequest")]`, uninstaller removes only its own fn. See change: expose-plugin-credential-and-oauth-seams.
