# recommended-extensions.ts — index

Curated manifest of recommended pi extensions. `RecommendedExtension` (id, source, displayName, status,…). `pi-mcp-adapter` row REMOVED; the `@blackbelt-technology/pi-dashboard-mcp-client-plugin` row carries `dashboardPlugin: "mcp-client"` with NO `requires`; apple-tools unlock text says pi's built-in MCP. See change: extract-mcp-client-plugin, migrate-mcp-to-pi-builtin. Optional first-party rows `pi-untrusted-content-guard` (autowired), `pi-dashboard-deck3d`, `pi-dashboard-music-production`. `pi-dashboard-context-budget` deliberately NOT listed — its meter extension writes `./context-budget.json` in every session cwd; use via `npx context-budget measure` (test-pinned). → see `recommended-extensions.ts.AGENTS.md`

`pi-flows` comment documents the >= 0.8.1 floor (no project-local skill sync at `session_start`; no-op `setEditFlowFlag` on unchanged value) — documented, not enforced. See change: stop-flows-edit-mode-project-writes.
