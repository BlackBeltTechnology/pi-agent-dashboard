# DOX — packages/flows-anthropic-bridge-plugin/src/server

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `index.ts` | Server entry. Now subscribes to `flows-anthropic-bridge:status` events from bridge + publishes snapshots into shared plugin-status-store via `recordBridgeProbe`. Replaces prior plugin-local status cache. Read path stays `/api/flows-anthropic-bridge/status` but data sourced from shared store → surfaces in `/api/health.plugins[].lastProbe`. See change: fix-pi-flows-end-to-end. |
