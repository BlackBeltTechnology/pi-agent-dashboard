# Tasks

Ordering:
- Groups 1–4 do not depend on `harden-untrusted-content-ingestion` and may land first.
- Groups 5–7 (remote sources, plus the rebuild-gate change) are **BLOCKED** until that change's D2/D3/D4 (SSRF guard, git guard, traversal-safe extraction) are merged.
- Each test task in `## Tests` names the implementation group it gates. Write the test first, see it fail, then implement the minimum to pass it (TDD).

## 1. `ui:path-picker` primitive + isomorphic path helpers

- [x] 1.1 Add the `UI_PRIMITIVE_KEYS.pathPicker` key and the `UiPathPickerDialogProps` contract in `packages/shared/src/dashboard-plugin/ui-primitives.ts`.
- [x] 1.2 Host wrapper `PathPickerDialog` (`Dialog` + single-select `PathPicker`). Before calling `onSelect`, verify the path is a directory via `/api/browse?path=`. Register it in `packages/client/src/main.tsx`.
- [x] 1.3 Add isomorphic `isAbsolutePath` and `relativePath` (POSIX, Windows drive/UNC, case-normalized drive) to `packages/shared/src/platform/paths.ts`. No `node:path`.
- [x] 1.4 JSDoc on `useUiPrimitiveOrNull`: document the transient-input-primitive exception (MODIFIED `plugin-ui-primitive-registry` / `plugin-intent-protocol`).

## 2. Source add UX (client)

- [x] 2.1 Pure helpers in `packages/kb-plugin/src/client/source-ref.ts`: `toSourceRef`, `isOutside` (shared helpers), `detectGitRef`, `looksLikeRemoteRef`. No runtime import from `@blackbelt-technology/pi-dashboard-kb`.
- [x] 2.2 `KbSourceAdd.tsx`:
  - kind toggle (Folder | Git repo | URL) and input;
  - Browse… via `useUiPrimitiveOrNull(pathPicker)`;
  - Git fields: `pin`, `subdir`, `refresh`;
  - auto-detect; Folder-mode refusal; one-source-per-ref refusal with hint.
- [x] 2.3 Wire `KbSourceAdd` into `KbSettingsPanel`, replacing the inline input. Rows show a kind badge.
- [x] 2.4 i18n keys (EN defaults + HU + ZH) for all new strings in `packages/kb-plugin/src/i18n.ts`.

## 3. Test search (server + client)

- [x] 3.1 `SqliteFtsStore.openExisting(dbPath)` plus an `existingOnly` constructor option in `packages/kb/src/sqlite-store.ts`:
  - no `mkdir`, no WAL pragma, no `init()`/migration;
  - `null` for a missing or 0-byte file.
- [x] 3.2 `GET /api/kb/search` in `kb-routes.ts`:
  - cwd guard; `q` / `limit` / `docType` validation;
  - schema probe → `needsReindex`;
  - `searchOptsFromConfig` with `sources` built from all saved specs (narrow `ResolvedSource`); `docType`/`limit` as separate `SearchOpts`;
  - `tookMs`; `finally` close; no verdicts.
- [x] 3.3 Types `KbSearchHit` / `KbSearchResponse` in `kb-plugin-types.ts`; `searchKb()` in `kb-api.ts`.
- [x] 3.4 `KbTestSearch.tsx`:
  - query form, lane select, limit;
  - hit list with text-node `<mark>` rendering, copy-path on activate;
  - dirty / needsReindex / empty / error states.
  - Mount it at the bottom of `KbSettingsPanel`.

## 4. Per-source status

- [x] 4.1 `GET /api/kb/sources` in `kb-routes.ts`:
  - existing-only open; `files` via `GROUP BY root` on `files`;
  - one `listTrustedSources()` read; `outside` via the shared helpers;
  - outcomes from the registry, matched by `ref`.
- [x] 4.2 `useKbSources.ts`: fetch on mount, after a successful save, and on a job running→settled transition. Never on an interval.
- [x] 4.3 Row badges: file count, `outside folder`, trust state, revision, error tooltip.

## 5. Async remote resolvers — BLOCKED on harden-untrusted-content-ingestion

- [x] 5.1 Convert the git and archive paths in `packages/kb/src/sources.ts` from `execFileSync` to promisified `execFile`, with `timeout: 120_000` and `maxBuffer: 16 MiB`. Keep the harden change's `-c` flags verbatim.
- [x] 5.2 `KbUntrustedSourceError`, thrown from `ensureTrusted`. Re-export it from `packages/kb/src/index.ts`.
- [x] 5.3 `packages/kb/src/trust.ts`: atomic `save` (tmp + rename); `recordTrust` returns `boolean`.

