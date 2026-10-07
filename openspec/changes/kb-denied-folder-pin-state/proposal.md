## Why

A folder the sidebar renders but the server's cwd guard does not admit (e.g. `/Users/robson/Project/rackinspect` — only archived sessions, not pinned) shows the KB pill as red **"index failed"** with tooltip `cwd not allowed`. Nothing failed: `GET /api/kb/stats` returns `403` before any index runs. The user sees a fake failure, `Retry` can never succeed, and the real fix (pin the folder) is hidden in the tooltip.

Second, worktree husks: after `ship-change` removes a worktree, its session cards keep rendering the KB pill. The pill's `GET /api/kb/stats` opens the store with the CREATING constructor (`kb-routes.ts` `openStore` → `SqliteFtsStore` `mkdirSync`), so the removed directory is resurrected as `.worktrees/<name>/.pi/dashboard/kb/index.db` — 11 such husks were found and deleted on 2026-10-07. The husk has no `knowledge_base.json`, so `Index now` walks 0 sources, finishes instantly and the pill stays "not indexed" forever — the action looks broken.

## What Changes

- KB client distinguishes a cwd-guard refusal (`403` whose body is `error: "cwd not allowed"`) from a genuine failure. Other 403s (network / host / tier gates) keep today's error behavior.
- New pill state `denied`: non-error (not red) label "not allowed", localized tooltip naming the pin remedy, no `Retry`.
- `denied` state offers ONE action **Pin folder** — sends the existing `pin_directory` WS verb for the folder cwd (only while connected); while denied, the row re-fetches stats on any `pinned_dirs_updated` broadcast (no client-side path matching; a still-refused refetch is self-correcting), so ANY pin path (this control, sidebar toggle, pin dialog) resolves the pill to its real state.
- A cwd refusal is definitive: the stats store stops polling immediately instead of spending `MAX_POLL_MISSES` retries.
- Card placement: the sibling reindex button becomes the Pin control in `denied`. Sidebar placement: the folder-menu maintenance item becomes "Pin folder".
- KB read routes never materialize a folder: `/api/kb/stats` opens an existing index read-only (absent → empty counts), like `/search` and `/sources` already do.
- Stats gain additive fields `folderMissing` (cwd is not an existing directory) and `sourceCount` (configured source specs).
- Reindex and config writes (REST and `plugin_action`) refuse a missing folder with `409 { error: "folder missing" }`; reindex refuses zero configured sources with `409 { error: "no sources configured" }` — no job, no directory created.
- Pill gains `missing` ("folder missing", no action) and `no-sources` ("no sources", action **Configure sources** → KB settings) states.
- Server cwd guard, `knownFolderCwds`, and the 403 body are UNCHANGED (option B — admitting archived-only folders — is explicitly out of scope).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `kb-plugin-stats`: "Folder KB stats retrieval" — additive `folderMissing` / `sourceCount`, read never creates an index; "Live polling while indexing" — a cwd refusal stops polling even mid-job; "Optimistic reindex acknowledgement" — a cwd-refused trigger surfaces denied, not a reindex error; "Bounded poll-miss tolerance and error surfacing" — a cwd refusal is definitive (no miss-run); "Shared per-folder stats state across consumers" — the refusal and pin-wait are shared folder state.
- `kb-folder-slot`: "KB row reflects index state" — `denied` (Pin), `missing`, `no-sources` (Configure sources) states; "KB stats route" — no materialization + new fields; "KB reindex route" — 409 for missing folder / zero sources; "KB config write route" — 409 for missing folder.
- `kb-plugin-index-jobs`: "Non-blocking reindex acknowledgement" — `202` only once preconditions (folder exists, ≥1 source) hold.
- `kb-plugin-folder-section`: "Section state and open-settings affordance" — adds `denied` (top of the ordered states); "Reindex action affordance" — the single KB action becomes "Pin folder" in `denied`; "Error state from client-side and poll failures" — cwd refusals are excluded from `error` and drive `denied`.

## Impact

- `packages/kb-plugin/src/server/kb-routes.ts` — stats via `SqliteFtsStore.openExisting` (try/catch, schema probe); shared `preflightWrite(cwd, {needsSources})` used by reindex, config write and the chained Save+Reindex; `reindexAll` existence re-check; `folderMissing`/`sourceCount` in stats; additive `reindexSkipped` in the PUT response.
- `packages/kb-plugin/src/server/index.ts` — `plugin_action` `reindex` / `config.set` use the same preflight.
- `packages/kb-plugin/src/shared/kb-plugin-types.ts` — `KbStats.folderMissing?`, `KbStats.sourceCount?` (optional on the wire for old-server compat).
- `packages/kb-plugin/src/client/kb-api.ts` — typed refusal error in the SHARED `parseJson` (all eight kb-api calls); `message` stays `json.error`, so non-KB-row consumers (`KbTestSearch`, config, sources) see byte-identical text.
- `packages/kb-plugin/src/client/kb-stats-store.ts` — `denied` snapshot field; 403 stops polling; `refetch` after pin.
- `packages/kb-plugin/src/client/useKbStats.ts` — exposes `denied`, `deniedReason`, `pinPending`, `beginPinWait`.
- `packages/kb-plugin/src/client/FolderKbSection.tsx` — `denied` state render, Pin control/menu item via `usePluginSend`.
- `packages/kb-plugin/src/i18n.ts` — ten keys (`labelNotAllowedShort`, `titleDenied`, `labelPinningShort`, `pinFolder`, `pinOffline`, `labelOffline`, `labelFolderMissingShort`, `folderMissingAction`, `labelNoSourcesShort`, `configureSources`) added to `zh-CN` AND `hu` in the same commit (parity gate).
- Tests: `kb-stats-store` / `useKbStats` / `FolderKbSection` vitest.
- Server change confined to the kb-plugin server (routes + `plugin_action` handler); wire change additive (two optional stats fields, two new 409 bodies). No persistence/migration. New client + old server: absent fields read as unknown (no `missing`/`no-sources`). Old client + new server: 409 surfaces as today's failed/Retry. Rollback = revert commit, rebuild client, restart server.
- `KbSettingsPanel` untouched — it already shows the refusal via its own config load.

## Discipline Skills

- `review-code` — non-trivial client change before commit.
- `security-hardening` not triggered: the server cwd guard is untouched and the server change only REMOVES filesystem writes (read path) or refuses them (missing folder); Pin reuses the existing user-initiated `pin_directory` verb (same admission path as the sidebar pin button), so no new trust boundary.
