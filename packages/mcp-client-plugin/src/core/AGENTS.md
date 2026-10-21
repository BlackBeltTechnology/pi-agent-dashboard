# DOX — packages/mcp-client-plugin/src/core

Deprecated compatibility surface. The host-free logic (pi-rule mirror, two-layer reader, live-state reader, config writer, effective-view reader, `mcp-client.config` service) moved to the non-plugin library `packages/mcp-core`. See change: decouple-plugins-from-core (task 2.2).

| File | Purpose |
|------|---------|
| `index.ts` | `./core` entry: `export * from "@blackbelt-technology/pi-dashboard-mcp-core"`. `@deprecated`; kept for one minor, then removed. In-repo code imports mcp-core directly. |
