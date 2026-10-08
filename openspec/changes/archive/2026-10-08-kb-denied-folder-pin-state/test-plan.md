# Test Plan — kb-denied-folder-pin-state

Stage: design   Generated: 2026-10-07

Hard gate passed — every Triple slot resolves from the specs + design (body literal `cwd not allowed`, `PIN_GUARD_MS`=3000, `MAX_POLL_MISSES`=3, `POLL_MS`=1000, label/i18n keys in design D6). No clarifications.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | kb-folder-slot "KB row reflects index state" (D1) | decision-table (status × body) | L1 | automated | `fetch` mocked: 403 `{error:"cwd not allowed",reason:"r",hint:"h"}` | `fetchKbStats("/x")` and `reindexKb("/x")` | both reject with error whose `code==="cwd_not_allowed"`, `message==="cwd not allowed"`, `reason==="r"` |
| E2 | kb-folder-slot "Other 403s are not cwd refusals" (D1) | decision-table | L1 | automated | 403 JSON `{error:"network_not_allowed"}`; 403 JSON `{error:"host_not_allowed",reason,hint}`; 403 JSON `{error:"forbidden"}`; 403 `text/html`; 500 JSON `{error:"boom"}` | `fetchKbStats("/x")` per case | each rejects with plain `Error` with no `code` property; messages `network_not_allowed` / `host_not_allowed` / `forbidden` / `HTTP 403…` / `boom` |
| E3 | kb-plugin-stats "Cwd refusal is definitive" | BVA (miss count 0 vs MAX_POLL_MISSES) | L1 | automated | store for `/x`, fake timers, stats → 403 cwd-not-allowed | subscribe, advance 5×`POLL_MS` | exactly 1 `/api/kb/stats` call; snapshot `denied:true`, `deniedReason:"r"`, `error:null`, `loading:false` |
| E4 | kb-plugin-stats "Bounded poll-miss tolerance" (regression) | BVA | L1 | automated | stats → 403 `{error:"network_not_allowed"}` ×3 | subscribe, advance 3×`POLL_MS` | 3 calls; `error` set after the 3rd; `denied:false` |
| E5 | kb-plugin-stats "Reindex request refused for cwd admission" | decision-table | L1 | automated | stats 200 `{indexed:true}`; prior `reindexError:"boom"` from a 500 POST; then POST → 403 cwd-not-allowed | `reindex()` | `pending:false`, `denied:true`, `reindexError:null`, `error:null` |
| E6 | kb-plugin-stats "Reindex request rejected" (regression) | decision-table | L1 | automated | POST → 500 `{error:"boom"}` | `reindex()` | `reindexError:"boom"`, `denied:false`, `pending:false` |
| E7 | kb-plugin-folder-section "Section state…" precedence (D3) | decision-table | L1 | automated | snapshots: {denied,reindexError}, {denied,pending}, {denied,stats:null}, {denied,pinPending} | render `FolderKbSection` per snapshot | `data-state` = `denied`, `denied`, `denied`, `pinning` respectively; never `error`/`indexing`/`loading` |
| E8 | kb-folder-slot "Unadmitted folder shows denied" (D6) | EP | L1 | automated | stats → 403 cwd-not-allowed | render sidebar placement | text "not allowed" present, "index failed" absent; pill `activateTitle` equals `titleDenied` string (not the server `reason`); no `text-red-400` in `folder-kb-count` |
| E9 | kb-plugin-folder-section "State varies the single menu item" (denied) | EP | L1 | automated | denied, connected | render sidebar placement, open menu contributions | exactly one item id `kb-reindex`, label "Pin folder", icon `mdiPinOutline`, enabled; `onSelect` sends `{type:"pin_directory",path:cwd}` and issues NO `POST /api/kb/reindex` |
| E10 | kb-plugin-folder-section "Card placement renders a sibling reindex control" (denied) | EP | L1 | automated | denied, connected, card placement | click `folder-kb-card-reindex` | aria-label "Pin folder"; `send` called once with `pin_directory`; no reindex POST; settings navigation NOT triggered; zero menu items registered |
| E11 | kb-folder-slot "Pin unavailable while disconnected" | decision-table (placement × connection) | L1 | automated | denied; connection status `disconnected` | render card + sidebar; click card control; select menu item | card control `disabled`, wrapper title `pinOffline`; menu item `disabled:true`, badge `offline`; `send` never called |
| E12 | kb-plugin-folder-section "Opening settings in every state" (denied) | EP | L1 | automated | denied | click pill (`folder-kb-open-settings`) | location becomes `/folder/<encoded cwd>/kb` |
| E13 | i18n parity (D6, D11) | EP | L1 | automated | `packages/kb-plugin/src/i18n.ts` | run kb-plugin i18n parity test | keys `labelNotAllowedShort,titleDenied,labelPinningShort,pinFolder,pinOffline,labelOffline,labelFolderMissingShort,folderMissingAction,labelNoSourcesShort,configureSources` present in `zh-CN` and `hu`; key sets identical |
| E14 | kb-folder-slot "Stats never materialize a folder" (D8) | EP | L1 | automated | `makeFolder()` with config, no `.pi/dashboard/kb/` dir | `GET /api/kb/stats?cwd=F` | `200`, `chunks:0`, `indexed:false`; `existsSync(F/.pi/dashboard/kb)` false after the call |
| E15 | kb-folder-slot "Removed folder reports missing" (D8, D10) | EP | L1 | automated | admitted cwd `F` then `rmSync(F,{recursive:true})` | `GET /api/kb/stats?cwd=F` | `200` `{folderMissing:true, chunks:0, sourceCount:0, staleCount:0}`; `existsSync(F)` false |
| E16 | kb-folder-slot "Stats report configured source count" (D10) | decision-table (project × global layer) | L1 | automated | `HOME`/`USERPROFILE` stubbed to temp: (a) project config 2 sources; (b) no project, no global; (c) no project, global with 1 source | `GET /api/kb/stats` per case | `sourceCount` = 2, 0, 1 |
| E17 | kb-plugin-stats "no filesystem side effects" (D8 schema/throw) | EP | L1 | automated | (a) index.db with pre-`start_line` chunks schema + rows; (b) index.db containing 64 non-SQLite bytes | `GET /api/kb/stats` | both `200` with `chunks:0`, `indexed:false`; files byte-identical after the call |
| E18 | kb-folder-slot "Missing folder is refused" (D9) | EP | L1 | automated | admitted cwd `F`, removed | `POST /api/kb/reindex?cwd=F` | `409 {error:"folder missing"}`; next stats `jobStatus:"idle"`; `existsSync(F)` false |
| E19 | kb-folder-slot "Zero sources is refused" (D9) | BVA (sources 0 vs 1) | L1 | automated | `makeFolder({withConfig:false})`, `HOME` stubbed empty; and same with 1 source | `POST /api/kb/reindex` | 0 sources → `409 {error:"no sources configured"}`, no `index.db` created; 1 source → `202` |
| E20 | kb-folder-slot "Preflight runs after coalescing" (D9) | state-transition | L1 | automated | job running for `F` (slow resolver), then `rmSync(F)` | second `POST /api/kb/reindex?cwd=F` | `202` with the in-flight `jobId` |
| E21 | kb-folder-slot "Config write refuses a missing folder" (D9) | EP | L1 | automated | admitted cwd `F`, removed | `PUT /api/kb/config?cwd=F` `{sources:[…]}` | `409 {error:"folder missing"}`; `existsSync(F)` false |
| E22 | kb-folder-slot "Save-and-reindex with zero sources skips the job" (D9) | decision-table | L1 | automated | existing folder, `HOME` stubbed empty | `PUT /api/kb/config` `{sources:[], reindex:true}` | `200` with `reindexSkipped:"no sources configured"`; stats `jobStatus:"idle"`, `indexing:false` |
| E23 | kb-folder-slot "Same preconditions for the browser action path" (D9) | decision-table (action × precondition) | L1 | automated | `plugin_action` `reindex` and `config.set{reindex:true}` for (a) removed folder, (b) zero-source folder | dispatch to handler | no job registered (`registry.isRunning` false); warn logged containing `folder missing` / `no sources configured`; nothing created |
| E24 | D11 `KbPreconditionError` (client) | decision-table | L1 | automated | 409 `{error:"folder missing"}`, 409 `{error:"no sources configured"}`, 409 `{error:"duplicate ref"}` | `reindexKb("/x")` | first two reject with `code` `folder_missing` / `no_sources`; third plain `Error` without `code` |
| E25 | kb-folder-slot "Removed folder shows missing, no action" (D11) | EP | L1 | automated | stats `{folderMissing:true}` | render sidebar + card | label "folder missing" (no red); menu item `kb-reindex` disabled labelled "Folder missing"; card control disabled; activation sends no POST |
| E26 | kb-folder-slot "Zero sources offers Configure sources" (D11) | EP | L1 | automated | stats `{sourceCount:0, chunks:0}` | render sidebar + card; activate the action | label "no sources"; action "Configure sources"; location → `/folder/<enc>/kb`; no `POST /api/kb/reindex` |
| E27 | kb-folder-slot "Failed job on a zero-source folder never offers a dead Retry" (D11) | decision-table | L1 | automated | stats `{jobStatus:"error", sourceCount:0}` | render sidebar | label "index failed"; action "Configure sources", not "Retry" |
| E28 | D11 zero sources with existing index | decision-table | L1 | automated | stats `{sourceCount:0, chunks:120, indexed:true}` | render sidebar | chunk count shown; action "Configure sources" |
| E29 | kb-folder-slot "Old server without the new fields" (D10) | EP | L1 | automated | stats `{indexed:false, chunks:0}` without `folderMissing`/`sourceCount` | render sidebar | `data-state="not-indexed"`, action "Index now" |
| E30 | kb-plugin-folder-section precedence "except denied and missing" (D11) | decision-table | L1 | automated | snapshot `{reindexError:"boom", stats:{folderMissing:true}}` | render | `data-state="missing"` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | kb-folder-slot "Pinning a denied folder resolves its real state" | state-transition denied→pinning→derived | L1 | automated | store denied; next stats → 200 `{indexed:false}` | `beginPinWait()`, then `refetch()` | snapshot sequence `pinPending:true` → `{denied:false,pinPending:false}`; row `data-state` ends `not-indexed`; `pending` never true |
| F2 | kb-folder-slot "Pin that does not admit the folder stays denied" | state-transition (guard elapse) | L1 | automated | store denied, ≥1 subscriber; stats keep → 403 cwd-not-allowed | `beginPinWait()`, advance `PIN_GUARD_MS` | `pinPending:false`, `denied:true`, exactly one additional stats call, `error:null`; Pin control enabled |
| F3 | kb-plugin-stats "never fetch at zero subscribers" (D5) | state-transition | L1 | automated | store denied; `beginPinWait()`; all consumers unsubscribe | advance `PIN_GUARD_MS` | `pinPending:false`; zero additional stats calls |
| F4 | kb-plugin-stats "Refusal and pin-wait are shared" | convergence | L1 | automated | two consumers of `/x` (sidebar + card) | stats 403 cwd-not-allowed; then `beginPinWait()` from one | both observe identical `denied`/`pinPending`; `pending` false in both; settings-panel reindex button not disabled by `pinPending` |
| F5 | kb-plugin-folder-section double pin guard (D5) | illegal edge | L1 | automated | store `pinPending:true` | `beginPinWait()` again; activate pin control | no second timer (one guard elapse refetch), control disabled, `send` not called again |
| F6 | kb-folder-slot "Folder pinned elsewhere leaves denied" (D5) | state-transition (external event) | L1 | automated | section denied, stub ws; next stats → 200 | dispatch ws message `{type:"pinned_dirs_updated",paths:["/other"]}` | one stats refetch issued (no path matching); row leaves `denied` |
| F7 | D5 listener only while denied | invariant | L1 | automated | section admitted (stats 200) with stub ws | dispatch `pinned_dirs_updated` | zero stats refetches; stub ws has no `message` listener from the section |
| F8 | kb-plugin-stats "Polling stops on a cwd refusal mid-job" | state-transition | L1 | automated | store polling with `indexing:true` | next poll → 403 cwd-not-allowed, advance 3×`POLL_MS` | polling stopped (no further calls); `denied:true`; after `refetch()` → 200 `{jobStatus:"error",lastError:"x"}` row shows `error` |
| F9 | kb-plugin-stats "Shared…" + D2 inFlight ordering | invariant | L1 | automated | stats 403 on first subscriber | unsubscribe all, resubscribe new consumer | revalidating fetch issued (store not wedged on `inFlight`) |
| F10 | kb-folder-slot end-to-end denied → Pin → admitted | state-transition (rendered) | L3 | automated | harness folder with mocked `page.route("/api/kb/stats?*")` → 403 `{error:"cwd not allowed",reason,hint}` | load dashboard; observe row; click card/menu Pin; unroute so stats → real 200 | row shows "not allowed" (no "index failed"); after Pin the WS sends `pin_directory`; row converges to the real KB state (chunks or "not indexed") without reload |
| F11 | D6/D11 visual distinction | visual/subjective | — | manual-only | archived-only unpinned folder (e.g. `/Users/robson/Project/rackinspect`) and a removed-worktree session card on a real instance | open sidebar + OpenSpec/worktree cards | [judgment: "not allowed" / "folder missing" / "no sources" read as informational, not failure; pin glyph discoverable; sidebar coherent after pinning; removed worktree dir NOT recreated under `.worktrees/`] |
| F12 | kb-plugin-stats "Reindex request refused by a precondition" (D11) | state-transition | L1 | automated | store with stats 200 `{sourceCount:1}`; POST → 409 `{error:"no sources configured"}`; next stats `{sourceCount:0}` | `reindex()` | `pending:false`, `reindexError:null`, one extra stats fetch; snapshot shows `sourceCount:0` |
| F13 | kb-folder-slot missing / no-sources rendered | state-transition (rendered) | L3 | automated | harness `/fixtures/kb-sample`, `page.route("**/api/kb/stats*")` → `{…, folderMissing:true}` then `{…, sourceCount:0, chunks:0}` | load dashboard; open folder menu each time; click "Configure sources" | row shows "folder missing" with a disabled KB menu item; then "no sources", click navigates to `/folder/<enc>/kb`; no `POST /api/kb/reindex` observed |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | kb-folder-slot "Pin that does not admit…" (ungranted / dropped send) | fault-injection (abort) | L1 | automated | `send` resolves but no `pinned_dirs_updated` ever arrives | activate Pin, advance `PIN_GUARD_MS` | row shows "pinning…" during window, then back to `denied` with Pin enabled; no `error` state |
| X2 | kb-folder-slot "Rejected client reindex surfaces an error" (regression) | fault-injection (abort) | L1 | automated | POST → transport failure (`fetch` rejects `TypeError`) | activate Index now | `data-state="error"`, Retry item present, `denied:false` |
| X4 | kb-folder-slot "Folder removed after the job was accepted" (D9 TOCTOU) | fault-injection (abort) | L1 | automated | existing folder `F`; folder removed after preflight | call `reindexAll(F)` after `rmSync(F)` (registry-started job) | job settles `jobStatus:"error"`, `lastError:"folder missing"`; `existsSync(F)` false |
| X5 | D9 config-write TOCTOU | fault-injection (abort) | L1 | automated | existing folder `F`; removed between preflight and write | call `applyConfigPatchAndTrust(F, patch)` after `rmSync(F)` | result `{ok:false}` with error `folder missing`; `existsSync(F)` false |
| X3 | D2 mid-session refusal of an admitted folder | fault-injection | L1 | automated | stats 200 populated, then folder unpinned → next revalidate 403 cwd-not-allowed | `refetch()` | row flips to `denied`; stale `reindexError`/`error` cleared; after admission (200) row shows populated, not `error` |

---

## Coverage summary

- Requirements covered: 15/15 modified requirements (kb-folder-slot ×4, kb-plugin-folder-section ×3, kb-plugin-stats ×5, kb-plugin-index-jobs ×1, plus design D1–D11 invariants)
- Scenarios by class: edge 30 · perf 0 · frontend 13 · error 5
- Scenarios by level: L1 45 · L2 0 · L3 2 · — 1
- Scenarios by disposition: automated 47 · manual-only 1

## New infra needed

- none — server L1 extends `packages/kb-plugin/src/server/__tests__/{kb-routes.test.ts,plugin-action-handler.test.ts}` (`makeFolder`, `vi.stubEnv("HOME"/"USERPROFILE")`); client L1 extends `packages/kb-plugin/src/client/__tests__/{kb-api.test.ts,useKbStats.test.tsx,FolderKbSection.test.tsx}` (adds a stub `PluginContextProvider` supplying `send`/`ws`/connection status); L3 extends `tests/e2e/kb-folder-slot.spec.ts` with route-mocking as in `tests/e2e/mcp-client-folder-mobile.spec.ts:191`.
