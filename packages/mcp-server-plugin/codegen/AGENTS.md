
# DOX — packages/mcp-server-plugin/src/codegen

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `generate-tools.ts` | `build(routeTier)`, `generate-tools.ts` CLI (`pnpm --filter @blackbelt-technology/pi-dashboard-mcp-server-plugin codegen`). Resolves each manifest row's `input` type via the TS compiler API → JSON Schema, derives tier from `ROUTE_TIERS` (rest) or the declared tier, computes `paramSplit` (`:id`→`sessionId`), emits `src/server/generated/tools.ts` + the README `<!-- tools:start/end -->` block. See change: expand-mcp-tiered-surface. |
