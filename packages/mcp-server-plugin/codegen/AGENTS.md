
# DOX — packages/mcp-server-plugin/src/codegen

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `generate-tools.ts` | `build(routeTier)`, `generate-tools.ts` CLI (`pnpm --filter @blackbelt-technology/pi-dashboard-mcp-server-plugin codegen`). Resolves each manifest row's `input` type via the TS compiler API → JSON Schema, derives tier from `ROUTE_TIERS` (rest) or the declared tier, computes `paramSplit` (`:id`→`sessionId`), emits `src/server/generated/tools.ts` + the README `<!-- tools:start/end -->` block. See change: expand-mcp-tiered-surface. `build()` also returns `verbTiersContent`; the CLI also writes `packages/shared/src/mcp/verb-tiers.generated.ts` (`{name,tier}[]`). See change: decouple-plugins-from-core (task 2.6). `schemaForRow` merges row `requiredArgs` into `required`+`properties`. See change: harden-git-terminal-plugin-boundaries. |
