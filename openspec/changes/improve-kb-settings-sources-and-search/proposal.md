# Improve KB Settings: Source Picker, Remote Sources, Test Search

## Why

The per-folder Knowledge Base settings page (`packages/kb-plugin/src/client/KbSettingsPanel.tsx`) is hard to use and silently drops configuration the engine supports:

- **Sources must be typed by hand.** There is no folder picker, although the host already ships one (`PathPicker`, backed by the guarded `/api/browse`). Typos surface only as an empty index after a reindex.
- **The settings page cannot test retrieval.** To check whether the KB answers a question, the user must leave the page and run `kb search` in a terminal or an agent turn. The engine's `SqliteFtsStore.search` + `searchOptsFromConfig` are already exported, but no dashboard route calls them.
- **Remote sources are dropped without a message.** The engine (`packages/kb/src/sources.ts`) resolves `git`, `https`, and `npm` sources behind trust-on-first-use (TOFU). The dashboard reindex (`reindexAll` in `kb-routes.ts`) walks `cfg.resolvedSources`, which keeps **filesystem sources only**. A GitHub repo in `knowledge_base.json` indexes from the CLI but never from the dashboard. Nothing reports the skip. The panel also hardcodes `kind: "filesystem"`, so no remote source can be added from the UI.
- **The server cannot grant trust.** The engine's server-side `promptTrust` defaults to `async () => false`, so every untrusted remote source would throw. The only grant path is the CLI's stdin `y/N` prompt. The dashboard can already *revoke* trust (`DELETE /api/kb/source-trust`, Access surface) but cannot *grant* it.

Mockup (approved): `mockups/kb-settings-sources-search/index.html` (in this change). The mockup's verdicts toggle, SSRF line, and cache-path row were dropped by design (D4, D8).

## What Changes

- Mockup: mockups/kb-settings-sources-search (in this change)

- **Folder picker.**
  - Add a `ui:path-picker` UI primitive that wraps the host `PathPicker`.
  - The panel gets a **Browse…** button in Folder mode.
  - A folder inside `cwd` is stored relative (`docs`). A folder outside it is stored absolute and gets an **outside folder** warning badge.
- **Source kind toggle.**
  - Folder | Git repo | URL selector next to the add input.
  - Git mode adds `pin` (branch/tag), `subdir`, and `refresh` fields.
  - A pasted `https://github.com/…`, `https://gitlab.com/…` or `git@…` ref auto-selects Git (UI-side; engine `classifyRef` unchanged).
  - Folder mode rejects any ref the engine would classify as remote (`scheme://`, `git@`, `git:`, `npm:`), so a remote ref is never saved as a filesystem path.
  - One source per `ref`: the index root is the ref, so a duplicate ref is refused with a hint to edit the existing source.
- **Per-source status.**
  - New `GET /api/kb/sources?cwd=` returns, per configured source: kind, indexed file count, trust state, `outside`, last outcome, revision, error, and time.
  - It opens the existing store without init or migration and never creates it.
  - The panel renders these as badges.
- **Trust consent from the dashboard.**
  - Adding a remote source opens a trust dialog: **Trust & add** / **Add without trusting** / **Cancel**.
  - An existing untrusted row offers **Trust…**.
  - Grants go through a new `POST /api/kb/source-trust` (cwd-guarded). It accepts only a `ref` that matches exactly one source in that folder's **saved** config.
  - `PUT /api/kb/config` (and the `config.set` plugin action, via one shared core) gains an optional `trustRefs` that grants trust in the same write. The response reports `untrustedRefs`.
  - Trust-store writes become atomic, and a failed grant is reported by the dashboard, never claimed as success.
  - Trust stays global (one grant covers the identical spec in every folder), and the dialog says so.
- **Dashboard reindex resolves every source kind.**
  - `reindexAll` resolves each spec in `cfg.allSourceSpecs` on its own through the engine resolvers (`resolverFor(kind ?? classifyRef(ref))`), with a non-interactive, trust-store-only `promptTrust`. It does not use `resolveAll`, because that aborts on the first failure.
  - Untrusted sources are skipped and reported, not fatal. Each source's failure is isolated from the others, and a failed source keeps its prior chunks.
  - The reindex gate counts every saved source spec. This modifies `kb-folder-slot` and ships together with the reindex change.
- **Remote resolution stops blocking the server event loop.** The git/https resolvers move from `execFileSync` to async `execFile`, so a clone never stalls the dashboard server's event loop (the known "slow tick" wedge class).
- **Test search panel.**
  - New read-only `GET /api/kb/search?cwd=&q=&limit=&docType=`, cwd-guarded.
  - It searches the **saved** index through an existing-only store open (no init, migration, or file creation) and never reindexes.
  - Ranking honours every saved source's priority.
  - Trust verdicts are left out, because their enrichment does synchronous fs/git work on the event loop.
  - The panel bottom gets a query box, a lane selector, a limit, and ranked hits (path :: heading, snippet with match marks, score, source/lane tags).
  - When the form is dirty, a notice says results reflect the last saved index.

