# DOX — packages/server/src/live-server

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `live-server-manager.ts` | Live-server-preview allowlist registry + SSRF gate. `createLiveServerManager(preferencesStore)`. → see `live-server-manager.ts.AGENTS.md` |
| `live-capability.ts` | Live-preview capability URLs. `LiveCapabilityStore`: hash-only, 30 min idle / 12 h abs, liveness re-checked at use, `revokeBy*`. `parseCapabilityPath`: raw segment-exact `/live/<id>/~c/<token>/…`; rejects dot-segments, `%2f` `%7e` `%2e`. `redactCapability`, `stripCapabilitySegment`, `createLiveCapabilityHook`, `sessionKeyOf`. See change: retire-trusted-networks-bypass. |
| `live-server-proxy.ts` | Reverse proxy for live-server targets on MAIN origin `/live/:id/*`. → see `live-server-proxy.ts.AGENTS.md` |
