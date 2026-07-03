## Why

The markdown knowledge base (`@blackbelt-technology/pi-dashboard-kb`) is invisible in the dashboard. Two facts about how it updates create a real trap:

1. **The KB db is per-cwd.** `loadConfig(cwd)` resolves a **per-directory** `dbAbsPath`. A git worktree checked out at a new path has no `.pi/dashboard/kb/*.db` — so `kb_search` there silently returns nothing until something indexes it. Today that empty state is undetectable from the UI.
2. **Reindex only fires from a live pi session.** The `pi-dashboard-kb-extension` reindexes on `.md` edits (debounced) and on every `kb_search` (inline). A worktree with **no attached pi session** never reindexes at all. There is no dashboard-side way to see the entry count or trigger an index.

The dashboard already proves the folder-scoped nav pattern: `FolderGoalsSection` / `FolderAutomationSection` claim the `sidebar-folder-section` slot to render `Goals (N) → + Goal` per folder. The KB deserves the same treatment: a per-folder row showing its entry count with a one-click reindex — turning the silent "empty KB in my worktree" failure into a visible, fixable state.

## What Changes

- **New folder nav slot: `KB · N chunks` + reindex,** sibling of `Goals` / `Automations` / `OpenSpec` in the folder group. Left side shows the chunk count from `store.counts()` (tooltip adds file count); right side is a reindex affordance.
- **Five-state row driven by `{ chunks, staleCount, jobStatus }`:**
  - `populated` — `chunks > 0`, fresh → `↻` reindex icon.
  - `empty` — `chunks === 0` → prominent **Index now** button (the worktree case).
  - `indexing` — a reindex job is running → spinner + optional file progress.
  - `stale` — drift detected → amber count + `↻`.
  - `error` — last job failed → **Retry**.
- **Per-folder KB settings page behind the `→` arrow** — manage the **paths** this folder indexes: the config `sources[]` (add / remove / reorder priority) plus the `include` / `exclude` globs and `dbPath`. Shows live count + `origin` (`project | global | defaults`), with a **Save + Reindex** action. This is a per-project surface (KB config is per-cwd), not the global Settings panel.
- **Worktree config bootstrap** — when a folder's config `origin` is `global` / `defaults` (no project file), the settings page offers **Create project config** and **Copy from parent repo**, so a fresh worktree gets a `sources[]` to index instead of silently indexing nothing.
- **Four new dashboard-server REST routes** (the only genuinely new backend code):
  - `GET /api/kb/stats?cwd=` → `{ files, chunks, indexed: boolean, staleCount }` from `store.counts()`.
  - `POST /api/kb/reindex?cwd=` → runs `indexSource` over the folder's resolved sources, returns `{ changed, chunks }`.
  - `GET /api/kb/config?cwd=` → `{ config, origin }` from `loadConfig(cwd)`.
  - `PUT /api/kb/config?cwd=` → `validateConfig` then write the project `knowledge_base.json`; optionally reindex.
- **Reindex runs in the dashboard-server process, not a pi session** — so a cold worktree with no live session can still be indexed. The server imports `@blackbelt-technology/pi-dashboard-kb` and calls `indexSource` / `loadConfig` / `validateConfig` directly (same pattern as goal/automation plugins owning their own server routes).

## Capabilities

### New Capabilities
- `kb-folder-slot`: a per-folder `sidebar-folder-section` claim showing KB entry count + reindex, plus a per-folder KB settings page (behind the row's `→`) that manages the indexed `sources[]` / `include` / `exclude` paths. Backed by four dashboard-server routes (`GET/POST /api/kb/stats|reindex`, `GET/PUT /api/kb/config`) that reuse the existing `store.counts()`, `indexSource`, `loadConfig`, and `validateConfig` primitives. Reindex and config writes are server-owned so worktrees with no live pi session are both indexable and configurable.

## Impact

- **New `kb-plugin` (dashboard plugin), not the session extension**: the work ships as a new `packages/kb-plugin` that imports the Layer-1 engine (`@blackbelt-technology/pi-dashboard-kb`) and is independent of the Layer-2 `kb-extension` (which needs a live session). Three-layer rationale in design.md §1b.
- **Reuse, not rebuild**: `store.counts()`, `indexSource`, `loadConfig(cwd)`, `validateConfig` already exist in `@blackbelt-technology/pi-dashboard-kb`. Stale detection reuses `dox-staleness.json` (already written by the kb extension on non-md source edits).
- **Server**: `packages/kb-plugin/src/server/kb-routes.ts` (stats/reindex + config read/write handlers) importing the kb package; a small per-cwd job registry so `indexing` state is observable and concurrent reindex requests for one cwd coalesce. Config writes go through the existing `validateConfig` before touching disk.
- **Client**: new `FolderKbSection.tsx` claiming `sidebar-folder-section` (structural copy of `FolderGoalsSection.tsx`), a `KbSettingsPanel.tsx` (per-folder sources/globs editor behind the `→`), plus `useKbStats(cwd)` + `useKbConfig(cwd)` hooks.
- **No core/shell edit**: the slots already exist and carry `FolderDescriptor { cwd }`; this ships as `kb-plugin` claims + server routes, mirroring the goal plugin. Scaffold via the `dashboard-plugin-scaffold` skill.
- **Out of scope (v1)**:
  - A KB **search** page (the `→` opens the sources/settings page, not a full-text search UI over chunks).
  - Editing the fuller config beyond paths (ranking, chunking, rerank, tokenizer) — v1 edits `sources` / `include` / `exclude` / `dbPath` only; other fields stay file-edited.
  - Md-file drift in the stale count — `dox-staleness.json` tracks non-md source drift only; md staleness would need a stat-walk and is deferred.
  - Auto-reindex on worktree creation (the button is explicit; no filesystem watcher).
  - Changing the in-session extension's reindex triggers (the `bash`-write blind spot is a separate concern, untouched here).
- **Open decisions resolved in design.md**: (1) reindex ownership (server-side, chosen) vs. reusing the in-session `reindexNow` (rejected — fails for session-less worktrees); (2) settings placement — folder-scoped behind the `→` (chosen, matches per-project config) vs. global `settings-section` with a folder picker (rejected — not folder-native).
