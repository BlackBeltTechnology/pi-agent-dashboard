# Tasks — add-kb-folder-slot

## 0. Scaffold the plugin
- [x] 0.1 Scaffold `packages/kb-plugin` (dashboard plugin: `package.json` `claims` + `src/client` + `src/server`) via the `dashboard-plugin-scaffold` skill. Imports Layer-1 `@blackbelt-technology/pi-dashboard-kb`; independent of the Layer-2 session extension. → verify: plugin builds, registers in the plugin registry with empty claims

## 1. Server: KB stats + reindex routes
- [x] 1.1 Add `packages/kb-plugin/src/server/kb-routes.ts` importing `@blackbelt-technology/pi-dashboard-kb` (`loadConfig`, `SqliteFtsStore`, `indexSource`). `GET /api/kb/stats?cwd` → `{ files, chunks, indexed, staleCount, indexing, jobStatus, lastError }` via `store.counts()` + job registry. → verify: route test returns counts for a seeded db, `indexed:false` for empty
- [x] 1.2 `POST /api/kb/reindex?cwd` → run `indexSource` over `loadConfig(cwd).resolvedSources`; return `{ changed, chunks }` (or `202 { jobId, status }`). → verify: reindex of a fixture folder yields `chunks > 0`
- [x] 1.3 Per-cwd job registry (`Map<cwd, JobState>`): coalesce concurrent reindex, expose `indexing` + `jobStatus`/`lastError` + last result to `/stats` so the client can distinguish `error` (failed job) from `not-indexed` (`chunks:0`, never run). → verify: two parallel POSTs start one walk; a failed job surfaces `jobStatus:"error"` + `lastError` on `/stats`
- [x] 1.4 Validate `cwd` against known folder descriptors; reject unknown paths. → verify: unknown cwd rejected, no store opened
- [x] 1.5 `staleCount` from `dox-staleness.json` (source-file drift only). → verify: seeded staleness file yields expected count; scoped away from md

## 2. Client: useKbStats hook
- [x] 2.1 Add `useKbStats(cwd)` (fetch `/api/kb/stats`, `reindex()` → POST, poll while `indexing`). → verify: hook test — poll starts on indexing, stops on completion
- [x] 2.2 Guard fetch via the client-utils fetch-json wrapper (response validation). → verify: malformed response handled

## 3. Client: FolderKbSection slot claim
- [x] 3.1 Add `packages/kb-plugin/src/client/FolderKbSection.tsx` (structural copy of `FolderGoalsSection`), claim `sidebar-folder-section`. Slot already carries `FolderDescriptor` — no core slot addition. → verify: row renders count, sibling of Goals/Automations
- [x] 3.2 Five-state derivation (error / indexing / not-indexed / stale / populated — ordered so `jobStatus:"error"` wins over `chunks:0`) per design §5, matching `openspec/changes/add-kb-folder-slot/mockups/sidebar-kb-slot.html`. → verify: render test per state, incl. failed-first-index shows `Retry` not `Index now`
- [x] 3.3 Reindex control → `reindex()`; `Index now` for empty; `Retry` for error; count tooltip `F files · N chunks`. → verify: click triggers POST, count updates on completion
- [x] 3.4 Register the claim in the `kb-plugin` manifest (`package.json` `claims`). → verify: claim appears in registry, renders in folder group

## 4. Server: KB config read/write routes
- [x] 4.1 `GET /api/kb/config?cwd` → `{ config, origin, projectPath }` via `loadConfig(cwd)`. Reuse cwd validation from 1.4. → verify: route test returns origin=project/global/defaults per fixture
- [x] 4.2 `PUT /api/kb/config?cwd` → merge edited path-fields over current project file, run `validateConfig`, atomic tmp+rename write; `400` on invalid (no write). → verify: valid write persists; invalid rejected + no file; untouched `ranking` preserved
- [x] 4.3 Bootstrap: `PUT` on `origin !== project` scaffolds a new project file (reuse `init.ts` scaffold). → verify: worktree with no file gets one written
- [x] 4.4 Optional reindex kick after successful write. → verify: count reflects new sources

## 5. Client: KB settings panel (behind `→`)
- [x] 5.1 `useKbConfig(cwd)` hook (GET config, `save(patch)` → PUT). → verify: hook test round-trips
- [x] 5.2 Register `shell-overlay-route` claim `/folder/:encodedCwd/kb` (plugin-local; no `App.tsx` edit); wire the folder row `→` to navigate there. → verify: `→` opens the page
- [x] 5.3 `KbSettingsPanel.tsx`: list sources (add/remove/reorder priority), edit include/exclude/dbPath, show origin + count, `Save + Reindex`. Round-trip untouched config fields. → verify: matches settings mockup screen; PUT carries full config
- [x] 5.4 Worktree affordances: `Create project config` + `Copy from parent repo` (rewrite sources relative to worktree cwd). → verify: copy seeds sources, save indexes

## 6. Worktree verification
- [x] 6.1 Create a worktree with no live session; confirm row shows `not indexed`; click `Index now`; confirm `chunks > 0` after. → verify: manual + e2e against docker harness
- [x] 6.2 Confirm server reindex works with zero attached pi sessions (session-less path). → verify: reindex succeeds with no bridge connected
- [x] 6.3 Worktree with no project config: open KB settings, `Copy from parent repo`, save; confirm sources indexed. → verify: worktree KB populated from copied config

## 7. Wiring + verification
- [x] 7.1 Confirm `packages/kb-plugin` wiring end-to-end: all claims (`sidebar-folder-section`, `shell-overlay-route`) + all four routes registered and reachable. (Host decided in design §1b: new `kb-plugin`, not folded into an existing plugin.) → verify: builds, claims + routes live
- [x] 7.2 Add file-index rows for new files per Documentation Update Protocol (delegate to subagent, caveman style). → verify: rows in `docs/file-index-server.md` + `docs/file-index-plugins.md` (or client split)
- [x] 7.3 Full rebuild + restart + reload; manual pass against `openspec/changes/add-kb-folder-slot/mockups/sidebar-kb-slot.html` + `openspec/changes/add-kb-folder-slot/mockups/kb-settings.html`. → verify: `npm run build` && restart && reload, browser QA
- [x] 7.4 `openspec validate add-kb-folder-slot --strict` passes. → verify: exit 0
