# @blackbelt-technology/pi-dashboard-kb-extension

Isolated pi extension for the markdown knowledge base. **Not** part of the dashboard bridge (`src/extension/bridge.ts`) — a standalone extension package.

## What it does

- **Registers native tools** (`pi.registerTool`): `kb_search`, `kb_neighbors`, `kb_get` — pull retrieval over the local SQLite/FTS5 KB. The agent calls them; nothing is auto-injected.
- **`tool_result` hook — Job 1 (always on):** a `write`/`edit` to a `.md` file triggers a debounced, hash-gated incremental reindex. Editing an `AGENTS.md`/`CLAUDE.md` also acknowledges its DOX rows.
- **`tool_result` hook — Job 2 (opt-in, `doxEnforcement` default OFF):** a `write`/`edit` to a non-md source file emits one bounded, deduped nudge to update the nearest `AGENTS.md` row (or points at `kb dox init` on a treeless path).
- **`tool_call` hook — push mode (opt-in, `directoryLevelAgents.enabled && mode:"push"`):** surfaces the nearest `AGENTS.md` for a touched path. Default off (context-cost caveats).

## Install

Add to `.pi/settings.json` `packages` or `extensions`, or drop into `~/.pi/agent/extensions/`. Requires `@blackbelt-technology/pi-dashboard-kb` and a configured `.pi/dashboard/knowledge_base.json` (run `kb init`).

## Env

- `KB_DOX_ENFORCEMENT=1` — force-enable DOX row enforcement.
