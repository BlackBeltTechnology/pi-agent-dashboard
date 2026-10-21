# DOX — packages/shared/src/mcp

Files in this directory. One row per source file. MCP data shared by core and plugins. Import via `@blackbelt-technology/pi-dashboard-shared/mcp/<file>.js`. See change: decouple-plugins-from-core.

| File | Purpose |
|------|---------|
| `verb-tiers.generated.ts` | GENERATED — DO NOT EDIT. `GENERATED_VERB_TIERS: readonly {name, tier}[]` (one row per MCP tool, order = `GENERATED_TOOLS`), `GeneratedVerbTier`. Emitted by `mcp-server-plugin/codegen/generate-tools.ts` (`pnpm --filter @blackbelt-technology/pi-dashboard-mcp-server-plugin codegen`); `generated-freshness.test.ts` fails when stale. Read by chat-gateway `team/tier.ts` (no mcp-server-plugin import). |