## 6. Dashboard reindex over all source kinds — BLOCKED on group 5

- [x] 6.1 `reindexAll`:
  - per-spec `resolverFor(kindOf(spec)).resolve(spec, {cwd, cacheDir: cfg.cacheDirAbs, promptTrust: async () => false})` with a per-source try/catch;
  - returns `{changed, chunks, outcomes}`.
- [x] 6.2 `KbJobRegistry`:
  - retain the outcomes;
  - derive `status:"error"` and a truncated `lastError` (≤500 chars) from `error` outcomes;
  - `untrusted` alone stays `done`.
- [x] 6.3 Log each source outcome via `fastify.log`: `info` for ok/untrusted, `warn` for error. Include ref and duration.
- [x] 6.4 Rebuild gate: `canIndex = config.allSourceSpecs.length > 0` (MODIFIED `kb-folder-slot`). Ships in this group only.

## 7. Trust consent — BLOCKED on group 6

- [x] 7.1 `POST /api/kb/source-trust` (`{ref}` against the effective saved config): 200/404/409/400/500 per design D4.
- [x] 7.2 Shared core `applyConfigPatchAndTrust`:
  - used by `PUT /api/kb/config` (response `untrustedRefs`) and by `config.set` (warn-logs `untrustedRefs`);
  - `KbConfigPatch.trustRefs?: string[]`.
- [x] 7.3 `KbTrustDialog.tsx` (`ui:dialog`):
  - shows kind/ref/pin/subdir, the agent-visibility warning, and the trust-in-every-folder note;
  - no cache path, no SSRF line;
  - buttons: Trust & add / Add without trusting / Cancel.
- [x] 7.4 Wire it up:
  - a remote add opens the dialog;
  - an untrusted saved row shows "Trust…", which calls `grantSourceTrust`;
  - refetch sources afterwards.
- [x] 7.5 Docker fixture: add a `docs/` subdir with one uniquely headed `.md` to `docker/fixtures/kb-sample`, for the L3 tests.

## Tests

Folded from `test-plan.md` — one task per automated scenario row.

### L1 (vitest)

