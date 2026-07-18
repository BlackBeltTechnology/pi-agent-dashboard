# DOX — packages/server/src/live-server

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `live-server-manager.ts` | Live-server-preview allowlist registry + SSRF gate. `createLiveServerManager(preferencesStore)`. → see `live-server-manager.ts.AGENTS.md` |
| `live-server-proxy.ts` | Reverse proxy for live-server targets on MAIN origin `/live/:id/*`. → see `live-server-proxy.ts.AGENTS.md` |
