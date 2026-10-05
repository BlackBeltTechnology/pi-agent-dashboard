# Test Plan — improve-kb-settings-sources-and-search

Stage: design (HARD gate — 2 clarifications answered: event-loop observable, search latency budget)   Generated: 2026-10-04

Exemplars (harness glue to copy):

| Level | Exemplar |
|---|---|
| L1 kb-plugin server | `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`, `job-registry.test.ts`, `plugin-action-handler.test.ts` |
| L1 kb-plugin client | `packages/kb-plugin/src/client/__tests__/KbSettings.test.tsx` |
| L1 kb engine | `packages/kb/src/__tests__/kb.test.ts` (resolvers), `trust.test.ts`, `search-opts.test.ts` |
| L1 shared | `packages/shared/src/__tests__/platform-paths.test.ts` |
| L1 client host | `packages/client/src/components/__tests__/PinDirectoryDialog.test.tsx`, `packages/dashboard-plugin-runtime/src/__tests__/ui-primitive-registry.test.tsx` |
| L3 | `tests/e2e/kb-folder-slot.spec.ts` (docker fixture `/fixtures/kb-sample`) |

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | kb-plugin-settings › Pick a folder inside | EP | L1 | automated | `toSourceRef("/r/p", "/r/p/docs/api")` | call helper | `{ref:"docs/api", outside:false}` |
| E2 | kb-plugin-settings › Pick a folder inside (cwd itself) | BVA | L1 | automated | `toSourceRef("/r/p", "/r/p/")` | call helper | `{ref:".", outside:false}` |
| E3 | kb-plugin-index-jobs › Outside test respects path boundaries | BVA | L1 | automated | `isOutside("/a/b", "/a/bc")` and `isOutside("/a/b", "/a/b/docs")` | call helper (shared paths) | `true` and `false` respectively |
| E4 | kb-plugin-settings › Pick a folder outside | EP | L1 | automated | `toSourceRef("C:\\r\\p", "c:\\other")` | call helper | `{ref:"c:\\other", outside:true}` (drive case-normalized) |
| E5 | kb-plugin-settings › Folder mode refuses URL-shaped input | decision-table | L1 | automated | Folder mode; inputs `https://x/y`, `ssh://h/r`, `git@h:r`, `git:h/r`, `npm:pkg`, `docs` | click Add | first five: no source added + hint text (npm hint for `npm:`); `docs`: added with `kind:"filesystem"` |
| E6 | kb-plugin-settings › Git host URL auto-selects Git | decision-table | L1 | automated | Folder mode; type `https://github.com/o/r`, `https://gitlab.com/o/r`, `git:h/r`, `https://example.org/x.md` | input change | first three: toggle `aria-pressed` on Git; last: stays Folder |
| E7 | kb-plugin-settings › Kind selector sets source kind | decision-table | L1 | automated | Git mode, ref `https://h/r.git`, pin `main`, subdir `""`, refresh `manual`; URL mode `https://h/a.tgz` | Add (trust dialog → Add without trusting) | edit state `{kind:"git",ref,pin:"main",refresh:"manual"}` with no `subdir` key; `{kind:"https",ref}` |
| E8 | kb-plugin-settings › Manage sources (one per ref) | EP | L1 | automated | saved source `ref:"https://h/r.git"` pin `main` | Add same ref with pin `dev` | not added; hint "one ref is one index root" shown; source count unchanged |
| E9 | kb-plugin-settings › Picker primitive unavailable | decision-table | L1 | automated | panel rendered with provider lacking `ui:path-picker` | render Folder mode | no element `kb-source-browse`; typing + Add still adds a source |
| E10 | plugin-ui-primitive-registry › Selection and cancel | state-transition | L1 | automated | host picker wrapper open, `/api/browse` mocked dir | confirm `/r/docs`; separately Cancel; separately Escape | `onSelect` called once with `/r/docs`; Cancel/Escape → `onCancel` once, `onSelect` 0 calls |
| E11 | plugin-ui-primitive-registry › Non-directory is not selectable | EP | L1 | automated | wrapper open; typed path `/r/README.md`, `/browse` returns 4xx not-a-directory | confirm | `onSelect` 0 calls; inline error visible |
| E12 | plugin-ui-primitive-registry › Registered at startup | invariant | L1 | automated | `UI_PRIMITIVE_KEYS` + main registry | "all declared keys registered" test | `pathPicker === "ui:path-picker"` and lookup returns non-null component |
| E13 | kb-plugin-search › Invalid query | BVA | L1 | automated | `q` absent, `"   "`, 512 chars, 513 chars | GET /api/kb/search | 400 / 400 / 200 / 400; on 400 the store open spy is not called |
| E14 | kb-plugin-search › Limit clamped | BVA | L1 | automated | `limit` absent, `abc`, `0`, `1`, `50`, `51` | GET search (store with 60 matching chunks) | hit counts ≤ 10, 10, 1, 1, 50, 50 respectively |
| E15 | kb-plugin-search › Lane filter | EP | L1 | automated | store with doc+agents+source-md hits; `docType=agents`; `docType=bogus` | GET search | all hits `docType==="agents"`; `bogus` → 400 |
| E16 | kb-plugin-search › No store side effect / Unindexed folder | invariant | L1 | automated | (a) no db file; (b) indexed db with counts F/C | GET search | (a) 200 `{hits:[]}` and db file still absent; (b) counts still F/C after request; no `indexSource` call |
| E17 | kb-plugin-search › Stale schema reported | state | L1 | automated | db whose `chunks` lacks `start_line` | GET search | 200 `{hits:[], needsReindex:true}`; `PRAGMA table_info(chunks)` unchanged; `files` row count unchanged |
| E18 | kb-plugin-search › existing-only open (WAL spike) | invariant | L1 | automated | (a) WAL db after writer `close()` (no `-shm`); (b) DELETE-mode db | `SqliteFtsStore.openExisting` + `SELECT` | no error; `PRAGMA journal_mode` unchanged per file; file size and mtime unchanged |
| E19 | kb-plugin-search › Remote source priority honoured | decision-table | L1 | automated | saved specs: `git` ref R prio 5, filesystem `docs` prio 0; identical section indexed under both roots | GET search | top hit `root===R`, duplicate collapsed |
| E20 | kb-plugin-search › Successful search (FTS chars as text) | EP | L1 | automated | `q='"bridge" OR (x'` on indexed fixture | GET search | 200, no 500; hits carry `root,path,headingPath,chunkId,snippet,score,docType` |
| E21 | kb-plugin-search › No verdict enrichment | invariant | L1 | automated | `?verdicts=1` appended | GET search | `enrichHits` spy 0 calls; no hit has `verdict` |
| E22 | kb-plugin-index-jobs › Source status shape | EP | L1 | automated | saved: filesystem `docs` (5 files indexed), `/abs/out` filesystem, git ref (trusted, last outcome ok rev `a91f3c2`) | GET /api/kb/sources | entries: `{files:5,trusted:null,outside:false}`, `{outside:true}`, `{trusted:true,lastStatus:"ok",revision:"a91f3c2",lastAt:number}`; no `chunks` key |
| E23 | kb-plugin-index-jobs › Unindexed source counts zero | EP | L1 | automated | no db file; one saved source | GET sources | `files:0`; db file not created |
| E24 | kb-plugin-index-jobs › Stats shape unchanged | invariant | L1 | automated | any folder after a mixed-outcome job | GET /api/kb/stats | key set exactly `files,chunks,indexed,staleCount,indexing,jobStatus[,lastError]` |
| E25 | kb-plugin-cwd-guard › Grant decision table | decision-table | L1 | automated | saved specs: one git ref G, filesystem `docs`, two specs sharing ref D | POST source-trust `{ref:G}`, `{ref:"nope"}`, `{ref:"docs"}`, `{ref:D}` | 200 `{hash,subject}` / 404 / 400 / 409; trust store gains only G's hash |
| E26 | kb-plugin-cwd-guard › Grant records the saved spec | invariant | L1 | automated | saved git spec `{ref:G,pin:"main",subdir:"docs"}`; body `{ref:G,pin:"evil",kind:"https"}` | POST source-trust | recorded hash equals `sourceHash(savedSpec)`; `isTrusted(savedSpec)` true |
| E27 | kb-plugin-cwd-guard › Effective config | EP | L1 | automated | git ref only in global config, project has none | POST source-trust `{ref}` | 200 (global spec grantable) |
| E28 | kb-plugin-cwd-guard › trustRefs symmetric REST + plugin_action | decision-table | L1 | automated | PUT and `config.set` each with new git source G + `trustRefs:[G,"missing"]`; then a variant with invalid patch | send | G trusted on both paths; PUT body `untrustedRefs:["missing"]`; `config.set` logs warn naming `missing`; invalid patch → nothing trusted, no file write |
| E29 | kb-plugin-cwd-guard › REST route guarded before store open | decision-table | L1 | automated | non-admitted cwd | GET search, GET sources, POST source-trust | 403 each; store open spy, trust-store read spy, config read spy all 0 calls |
| E30 | kb-source-resolution › Trust persistence atomic | state | L1 | automated | trust dir writable / made read-only | `recordTrust(spec)` | `true` + entry readable; read-only → `false`, warn logged, prior file bytes identical |
| E31 | kb-source-resolution › Classifiable not-trusted failure | EP | L1 | automated | untrusted git spec, `promptTrust: async()=>false`, git spawn spy | `gitResolver.resolve` | rejects `instanceof KbUntrustedSourceError`; git spy 0 calls |
| E32 | kb-source-resolution › Hardening flags preserved | invariant | L1 | automated | trusted git spec; execFile spy | resolve | argv contains the harden change's `-c protocol.allow=never`, `-c protocol.https.allow=always`, `-c http.followRedirects=false` entries verbatim |
| E33 | kb-folder-slot › Rebuild gate decision table | decision-table | L1 | automated | saved specs: (a) remote-only, (b) none + form has typed source, (c) filesystem + form emptied | render panel | (a) `kb-reindex-now` enabled; (b) disabled + visible reason; (c) enabled |
| E34 | kb-plugin-index-jobs › Kind-less remote ref classified by prefix | EP | L1 | automated | saved `{ref:"https://h/doc.md"}` no kind, untrusted | reindex | outcome `untrusted`; https resolver chosen; no fetch |
| E35 | kb-plugin-index-jobs › Filesystem sources unchanged | invariant | L1 | automated | filesystem-only config (existing kb-routes fixture) | `reindexAll` | same `indexSource` call args (root, dir, options) as baseline snapshot; outcomes all `ok` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | kb-plugin-search (design D8 budget) | tail-latency | L1 | automated | synthetic store 5,000 chunks / 500 files; 50 varied 2–4 term queries via the search route core | p95 < 100 ms | 50 searches, single run |
| P2 | kb-plugin-search (design D8 budget) | tail-latency | — | manual-only | this repo's real index | p95 of 50 queries recorded in `measurements.md` (budget < 100 ms) | one-off; [judgment: environment-specific measurement, not a CI signal] |
| P3 | kb-source-resolution › Clone does not stall the host process | event-loop liveness | L1 | automated | stubbed `git` child sleeping 3 s during `reindexAll` of a trusted git spec | `setImmediate` tick counter advances ≥ 50 during stub AND `GET /api/kb/stats` (fastify.inject) answers < 200 ms meanwhile | the 3 s stub |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | kb-plugin-settings › Adding a remote source opens the trust dialog / Cancel adds nothing | state-transition | L1 | automated | Git mode, ref `https://github.com/o/r` | Add → Cancel | dialog shows kind/ref/pin/subdir, agent-visibility warning, "every folder" note, no cache path, no SSRF line; after Cancel sources unchanged |
| F2 | kb-plugin-settings › Trust and add | state-transition | L1 | automated | dialog open for ref G | Trust & add → Save | PUT body `trustRefs:[G]`; response w/o `untrustedRefs` → row trusted badge; response `untrustedRefs:[G]` → not-trusted badge + message |
| F3 | kb-plugin-settings › Add without trusting / Trust existing | state-transition | L1 | automated | dialog open for ref G | Add without trusting → Save → row "Trust…" → confirm | first PUT has no `trustRefs`; row shows not-trusted + Trust…; then POST source-trust `{ref:G}`; sources refetched; trusted badge |
| F4 | kb-plugin-settings › Refresh points | async-convergence | L1 | automated | panel mounted; fake timers 30 s idle; then save; then stats `indexing:true→false` | observe `/api/kb/sources` fetch spy | calls exactly at mount, after save, after settle (3); none during idle |
| F5 | kb-plugin-settings › Status badges | EP | L1 | automated | sources response with filesystem outside, git error outcome `"clone failed"` | render | `outside folder` badge on outside row; error badge `title` contains `clone failed`; file counts rendered |
| F6 | kb-plugin-settings › Match markers rendered safely | EP | L1 | automated | hit snippet `"<img src=x onerror=alert(1)> [bridge]"` | render result | no `img` element in DOM; text contains literal `<img`; `bridge` inside a `mark` element |
| F7 | kb-plugin-settings › Dirty notice / Needs-reindex / Empty / Error | decision-table | L1 | automated | (a) dirty form; (b) response `needsReindex`; (c) `hits:[]`; (d) 500 | submit query | (a) dirty notice; (b) rebuild notice; (c) empty-state; (d) error text, query input keeps value |
| F8 | kb-plugin-settings › Submit a query (wire) | EP | L1 | automated | query `bridge`, lane agents, limit 20 | submit | request URL has `q=bridge&limit=20&docType=agents`; no `verdicts` param; summary shows count + ms |
| F9 | kb-plugin-settings › Copy hit path | state | L1 | automated | one hit `docs/a.md` | click hit | `navigator.clipboard.writeText("docs/a.md")`; transient confirmation visible |
| F10 | kb-plugin-settings › Pick a folder + test search, end-to-end | state-convergence | L3 | automated | docker fixture `/fixtures/kb-sample` pinned, project config | open KB settings → Browse… → pick fixture `docs` dir → Save + Reindex → wait stats settle → test search a known fixture heading | new source row `docs` (relative); search returns that fixture file at rank ≤ 3 |
| F11 | kb-plugin-settings › untrusted remote shown, no fetch | state-convergence | L3 | automated | docker fixture; add Git source `https://github.com/example/never` → Add without trusting → Save + Reindex | stats settle | row shows not-trusted badge; job not in error; KB row chunk count unchanged from before |
| F12 | mockup parity (approved mockup) | visual/subjective | — | manual-only | KB settings page vs `openspec/changes/improve-kb-settings-sources-and-search/mockups/kb-settings-sources-search/index.html` | human compares | [judgment: layout/spacing/badge tone match the approved mockup — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | kb-plugin-index-jobs › Failure isolated per source | fault-injection (abort) | L1 | automated | 3 specs: filesystem A ok, git B resolver throws `ECONNRESET`, filesystem C ok | `reindexAll` via registry | A and C indexed; outcome B `error`; job `jobStatus:"error"`; `lastError` starts `1 source(s) failed:` contains B ref, length ≤ 500 |
| X2 | kb-plugin-index-jobs › Untrusted skipped, not fatal | fault-injection | L1 | automated | trusted filesystem A + untrusted git B | reindex | A indexed; B outcome `untrusted`; no git spawn; `jobStatus:"idle"` after settle |
| X3 | kb-plugin-index-jobs › Failed or skipped source keeps prior chunks | fault-injection | L1 | automated | git B indexed in run 1 (N chunks under root B); run 2 B resolver throws | reindex twice | chunks with `root===B` still N after run 2 |
| X4 | kb-plugin-index-jobs › Per-source outcomes retained | state | L1 | automated | mixed-outcome job settles | registry read | outcomes for each ref with `status`, `error?`, `revision?`, `at` (number ≥ job start) |
| X5 | kb-source-resolution › Git timeout | fault-injection (delay) | L1 | automated | stubbed git never exits; injected timeout (fake timers / timeout option at 120000) | resolve | child killed (kill spy); rejects with timeout error; outcome `error` |
| X6 | kb-plugin-cwd-guard › Persist failure reported | fault-injection | L1 | automated | `recordTrust` returns false (trust dir read-only) | POST source-trust `{ref:G}`; PUT with `trustRefs:[G]` | 500 `{error}`; PUT 200 with `untrustedRefs:[G]` |
| X7 | kb-plugin-search › Search during a running reindex | fault-injection (concurrency) | L1 | automated | registry job in flight holding a write transaction batch | GET search | 200 within busy_timeout, hits from last committed state, no SQLITE_BUSY 500 |
| X8 | kb-plugin-cwd-guard › plugin_action guarded | fault-injection | L1 | automated | `config.set` with `trustRefs` for non-admitted cwd | dispatch handler | warn logged; `applyConfigPatch` and `recordTrust` spies 0 calls |

---

## Coverage summary

- Requirements covered: 16/16 delta requirements (kb-plugin-settings 4, kb-plugin-search 1, kb-plugin-index-jobs 2, kb-plugin-cwd-guard 2, kb-source-resolution 3, kb-folder-slot 1, plugin-ui-primitive-registry 2, plugin-intent-protocol 1)
- Scenarios by class: edge 35 · perf 3 · frontend 12 · error 8
- Scenarios by level: L1 54 · L2 0 · L3 2 · — 2
- Scenarios by disposition: automated 56 · manual-only 2

Note: `plugin-intent-protocol` MODIFIED exception is exercised by E9 (soft-hook null path); no separate runtime observable exists beyond the registry tests.

## New infra needed

- Docker e2e fixture: `/fixtures/kb-sample` needs a `docs/` subdirectory with one `.md` carrying a unique heading (F10). Extend `docker/fixtures/kb-sample`; no new harness.
- No network in e2e: remote-source indexing (trusted → indexed) is covered only at L1 with stubbed resolvers; F11 exercises the untrusted path without any fetch.