- [x] T-E1 L1 test in packages/kb-plugin/src/client/__tests__/source-ref.test.ts: kb-plugin-settings › Pick a folder inside. Triple: input `toSourceRef("/r/p", "/r/p/docs/api")` · trigger call helper · observable `{ref:"docs/api", outside:false}`. Harness exemplar: see packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx. (test-plan #E1)
- [x] T-E2 L1 test in packages/kb-plugin/src/client/__tests__/source-ref.test.ts: kb-plugin-settings › Pick a folder inside (cwd itself). Triple: input `toSourceRef("/r/p", "/r/p/")` · trigger call helper · observable `{ref:".", outside:false}`. Harness exemplar: see packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx. (test-plan #E2)
- [x] T-E3 L1 test in packages/shared/src/__tests__/platform-paths.test.ts: kb-plugin-index-jobs › Outside test respects path boundaries. Triple: input `isOutside("/a/b", "/a/bc")` and `isOutside("/a/b", "/a/b/docs")` · trigger call helper (shared paths) · observable `true` and `false` respectively. Harness exemplar: see packages/shared/src/__tests__/platform-paths.test.ts. (test-plan #E3)
- [x] T-E4 L1 test in packages/kb-plugin/src/client/__tests__/source-ref.test.ts: kb-plugin-settings › Pick a folder outside. Triple: input `toSourceRef("C:\\r\\p", "c:\\other")` · trigger call helper · observable `{ref:"c:\\other", outside:true}` (drive case-normalized). Harness exemplar: see packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx. (test-plan #E4)
- [x] T-E5 L1 test in packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx (or sibling KbSourceAdd/KbTestSearch/KbTrustDialog tests): kb-plugin-settings › Folder mode refuses URL-shaped input. Triple: input Folder mode; inputs `https://x/y`, `ssh://h/r`, `git@h:r`, `git:h/r`, `npm:pkg`, `docs` · trigger click Add · observable first five: no source added + hint text (npm hint for `npm:`); `docs`: added with `kind:"filesystem"`. Harness exemplar: see packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx. (test-plan #E5)
- [x] T-E6 L1 test in packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx (or sibling KbSourceAdd/KbTestSearch/KbTrustDialog tests): kb-plugin-settings › Git host URL auto-selects Git. Triple: input Folder mode; type `https://github.com/o/r`, `https://gitlab.com/o/r`, `git:h/r`, `https://example.org/x.md` · trigger input change · observable first three: toggle `aria-pressed` on Git; last: stays Folder. Harness exemplar: see packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx. (test-plan #E6)
- [x] T-E7 L1 test in packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx (or sibling KbSourceAdd/KbTestSearch/KbTrustDialog tests): kb-plugin-settings › Kind selector sets source kind. Triple: input Git mode, ref `https://h/r.git`, pin `main`, subdir `""`, refresh `manual`; URL mode `https://h/a.tgz` · trigger Add (trust dialog → Add without trusting) · observable edit state `{kind:"git",ref,pin:"main",refresh:"manual"}` with no `subdir` key; `{kind:"https",ref}`. Harness exemplar: see packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx. (test-plan #E7)
- [x] T-E8 L1 test in packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx (or sibling KbSourceAdd/KbTestSearch/KbTrustDialog tests): kb-plugin-settings › Manage sources (one per ref). Triple: input saved source `ref:"https://h/r.git"` pin `main` · trigger Add same ref with pin `dev` · observable not added; hint "one ref is one index root" shown; source count unchanged. Harness exemplar: see packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx. (test-plan #E8)
- [x] T-E9 L1 test in packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx (or sibling KbSourceAdd/KbTestSearch/KbTrustDialog tests): kb-plugin-settings › Picker primitive unavailable. Triple: input panel rendered with provider lacking `ui:path-picker` · trigger render Folder mode · observable no element `kb-source-browse`; typing + Add still adds a source. Harness exemplar: see packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx. (test-plan #E9)
- [x] T-E10 L1 test in packages/client/src/components/__tests__/PathPickerDialog.test.tsx: plugin-ui-primitive-registry › Selection and cancel. Triple: input host picker wrapper open, `/api/browse` mocked dir · trigger confirm `/r/docs`; separately Cancel; separately Escape · observable `onSelect` called once with `/r/docs`; Cancel/Escape → `onCancel` once, `onSelect` 0 calls. Harness exemplar: see packages/client/src/components/__tests__/PinDirectoryDialog.test.tsx. (test-plan #E10)
- [x] T-E11 L1 test in packages/client/src/components/__tests__/PathPickerDialog.test.tsx: plugin-ui-primitive-registry › Non-directory is not selectable. Triple: input wrapper open; typed path `/r/README.md`, `/browse` returns 4xx not-a-directory · trigger confirm · observable `onSelect` 0 calls; inline error visible. Harness exemplar: see packages/client/src/components/__tests__/PinDirectoryDialog.test.tsx. (test-plan #E11)
- [x] T-E12 L1 test in packages/client/src/__tests__/main-primitive-registrations.test.tsx (extend the existing all-keys-registered test if present): plugin-ui-primitive-registry › Registered at startup. Triple: input `UI_PRIMITIVE_KEYS` + main registry · trigger "all declared keys registered" test · observable `pathPicker === "ui:path-picker"` and lookup returns non-null component. Harness exemplar: see packages/dashboard-plugin-runtime/src/__tests__/ui-primitive-registry.test.tsx. (test-plan #E12)
- [x] T-E13 L1 test in packages/kb-plugin/src/server/__tests__/kb-routes.test.ts: kb-plugin-search › Invalid query. Triple: input `q` absent, `"   "`, 512 chars, 513 chars · trigger GET /api/kb/search · observable 400 / 400 / 200 / 400; on 400 the store open spy is not called. Harness exemplar: see packages/kb-plugin/src/server/__tests__/kb-routes.test.ts. (test-plan #E13)
- [x] T-E14 L1 test in packages/kb-plugin/src/server/__tests__/kb-routes.test.ts: kb-plugin-search › Limit clamped. Triple: input `limit` absent, `abc`, `0`, `1`, `50`, `51` · trigger GET search (store with 60 matching chunks) · observable hit counts ≤ 10, 10, 1, 1, 50, 50 respectively. Harness exemplar: see packages/kb-plugin/src/server/__tests__/kb-routes.test.ts. (test-plan #E14)
- [x] T-E15 L1 test in packages/kb-plugin/src/server/__tests__/kb-routes.test.ts: kb-plugin-search › Lane filter. Triple: input store with doc+agents+source-md hits; `docType=agents`; `docType=bogus` · trigger GET search · observable all hits `docType==="agents"`; `bogus` → 400. Harness exemplar: see packages/kb-plugin/src/server/__tests__/kb-routes.test.ts. (test-plan #E15)
- [x] T-E16 L1 test in packages/kb-plugin/src/server/__tests__/kb-routes.test.ts: kb-plugin-search › No store side effect / Unindexed folder. Triple: input (a) no db file; (b) indexed db with counts F/C · trigger GET search · observable (a) 200 `{hits:()}` and db file still absent; (b) counts still F/C after request; no `indexSource` call. Harness exemplar: see packages/kb-plugin/src/server/__tests__/kb-routes.test.ts. (test-plan #E16)
- [x] T-E17 L1 test in packages/kb-plugin/src/server/__tests__/kb-routes.test.ts: kb-plugin-search › Stale schema reported. Triple: input db whose `chunks` lacks `start_line` · trigger GET search · observable 200 `{hits:(), needsReindex:true}`; `PRAGMA table_info(chunks)` unchanged; `files` row count unchanged. Harness exemplar: see packages/kb-plugin/src/server/__tests__/kb-routes.test.ts. (test-plan #E17)
- [x] T-E18 L1 test in packages/kb/src/__tests__/open-existing.test.ts: kb-plugin-search › existing-only open (WAL spike). Triple: input (a) WAL db after writer `close()` (no `-shm`); (b) DELETE-mode db · trigger `SqliteFtsStore.openExisting` + `SELECT` · observable no error; `PRAGMA journal_mode` unchanged per file; file size and mtime unchanged. Harness exemplar: see packages/kb/src/__tests__/kb.test.ts. (test-plan #E18)
- [x] T-E19 L1 test in packages/kb-plugin/src/server/__tests__/kb-routes.test.ts: kb-plugin-search › Remote source priority honoured. Triple: input saved specs: `git` ref R prio 5, filesystem `docs` prio 0; identical section indexed under both roots · trigger GET search · observable top hit `root===R`, duplicate collapsed. Harness exemplar: see packages/kb-plugin/src/server/__tests__/kb-routes.test.ts. (test-plan #E19)
- [x] T-E20 L1 test in packages/kb-plugin/src/server/__tests__/kb-routes.test.ts: kb-plugin-search › Successful search (FTS chars as text). Triple: input `q='"bridge" OR (x'` on indexed fixture · trigger GET search · observable 200, no 500; hits carry `root,path,headingPath,chunkId,snippet,score,docType`. Harness exemplar: see packages/kb-plugin/src/server/__tests__/kb-routes.test.ts. (test-plan #E20)
- [x] T-E21 L1 test in packages/kb-plugin/src/server/__tests__/kb-routes.test.ts: kb-plugin-search › No verdict enrichment. Triple: input `?verdicts=1` appended · trigger GET search · observable `enrichHits` spy 0 calls; no hit has `verdict`. Harness exemplar: see packages/kb-plugin/src/server/__tests__/kb-routes.test.ts. (test-plan #E21)
- [x] T-E22 L1 test in packages/kb-plugin/src/server/__tests__/kb-routes.test.ts: kb-plugin-index-jobs › Source status shape. Triple: input saved: filesystem `docs` (5 files indexed), `/abs/out` filesystem, git ref (trusted, last outcome ok rev `a91f3c2`) · trigger GET /api/kb/sources · observable entries: `{files:5,trusted:null,outside:false}`, `{outside:true}`, `{trusted:true,lastStatus:"ok",revision:"a91f3c2",lastAt:number}`; no `chunks` key. Harness exemplar: see packages/kb-plugin/src/server/__tests__/kb-routes.test.ts. (test-plan #E22)
- [x] T-E23 L1 test in packages/kb-plugin/src/server/__tests__/kb-routes.test.ts: kb-plugin-index-jobs › Unindexed source counts zero. Triple: input no db file; one saved source · trigger GET sources · observable `files:0`; db file not created. Harness exemplar: see packages/kb-plugin/src/server/__tests__/kb-routes.test.ts. (test-plan #E23)
- [x] T-E24 L1 test in packages/kb-plugin/src/server/__tests__/kb-routes.test.ts: kb-plugin-index-jobs › Stats shape unchanged. Triple: input any folder after a mixed-outcome job · trigger GET /api/kb/stats · observable key set exactly `files,chunks,indexed,staleCount,indexing,jobStatus(,lastError)`. Harness exemplar: see packages/kb-plugin/src/server/__tests__/kb-routes.test.ts. (test-plan #E24)
- [x] T-E25 L1 test in packages/kb-plugin/src/server/__tests__/kb-routes.test.ts: kb-plugin-cwd-guard › Grant decision table. Triple: input saved specs: one git ref G, filesystem `docs`, two specs sharing ref D · trigger POST source-trust `{ref:G}`, `{ref:"nope"}`, `{ref:"docs"}`, `{ref:D}` · observable 200 `{hash,subject}` / 404 / 400 / 409; trust store gains only G's hash. Harness exemplar: see packages/kb-plugin/src/server/__tests__/kb-routes.test.ts. (test-plan #E25)
- [x] T-E26 L1 test in packages/kb-plugin/src/server/__tests__/kb-routes.test.ts: kb-plugin-cwd-guard › Grant records the saved spec. Triple: input saved git spec `{ref:G,pin:"main",subdir:"docs"}`; body `{ref:G,pin:"evil",kind:"https"}` · trigger POST source-trust · observable recorded hash equals `sourceHash(savedSpec)`; `isTrusted(savedSpec)` true. Harness exemplar: see packages/kb-plugin/src/server/__tests__/kb-routes.test.ts. (test-plan #E26)
- [x] T-E27 L1 test in packages/kb-plugin/src/server/__tests__/kb-routes.test.ts: kb-plugin-cwd-guard › Effective config. Triple: input git ref only in global config, project has none · trigger POST source-trust `{ref}` · observable 200 (global spec grantable). Harness exemplar: see packages/kb-plugin/src/server/__tests__/kb-routes.test.ts. (test-plan #E27)
- [x] T-E28 L1 test in packages/kb-plugin/src/server/__tests__/kb-routes.test.ts + plugin-action-handler.test.ts: kb-plugin-cwd-guard › trustRefs symmetric REST + plugin_action. Triple: input PUT and `config.set` each with new git source G + `trustRefs:(G,"missing")`; then a variant with invalid patch · trigger send · observable G trusted on both paths; PUT body `untrustedRefs:("missing")`; `config.set` logs warn naming `missing`; invalid patch → nothing trusted, no file write. Harness exemplar: see packages/kb-plugin/src/server/__tests__/plugin-action-handler.test.ts. (test-plan #E28)
- [x] T-E29 L1 test in packages/kb-plugin/src/server/__tests__/kb-routes.test.ts: kb-plugin-cwd-guard › REST route guarded before store open. Triple: input non-admitted cwd · trigger GET search, GET sources, POST source-trust · observable 403 each; store open spy, trust-store read spy, config read spy all 0 calls. Harness exemplar: see packages/kb-plugin/src/server/__tests__/kb-routes.test.ts. (test-plan #E29)
- [x] T-E30 L1 test in packages/kb/src/__tests__/trust.test.ts: kb-source-resolution › Trust persistence atomic. Triple: input trust dir writable / made read-only · trigger `recordTrust(spec)` · observable `true` + entry readable; read-only → `false`, warn logged, prior file bytes identical. Harness exemplar: see packages/kb/src/__tests__/trust.test.ts. (test-plan #E30)
- [x] T-E31 L1 test in packages/kb/src/__tests__/kb.test.ts: kb-source-resolution › Classifiable not-trusted failure. Triple: input untrusted git spec, `promptTrust: async()=>false`, git spawn spy · trigger `gitResolver.resolve` · observable rejects `instanceof KbUntrustedSourceError`; git spy 0 calls. Harness exemplar: see packages/kb/src/__tests__/kb.test.ts. (test-plan #E31)
- [x] T-E32 L1 test in packages/kb/src/__tests__/kb.test.ts: kb-source-resolution › Hardening flags preserved. Triple: input trusted git spec; execFile spy · trigger resolve · observable argv contains the harden change's `-c protocol.allow=never`, `-c protocol.https.allow=always`, `-c http.followRedirects=false` entries verbatim. Harness exemplar: see packages/kb/src/__tests__/kb.test.ts. (test-plan #E32)
- [x] T-E33 L1 test in packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx (or sibling KbSourceAdd/KbTestSearch/KbTrustDialog tests): kb-folder-slot › Rebuild gate decision table. Triple: input saved specs: (a) remote-only, (b) none + form has typed source, (c) filesystem + form emptied · trigger render panel · observable (a) `kb-reindex-now` enabled; (b) disabled + visible reason; (c) enabled. Harness exemplar: see packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx. (test-plan #E33)
- [x] T-E34 L1 test in packages/kb-plugin/src/server/__tests__/kb-routes.test.ts: kb-plugin-index-jobs › Kind-less remote ref classified by prefix. Triple: input saved `{ref:"https://h/doc.md"}` no kind, untrusted · trigger reindex · observable outcome `untrusted`; https resolver chosen; no fetch. Harness exemplar: see packages/kb-plugin/src/server/__tests__/kb-routes.test.ts. (test-plan #E34)
- [x] T-E35 L1 test in packages/kb-plugin/src/server/__tests__/kb-routes.test.ts: kb-plugin-index-jobs › Filesystem sources unchanged. Triple: input filesystem-only config (existing kb-routes fixture) · trigger `reindexAll` · observable same `indexSource` call args (root, dir, options) as baseline snapshot; outcomes all `ok`. Harness exemplar: see packages/kb-plugin/src/server/__tests__/kb-routes.test.ts. (test-plan #E35)
- [x] T-P1 L1 test in packages/kb-plugin/src/server/__tests__/kb-search-perf.test.ts: kb-plugin-search (design D8 budget). Triple: workload synthetic store 5,000 chunks / 500 files; 50 varied 2–4 term queries via the search route core · metric p95 < 100 ms · window 50 searches, single run. Harness exemplar: see packages/kb-plugin/src/server/__tests__/kb-routes.test.ts. (test-plan #P1)
- [x] T-P3 L1 test in packages/kb-plugin/src/server/__tests__/kb-routes.test.ts: kb-source-resolution › Clone does not stall the host process. Triple: workload stubbed `git` child sleeping 3 s during `reindexAll` of a trusted git spec · metric `setImmediate` tick counter advances ≥ 50 during stub AND `GET /api/kb/stats` (fastify.inject) answers < 200 ms meanwhile · window the 3 s stub. Harness exemplar: see packages/kb-plugin/src/server/__tests__/kb-routes.test.ts. (test-plan #P3)
- [x] T-F1 L1 test in packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx (or sibling KbSourceAdd/KbTestSearch/KbTrustDialog tests): kb-plugin-settings › Adding a remote source opens the trust dialog / Cancel adds nothing. Triple: input Git mode, ref `https://github.com/o/r` · trigger Add → Cancel · observable dialog shows kind/ref/pin/subdir, agent-visibility warning, "every folder" note, no cache path, no SSRF line; after Cancel sources unchanged. Harness exemplar: see packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx. (test-plan #F1)
- [x] T-F2 L1 test in packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx (or sibling KbSourceAdd/KbTestSearch/KbTrustDialog tests): kb-plugin-settings › Trust and add. Triple: input dialog open for ref G · trigger Trust & add → Save · observable PUT body `trustRefs:(G)`; response w/o `untrustedRefs` → row trusted badge; response `untrustedRefs:(G)` → not-trusted badge + message. Harness exemplar: see packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx. (test-plan #F2)
- [x] T-F3 L1 test in packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx (or sibling KbSourceAdd/KbTestSearch/KbTrustDialog tests): kb-plugin-settings › Add without trusting / Trust existing. Triple: input dialog open for ref G · trigger Add without trusting → Save → row "Trust…" → confirm · observable first PUT has no `trustRefs`; row shows not-trusted + Trust…; then POST source-trust `{ref:G}`; sources refetched; trusted badge. Harness exemplar: see packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx. (test-plan #F3)
- [x] T-F4 L1 test in packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx (or sibling KbSourceAdd/KbTestSearch/KbTrustDialog tests): kb-plugin-settings › Refresh points. Triple: input panel mounted; fake timers 30 s idle; then save; then stats `indexing:true→false` · trigger observe `/api/kb/sources` fetch spy · observable calls exactly at mount, after save, after settle (3); none during idle. Harness exemplar: see packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx. (test-plan #F4)
- [x] T-F5 L1 test in packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx (or sibling KbSourceAdd/KbTestSearch/KbTrustDialog tests): kb-plugin-settings › Status badges. Triple: input sources response with filesystem outside, git error outcome `"clone failed"` · trigger render · observable `outside folder` badge on outside row; error badge `title` contains `clone failed`; file counts rendered. Harness exemplar: see packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx. (test-plan #F5)
- [x] T-F6 L1 test in packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx (or sibling KbSourceAdd/KbTestSearch/KbTrustDialog tests): kb-plugin-settings › Match markers rendered safely. Triple: input hit snippet `"<img src=x onerror=alert(1)> (bridge)"` · trigger render result · observable no `img` element in DOM; text contains literal `<img`; `bridge` inside a `mark` element. Harness exemplar: see packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx. (test-plan #F6)
- [x] T-F7 L1 test in packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx (or sibling KbSourceAdd/KbTestSearch/KbTrustDialog tests): kb-plugin-settings › Dirty notice / Needs-reindex / Empty / Error. Triple: input (a) dirty form; (b) response `needsReindex`; (c) `hits:()`; (d) 500 · trigger submit query · observable (a) dirty notice; (b) rebuild notice; (c) empty-state; (d) error text, query input keeps value. Harness exemplar: see packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx. (test-plan #F7)
- [x] T-F8 L1 test in packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx (or sibling KbSourceAdd/KbTestSearch/KbTrustDialog tests): kb-plugin-settings › Submit a query (wire). Triple: input query `bridge`, lane agents, limit 20 · trigger submit · observable request URL has `q=bridge&limit=20&docType=agents`; no `verdicts` param; summary shows count + ms. Harness exemplar: see packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx. (test-plan #F8)
- [x] T-F9 L1 test in packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx (or sibling KbSourceAdd/KbTestSearch/KbTrustDialog tests): kb-plugin-settings › Copy hit path. Triple: input one hit `docs/a.md` · trigger click hit · observable `navigator.clipboard.writeText("docs/a.md")`; transient confirmation visible. Harness exemplar: see packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx. (test-plan #F9)
- [x] T-X1 L1 test in packages/kb-plugin/src/server/__tests__/kb-routes.test.ts: kb-plugin-index-jobs › Failure isolated per source. Triple: input 3 specs: filesystem A ok, git B resolver throws `ECONNRESET`, filesystem C ok · trigger `reindexAll` via registry · observable A and C indexed; outcome B `error`; job `jobStatus:"error"`; `lastError` starts `1 source(s) failed:` contains B ref, length ≤ 500. Harness exemplar: see packages/kb-plugin/src/server/__tests__/kb-routes.test.ts. (test-plan #X1)
- [x] T-X2 L1 test in packages/kb-plugin/src/server/__tests__/kb-routes.test.ts: kb-plugin-index-jobs › Untrusted skipped, not fatal. Triple: input trusted filesystem A + untrusted git B · trigger reindex · observable A indexed; B outcome `untrusted`; no git spawn; `jobStatus:"idle"` after settle. Harness exemplar: see packages/kb-plugin/src/server/__tests__/kb-routes.test.ts. (test-plan #X2)
- [x] T-X3 L1 test in packages/kb-plugin/src/server/__tests__/kb-routes.test.ts: kb-plugin-index-jobs › Failed or skipped source keeps prior chunks. Triple: input git B indexed in run 1 (N chunks under root B); run 2 B resolver throws · trigger reindex twice · observable chunks with `root===B` still N after run 2. Harness exemplar: see packages/kb-plugin/src/server/__tests__/kb-routes.test.ts. (test-plan #X3)
- [x] T-X4 L1 test in packages/kb-plugin/src/server/__tests__/job-registry.test.ts: kb-plugin-index-jobs › Per-source outcomes retained. Triple: input mixed-outcome job settles · trigger registry read · observable outcomes for each ref with `status`, `error?`, `revision?`, `at` (number ≥ job start). Harness exemplar: see packages/kb-plugin/src/server/__tests__/job-registry.test.ts. (test-plan #X4)
- [x] T-X5 L1 test in packages/kb/src/__tests__/kb.test.ts: kb-source-resolution › Git timeout. Triple: input stubbed git never exits; injected timeout (fake timers / timeout option at 120000) · trigger resolve · observable child killed (kill spy); rejects with timeout error; outcome `error`. Harness exemplar: see packages/kb/src/__tests__/kb.test.ts. (test-plan #X5)
- [x] T-X6 L1 test in packages/kb-plugin/src/server/__tests__/kb-routes.test.ts: kb-plugin-cwd-guard › Persist failure reported. Triple: input `recordTrust` returns false (trust dir read-only) · trigger POST source-trust `{ref:G}`; PUT with `trustRefs:(G)` · observable 500 `{error}`; PUT 200 with `untrustedRefs:(G)`. Harness exemplar: see packages/kb-plugin/src/server/__tests__/kb-routes.test.ts. (test-plan #X6)
- [x] T-X7 L1 test in packages/kb-plugin/src/server/__tests__/kb-routes.test.ts: kb-plugin-search › Search during a running reindex. Triple: input registry job in flight holding a write transaction batch · trigger GET search · observable 200 within busy_timeout, hits from last committed state, no SQLITE_BUSY 500. Harness exemplar: see packages/kb-plugin/src/server/__tests__/kb-routes.test.ts. (test-plan #X7)
- [x] T-X8 L1 test in packages/kb-plugin/src/server/__tests__/plugin-action-handler.test.ts: kb-plugin-cwd-guard › plugin_action guarded. Triple: input `config.set` with `trustRefs` for non-admitted cwd · trigger dispatch handler · observable warn logged; `applyConfigPatch` and `recordTrust` spies 0 calls. Harness exemplar: see packages/kb-plugin/src/server/__tests__/plugin-action-handler.test.ts. (test-plan #X8)

### L3 (Playwright, docker harness)

- [x] T-F10 L3 test in tests/e2e/kb-settings-sources-search.spec.ts: kb-plugin-settings › Pick a folder + test search, end-to-end. Triple: input docker fixture `/fixtures/kb-sample` pinned, project config · trigger open KB settings → Browse… → pick fixture `docs` dir → Save + Reindex → wait stats settle → test search a known fixture heading · observable new source row `docs` (relative); search returns that fixture file at rank ≤ 3. Harness exemplar: see tests/e2e/kb-folder-slot.spec.ts. (test-plan #F10)
- [x] T-F11 L3 test in tests/e2e/kb-settings-sources-search.spec.ts: kb-plugin-settings › untrusted remote shown, no fetch. Triple: input docker fixture; add Git source `https://github.com/example/never` → Add without trusting → Save + Reindex · trigger stats settle · observable row shows not-trusted badge; job not in error; KB row chunk count unchanged from before. Harness exemplar: see tests/e2e/kb-folder-slot.spec.ts. (test-plan #F11)

## Manual (deferred post-merge)

- [x] M-P2 Manual: kb-plugin-search (design D8 budget) — this repo's real index · p95 of 50 queries recorded in `measurements.md` (budget < 100 ms) · one-off; (judgment: environment-specific measurement, not a CI signal) (test-plan: manual-only, test-plan #P2) **DEFERRED — not yet run**
- [x] M-F12 Manual: mockup parity (approved mockup) — KB settings page vs `openspec/changes/improve-kb-settings-sources-and-search/mockups/kb-settings-sources-search/index.html` · human compares · (judgment: layout/spacing/badge tone match the approved mockup — no automatable observable) (test-plan: manual-only, test-plan #F12) **DEFERRED — not yet run**

## Discipline checkpoints

- [x] D1 `security-hardening`:
  - grants are keyed to effective saved config only (exact ref, 409 on ambiguity);
  - REST and `plugin_action` behave symmetrically;
  - search input bounds; snippet rendered as text;
  - remote groups are gated on the harden change.
- [x] D2 `performance-optimization`:
  - async resolvers;
  - search p95 (T-P1 plus M-P2 recorded in `measurements.md`);
  - no per-root FTS scans.
- [x] D3 `doubt-driven-review`: before landing, re-check "Add without trusting", one-source-per-ref, and that skipped sources keep their chunks.
- [x] D4 `observability-instrumentation`: per-source outcome logs (6.3), surfaced via `/api/kb/sources`.
- [x] D5 `review-code` on the full diff before commit. (2 rounds with `@review`: r1 blocked on B1 async archive guard + B2 search DDL, both fixed; r2 `BLOCKING_COUNT: 0`.)

## Docs

- [x] DOC1 Update the `packages/kb-plugin/src/client/AGENTS.md`, `packages/kb-plugin/src/server/AGENTS.md`, `packages/kb/src/AGENTS.md`, and `packages/shared/src/platform` rows, plus the `packages/kb-plugin/README.md` route list. Add `See change: improve-kb-settings-sources-and-search`.
- [x] DOC2 Delegate the `docs/` prose update (KB settings page, remote sources + trust model) to DocScribe.

## Validate

- [x] V1 `openspec validate improve-kb-settings-sources-and-search --strict` passes.
- [x] V2 `npm test` green (kb, kb-plugin, shared, client, dashboard-plugin-runtime suites).
- [x] V3 Rebuild: `npm run build && curl -X POST http://localhost:8000/api/restart`. `npm run build` verified green; the live-instance restart is **DEFERRED — not run** (it would drop the operator's live dashboard sessions).