## Dependencies

- **Hard dependency for remote-source tasks:** `harden-untrusted-content-ingestion` (D2 `net-guard.ts` SSRF guard, D3 git guard, D4 traversal-safe extraction).
  - This change exposes remote sources in a one-click UI, so the SSRF/zip-slip guards MUST land first.
  - This change does NOT build a second guard.
  - Folder picker, test search, and `/api/kb/sources` do not depend on it and may land first.
- The async-resolver rewrite (`packages/kb/src/sources.ts`) touches the same functions as that change. It is sequenced **after** it and keeps its `-c protocol.*` / `curloptResolve` flags.

## Capabilities

### New Capabilities

- `kb-plugin-search`: read-only test-search route over a folder's saved KB index.

### Modified Capabilities

- `kb-plugin-settings`:
  - Source editing gains kind toggle, picker, git fields, auto-detect.
  - New requirements: remote-source trust consent, per-source status, test search panel.
- `kb-plugin-index-jobs`: dashboard reindex resolves all source kinds, isolating each source's failure; untrusted sources are skipped; per-source status route.
- `kb-folder-slot`: the rebuild gate follows every saved source spec (the list the reindex job now walks).
- `kb-plugin-cwd-guard`: uniform enforcement extends to `/api/kb/search`, `/api/kb/sources`, `POST /api/kb/source-trust`.
- `kb-source-resolution`:
  - Remote resolution is async (non-blocking).
  - A not-trusted failure is classifiable.
  - Trust grants persist atomically and report failure.
- `plugin-ui-primitive-registry`: adds the `ui:path-picker` key + contract, and a transient-input-primitive exception to the plugin-callsite rule.
- `plugin-intent-protocol`: mirrors that exception in its "plugin client code SHALL NOT call `useUiPrimitive`" requirement.

## Impact

- **Code:**
  - `packages/kb-plugin/src/client/KbSettingsPanel.tsx` (+ new `KbSourceAdd.tsx`, `KbTrustDialog.tsx`, `KbTestSearch.tsx`, `useKbSources.ts`, `kb-api.ts`)
  - `packages/kb-plugin/src/server/kb-routes.ts`
  - `packages/kb-plugin/src/shared/kb-plugin-types.ts`
  - `packages/kb-plugin/src/i18n.ts`
  - `packages/kb/src/sources.ts`, `packages/kb/src/trust.ts`, `packages/kb/src/sqlite-store.ts` (existing-only open), `packages/kb/src/index.ts` (export `KbUntrustedSourceError`)
  - `packages/shared/src/platform/paths.ts` (isomorphic `isAbsolutePath` / `relativePath`)
  - `packages/kb-plugin/src/server/job-registry.ts`, `packages/kb-plugin/src/server/index.ts` (`config.set` → shared core)
  - `packages/shared/src/dashboard-plugin/ui-primitives.ts`
  - `packages/client/src/main.tsx`
- **API:**
  - Additive routes: `GET /api/kb/search`, `GET /api/kb/sources`, `POST /api/kb/source-trust`.
  - Additive optional fields on `PUT /api/kb/config`: request `trustRefs`, response `untrustedRefs`.
  - The engine's `recordTrust` changes from `void` to `boolean`; this is source-compatible for existing callers.
  - No existing response shape changes.
- **Config / migration:**
  - None. `knowledge_base.json` schema is unchanged; `kind`, `pin`, `subdir`, and `refresh` already exist.
  - Existing filesystem-only configs behave identically on the success path. On the error path, one throwing source no longer aborts the others.
  - Configs that already list remote sources start indexing them once trusted. Before this change they were skipped without any message.
  - A remote ref with no `kind` is now classified by its prefix and needs trust. Before this change it was walked as a nonexistent local path and indexed nothing.
- **Compatibility:**
  - CLI behaviour is unchanged except that resolvers are now async. CLI call sites already `await resolveAll`.
  - Plugins without the new primitive are unaffected.
- **Rollback:** revert the change.
  - Trust grants persist in `kb-source-trust.json` and are revocable from Access.
  - Cached clones under `sourceCacheDir` are inert.

## Discipline Skills

- `security-hardening`
  - New trust-grant endpoint: privileged write keyed by user-supplied refs.
  - New search endpoint: untrusted query string.
  - The remote fetch surface becomes reachable from the UI.
- `performance-optimization`
  - Async git/https resolution off the event loop.
  - Search and per-source counts must stay cheap on large indexes.
  - No per-root FTS scans.
- `doubt-driven-review`: "Add without trusting" semantics, and relative-vs-absolute path storage, before they stand.
- `observability-instrumentation`: per-source resolve/skip/fail outcomes logged and surfaced via `/api/kb/sources`.
- `scenario-design`: picker inside/outside cwd, untrusted vs trusted remote, dirty-form search, GitHub URL auto-detect.
- `review-code`: before commit.
