# config-api.ts — index

Config REST helpers: `readRawConfig` (the config file's RAW JSON, unknown keys included — `writeConfigPartial` REPLACES whole top-level keys, so rebuilding a key from the TYPED view silently drops every field the type does not model; returns `{}` unless the parsed value is a non-array object; used by the per-entry CORS-origin revoke), `readConfigRedacted` (redacts `auth.secret`/`providers[].clientSecret` + tunnel provider secrets `tunnel.{reservedToken,zrok.reservedToken,ngrok.authtoken,tailscale.authKey}` — change: add-tunnel-providers), `writeConfigPartial` (deep-merge preserving redacted secrets incl. per-provider tunnel secrets, writes `~/.pi/dashboard/config.json`). `RESTART_FIELDS` = `{port,piPort,bindHost}` → `restartRequired`. Merges auth/tunnel/watchdog/memoryLimits/openspec subsections; propagates `bypassHosts`/`bypassUrls`; eager `refreshModelRegistry`; `setWindowsGitSourceSetting` on valid `windowsGitSource`. Returns `WriteConfigResult`.

`deleteAuthProvider(id, {force})` — raw read → delete one key from `auth.providers` → raw write. NOT `writeConfigPartial` (spread-only merge cannot express a removal) and NOT `readConfigRedacted()` (would persist `***` over every surviving provider's real `clientSecret`). Idempotent; refuses the LAST provider without `force` (`reason:"last-provider"`) because zero providers at runtime is auth ENFORCED with no login path, not auth disabled. Backs `DELETE /api/config/auth/providers/:id`. See change: config-override-oauth-redirect-base (D9).

Adds `migrateSubagentTickThrottle()` — the one-shot boot rewrite of a materialized `subagentTickThrottleMs: 0` to `DEFAULT_SUBAGENT_TICK_THROTTLE_MS`, marked by `subagentTickThrottleMigrated`. The MARKER, not the value, decides: a `0` written after the marker exists is a deliberate opt-out and is kept. Goes through `writeConfigPartial` (the only merge-preserving writer, so unrelated user keys survive). Called from `cli.ts` `main()` beside `ensureConfig()` — never from `loadConfig`, which every bridge process calls and which must never write. See change: heal-orphaned-tool-cards-on-session-end.

`serverHeap` value change now sets `restartRequired` (`/api/restart` re-reads + re-stamps the ceiling); `coldStartRequired` REMOVED from `WriteConfigResult` and the PUT response. See change: guard-server-heap-and-store-coupling (D5).

`writeConfigPartial` shallow-merges `agentPathGate` over the raw file; drops computed `agentPathGateEnvOverride`. See change: ask-agent-file-access-in-chat.

- `writeConfigPartial` shallow-merges `sessionList` (Settings sends only changed keys; keeps `archiveServiceSessionsOnEnd` opt-out). See change: archive-service-sessions-on-end.

- `writeConfigPartial` deep-merges `pairing` (Settings sends only `acceptLanRequests`; sibling pairing keys survive). See change: add-lan-knock-pairing.
Merges nested `piTrustMirror.sources` on PUT and refreshes the snapshot. See change: mirror-dashboard-trust-to-pi.

`writeConfigPartial(partial, opts?)` merges `network` field-level. Origin server-owned: change of stored `trustMode` → origin `operator`; boot passes `trustModeOrigin:"upgrade"`; unchanged mode keeps stored origin. See change: retire-trusted-networks-bypass.

`writeConfigPartial` deep-merges the `tls` block key-by-key (`{...existing.tls, ...partial.tls}`; `sources` replaced whole) so `{tls:{enabled:true}}` keeps port/host/sources. Applied live by `TlsListener.reconcile()` after the write (route `PUT /api/config`), no restart. See change: add-tailscale-cert-tls.

`writeConfigPartial` merges the `editor` sub-object (no restart). See change: gate-changed-on-disk-by-content.
`writeConfigPartial` merges `auth.capabilityRoutePlugins` (`!== undefined`, so `[]` clears the trust list). See change: add-plugin-capability-routes.
