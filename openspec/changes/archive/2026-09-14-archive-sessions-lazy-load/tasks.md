## 1. Shared types, protocol, config

- [x] 1.1 Add `archived?`, `archivedAt?`, `restoredAt?` to `SessionMeta` (`packages/shared/src/session-meta.ts`) and to `DashboardSession` (`types.ts`); verify `tsc` passes across workspaces
- [x] 1.2 Add `sessionList.archiveAfterDays` (default 30, min 0) and `sessionList.archiveSweepIntervalMinutes` (default 60, min 1) to `packages/shared/src/config.ts` defaults + validation; verify via test task 1.5
- [x] 1.3 `browser-protocol.ts`: remove `hide_session`/`unhide_session`; add `archive_session`, `unarchive_session`, `session_archived { sessionId, cwd, count }`, `archived_count_updated { cwd, count }`; add `archivedCountByCwd` to `sessions_snapshot`; add `ArchivedSessionSummary` type; regenerate `packages/bus-client/src/generated/verbs.ts`; verify the bus-client generation check passes
- [x] 1.4 Test: sidecar without archive fields reads as not archived — see `packages/server/src/__tests__/session-scanner.test.ts`; sidecar `{name:"x"}` · `sessionFromMeta` · `archived === false`, not in index (test-plan #E1)
- [x] 1.5 Test: config BVA — see `packages/shared/src/__tests__/config-plugins.test.ts`; `sessionList` absent / `archiveAfterDays:-1` / `0` / `1` / `archiveSweepIntervalMinutes:0` / `1` · validate · 30&60 / reject / accept / accept / reject / accept (test-plan #E14)

## 2. Server — persistence and archive core

- [x] 2.1 `session/session-to-meta.ts` enumerates `archived`, `archivedAt`, `restoredAt`; `persistence/meta-persistence.ts` `writeNow` carries the three forward from disk when unset (like the liveness trio) and gains `flush(sessionFile)`; verify via 2.9, 2.10
- [x] 2.2 Add `remove(sessionId)` to `MemorySessionManager`; verify unit test: after `remove`, `get` undefined and `listAll` excludes it
- [x] 2.3 Create `session/session-archive.ts`: archive index `Map<groupKey, ArchivedSessionSummary[]>` (groupKey = `pathKey(resolveSessionGroupPath(row, pinnedKeys, platform))`, rows carry `groupPath`, `endedAt ?? mtime`), `rekey(pinnedKeys)`, `countsByKey()`, `archiveSession(id, reason)` (eligibility ended && `live !== true`; `flush` → eager `mergeSessionMeta`; `remove`; index insert; `session_archived` broadcast), `unarchiveSession(id)` (index → `sessionFromMeta` → `archived:false, restoredAt:now, hidden:false` → `restore` → `session_added` + `archived_count_updated`), `deleteArchived(id)`; verify via 2.11–2.16
- [x] 2.4 Idle-alive archive intent: registry modelled on `pending/pending-resume-intent-registry.ts` (60 s expiry, cleared on resume/turn start); server ends the session and archives on the `ended` transition; running / `live:true` → error reply; verify via 2.13–2.15, 6.x X3
- [x] 2.5 Replace hide/unhide handling in `browser-handlers/session-meta-handler.ts` with `archive_session` / `unarchive_session`; WS reply `{success, pending?}`; verify via 2.17
- [x] 2.6 REST: replace `POST /api/session/:id/hide|unhide` in `session/session-api.ts` with `archive|unarchive` (409 for running / live); add `GET /api/sessions/archived`, `GET /api/sessions/archived/:id`, `DELETE /api/sessions/archived/:id` in `routes/session-routes.ts`; `GET /api/sessions` unchanged (`listAll()` no longer contains archived); verify via group 4 tests + 2.18
- [x] 2.7 `pairing/browser-gateway.ts`: `sessions_snapshot` gains `archivedCountByCwd` from `countsByKey()`; bridge `register` for an archived id runs unarchive semantics before restore; pin/unpin calls `rekey` and broadcasts changed counts; verify via 2.12, 2.19, 6.x X2
- [x] 2.8 `browser-handlers/subscription-handler.ts`: when `sessionManager.get(id)` is undefined, resolve `sessionFile` from the archive index by id (client never sends a path); verify via 6.x X5
- [x] 2.9 Test: `restoredAt` survives debounced write — see `packages/server/src/__tests__/meta-persistence.test.ts`; resident session `restoredAt:R` with pending save · `writeNow` · sidecar still has `restoredAt:R` (test-plan #E2)
- [x] 2.10 Test: pending write flushed, not lost, on archive — see `meta-persistence.test.ts`; pending save with `name:"renamed"`, ended session · `archiveSession` · sidecar has `name:"renamed"` AND `archived:true`, pending map empty (test-plan #E3)
- [x] 2.11 Test: eligibility decision table — see `packages/server/src/__tests__/hide-unhide-placement.test.ts` (rename to `archive-placement.test.ts`); (ended,live=false) / (ended,live=true) / idle alive / streaming · `archiveSession` · archived / error live / pending intent + end issued / error running (test-plan #E4)
- [x] 2.12 Test: snapshot non-residency — see `packages/server/src/__tests__/browser-gateway-snapshot-on-connect.test.ts`; manager 1 archived + 1 ended + 1 active · build snapshot · `sessions.length===2`, archived id absent, `archivedCountByCwd[key]===1` (test-plan #E7)
- [x] 2.13 Test: intent expiry — see `packages/server/src/__tests__/pending-resume-intent-registry.test.ts`; idle-alive with intent, fake timers · +60 001 ms then status→ended · not archived, registry empty (test-plan #E5)
- [x] 2.14 Test: intent cleared on resume — see `pending-resume-intent-registry.test.ts`; intent registered · resume then later ended · not archived (test-plan #E6)
- [x] 2.15 Test: restore transition — see `archive-placement.test.ts`; index row with sidecar `{archived:true, hidden:true}` · `unarchiveSession` · manager has `status:"ended", hidden:false, archived:false, restoredAt≈now`; `session_added` + `archived_count_updated{count-1}`; index row gone (test-plan #E8)
- [x] 2.16 Test: restore unknown id — see `archive-placement.test.ts`; id not in index · `unarchiveSession` · error reply, zero broadcasts (test-plan #E9)
- [x] 2.17 Test: legacy verbs rejected — see `packages/server/src/__tests__/browser-gateway-handler-errors.test.ts`; WS `hide_session` · dispatch · unknown-message error, session unchanged (test-plan #E30)
- [x] 2.18 Test: REST archive decision table — see `packages/server/src/__tests__/session-api.test.ts`; ended / idle-alive / running / live:true · POST `/archive` · 200 `{success:true}` / 200 `{success:true,pending:true}` / 409 / 409 (test-plan #E34)
- [x] 2.19 Test: `/api/sessions` excludes archived — see `session-api.test.ts`; 1 archived + 1 resident · GET `/api/sessions` · only resident id (test-plan #E35)
- [x] 2.20 Test: write failure aborts archive — see `archive-placement.test.ts`; `writeSessionMeta` throws EACCES · `archiveSession` · error reply, still resident, no broadcast, index unchanged (test-plan #X1)
- [x] 2.21 Test: bridge re-registers archived id — see `packages/server/src/__tests__/browser-gateway-register-handler.test.ts`; id in index · bridge `register` same id · index row removed, `archived_count_updated{count-1}`, session live with `archived:false` (test-plan #X2)
- [x] 2.22 Test: end fails during idle archive — see `archive-placement.test.ts`; idle-alive, end action rejects · `archive_session` · error reply, no intent left, not archived (test-plan #X3)
- [x] 2.23 Test: hydrate archived session with missing file — see `packages/server/src/__tests__/subscription-handler.test.ts`; archived id, index `sessionFile` deleted · subscribe · replay error frame, no crash, resident sessions unaffected (test-plan #X5)

## 3. Server — boot scan, migration, sweeper

- [x] 3.1 `session/session-scanner.ts` `scanAllSessions`: per sidecar after the orphan check — `archived:true` → index row, skip stats + restore; else if `live !== true` and (`hidden && archived===undefined` OR `max(endedAt ?? mtime, restoredAt)` older than `archiveAfterDays` > 0) → `mergeSessionMeta({archived:true, archivedAt})` leaving `hidden`, index row, skip; else as today. Return `{sessions, archived: rows, migrated, agedOut}`; `server.ts` seeds the index and logs `archive: N indexed, M migrated, K aged-out (ms)`; verify via 3.5–3.10
- [x] 3.2 `session/session-bootstrap.ts`: skip ids present in the archive index; drop the `hidden: true` literal (discovered history is visible ended); verify via 3.8
- [x] 3.3 Create `session/archive-sweeper.ts`: `setInterval` reading `getConfigSnapshot()` each tick; predicate `status==="ended" && live!==true && !viewedByAnyone(id) && max(endedAt, restoredAt) < now - days`; cap 200 oldest per tick; `archiveAfterDays===0` no-op; re-arm on interval change; one log line per non-empty tick; start after `discoverAndBroadcastSessions` resolves; verify via 3.11–3.15
- [x] 3.4 Sweep + listing observability: sweep summary line, boot archive line, request-timing log on `GET /api/sessions/archived`; verify via 3.16, 4.x P2
- [x] 3.5 Test: migration decision table — see `packages/server/src/__tests__/session-scanner.test.ts`; sidecars (hidden,live=false,status=idle) / (hidden,live=true) / (hidden,archived=true) / (no hidden, 10 d old) · `scanAllSessions` · #1 rewritten `archived:true, archivedAt=endedAt??mtime`, hidden kept, not restored; #2 restored hidden, disk unchanged; #3 indexed not rewritten; #4 restored `hidden:false` (test-plan #E10)
- [x] 3.6 Test: migration one-shot — see `session-scanner.test.ts`; E10 fixture after one scan · second scan · zero `writeSessionMeta` calls (test-plan #E11)
- [x] 3.7 Test: archived skips stats — see `session-scanner.test.ts`; sidecar `archived:true` + `.jsonl` · scan · `extractSessionStats` not called, row in index (test-plan #E12)
- [x] 3.8 Test: pinned-dir discovery skips archived — see `packages/server/src/__tests__/directory-service-pending-emit.test.ts` for bootstrap deps wiring; pinned cwd, `.jsonl` id in index · `discoverAndBroadcastSessions` · `get(id)` undefined, no `session_added` (test-plan #E13)
- [x] 3.9 Test: boot scan age decision table — see `session-scanner.test.ts`; (status idle, live false, mtime 45 d) / (ended 45 d, restoredAt 2 d) / (ended 45 d, live true) with 30 d · scan · #1 archived at scan, #2 restored, #3 restored as recovery candidate; no `session_archived` frames (test-plan #E20)
- [x] 3.10 Test: corrupt sidecar — see `session-scanner.test.ts`; invalid JSON `.meta.json` beside valid `.jsonl` · scan · restored via header path, not archived, no throw (test-plan #X7)
- [x] 3.11 Test: age BVA — new `packages/server/src/session/__tests__/archive-sweeper.test.ts`, harness glue from `packages/server/src/__tests__/pending-resume-intent-registry.test.ts` (fake timers); 30 d threshold, sessions aged 29d23h / 30d / 30d+1ms · tick · first two resident, third archived (test-plan #E15)
- [x] 3.12 Test: restoredAt restarts clock — see `archive-sweeper.test.ts`; `endedAt` 60 d, `restoredAt` 5 d · tick; +26 d; tick · resident then archived (test-plan #E16)
- [x] 3.13 Test: never-archive rules — see `archive-sweeper.test.ts`; eligible-age `live:true` / viewed / alive idle · tick · none archived; viewed one archived next tick after unview (test-plan #E17)
- [x] 3.14 Test: per-tick cap — see `archive-sweeper.test.ts`; 1000 eligible after live threshold drop · tick ×6 · 200 oldest per tick, 1000 after 5, 0 on 6th; one log line per non-empty tick (test-plan #E18)
- [x] 3.15 Test: zero disables — see `archive-sweeper.test.ts` + `session-scanner.test.ts`; `archiveAfterDays:0`, 100 aged · tick + boot scan · nothing archived or rewritten (test-plan #E19)
- [x] 3.16 Test: first-boot log line — see `session-scanner.test.ts`; tmp dir with 3000 aged sidecars · boot · log `archive: N indexed, M migrated, K aged-out` with M+K=3000 and a duration (no threshold) (test-plan #P1)

## 4. Server — listing, search, delete

- [x] 4.1 `GET /api/sessions/archived`: `cwd` absolute-only (400) → `pathKey` lookup (unknown → `[]`); `limit` clamp 1–200 default 50; opaque base64 `<endedAt>:<id>` cursor (`400` on undecodable, ignored if foreign); `q` ≥ 3 chars lowercase substring on `name` else `firstMessage`; sort `endedAt desc, id desc`; items carry `groupPath`; `{items, nextCursor?}`; verify via 4.4–4.10
- [x] 4.2 `GET /api/sessions/archived/:id` → `{item}` or 404; verify via 4.9
- [x] 4.3 `DELETE /api/sessions/archived/:id`: unlink `.jsonl` + `.meta.json`, drop index row, `archived_count_updated`, 200; resident/unknown → 404; partial failure → 500, row kept, log; verify via 4.10, 4.11
- [x] 4.4 Test: index keys + rekey — new `packages/server/src/session/__tests__/session-archive-index.test.ts`, glue from `session-scanner.test.ts`; rows `/a`, `/a/`, `/a/.worktrees/x` (mainPath `/a`); pin then unpin worktree · build; pin change · one key count 3 unpinned; after pin `/a`=2 + worktree key=1; `archived_count_updated` for both keys (test-plan #E21)
- [x] 4.5 Test: cursor with equal endedAt — see `session-api.test.ts`; 120 rows same `endedAt`, limit 50 · pages 1–3 via `nextCursor` · 50+50+20 distinct ids, page 3 lacks `nextCursor` (test-plan #E23)
- [x] 4.6 Test: limit BVA — see `session-api.test.ts`; `limit` 0/1/200/201/5000/`abc` · GET · 1/1/200/200/200/50 (test-plan #E24)
- [x] 4.7 Test: cwd validation — see `session-api.test.ts`; `rel/path` / `` / `/unknown` / `/a/` with rows under `/a` · GET · 400 / 400 / 200 `[]` / 200 rows (test-plan #E25)
- [x] 4.8 Test: q matching — see `session-api.test.ts`; `ab` / `abc`→name / `abc`→firstMessage (empty name) / `ABC` · GET · `[]` / hit / hit / hit (test-plan #E26)
- [x] 4.9 Test: by-id lookup — see `session-api.test.ts`; archived / resident / unknown · GET `/archived/:id` · 200 item / 404 / 404 (test-plan #E27)
- [x] 4.10 Test: delete — see `session-api.test.ts` with tmp fs; archived id / resident id · DELETE · files gone + count-1 broadcast + 200 / 404 files intact (test-plan #E28)
- [x] 4.11 Test: delete partial failure — see `session-api.test.ts`; `.jsonl` unlink ok, `.meta.json` throws · DELETE · 500, row kept, count unchanged, log line (test-plan #X6)
- [x] 4.12 Test: bad cursor — see `session-api.test.ts`; `cursor=%%%` / cursor from another folder · GET · 400 / 200 page from start (test-plan #X4)
- [x] 4.13 Test: listing timing log under burst — see `packages/server/src/__tests__/browser-gateway-load.test.ts` for burst glue; 4000-row index, 20 concurrent GET · burst · timing log line per request, all 200 (no threshold) (test-plan #P2)

## 5. Client — message handling, cards, fold, rows

- [x] 5.1 `hooks/useMessageHandler.ts`: `archivedCountByCwd` state replaced atomically on snapshot; `session_archived` deletes the id and sets the count; `archived_count_updated` sets the count; `session_removed` untouched; verify via 5.8, 5.9
- [x] 5.2 `SessionCard.tsx` + `hooks/useSessionActions.ts`: remove hide/unhide; add `session-archive-btn` (`mdiArchiveOutline`) for ended and idle-alive, never running; idle-alive → confirm dialog (existing dialog primitive) before `archive_session`; verify via 5.10–5.12
- [x] 5.3 Create `components/ArchivedSessionRow.tsx` per `mockups/ui-plan.md` (dashed border, no grip, Restore, Delete with confirm → `DELETE /api/sessions/archived/:id`, click → read-only open); verify via 6.x F8–F10
- [x] 5.4 Create `hooks/useArchivedSessions.ts` (distinct from the OpenSpec `useArchiveListing.ts`): per-key `{items, nextCursor, loading, error}`, `loadFirst`, `loadMore`, `retry`; cache per key; invalidate a key on `session_archived`/`archived_count_updated` for it; verify via 5.13–5.15
- [x] 5.5 `SessionList.tsx`: `Archive (N)` fold below the ended fold when N > 0 (`folder-archive-toggle-<cwd>`), skeletons, `showing X of N`, `Load M more` (M = min(50, remaining)), inline retry; footer copy `sessionList.hiddenWorkers`; verify via 5.16–5.18
- [x] 5.6 Read-only open: route `/session/<id>?archived=1`, `readOnly` hides composer, subscribe by id (server resolves file), reload fetches `/api/sessions/archived/:id`; verify via 6.x F10
- [x] 5.7 Search chip `search-include-archive` (`aria-pressed`, localStorage); when on and query ≥ 3 chars → 300 ms debounced `useArchivedSessions("q:<text>")`; render `Archive matches (N)` per `groupPath` with `ArchivedSessionRow`; chip off → unchanged `filterByQuery`; verify via 5.19–5.21
- [x] 5.8 Test: snapshot replaces counts — see `packages/client/src/hooks/__tests__/useMessageHandler.replay-cache.test.tsx`; client `{/repoA:5}` · snapshot `{/repoB:312}` · `/repoA` absent, `/repoB` 312 (test-plan #E31)
- [x] 5.9 Test: `session_archived` deletes, `session_removed` keeps — see `useMessageHandler.replay-cache.test.tsx`; client has `old-z` · `session_archived{old-z,/repoA,6}`; `session_removed` for another id · `sessions.has(old-z)===false`, count 6; other id still present as ended (test-plan #E32)
- [x] 5.10 Test: card affordance table — see `packages/client/src/components/__tests__/SessionCard.test.tsx`; ended / idle-alive / running / hidden worker · render · archive btn yes / yes / no / yes-if-shown; hide/unhide never (test-plan #F1)
- [x] 5.11 Test: idle confirm — see `SessionCard.test.tsx`; idle-alive · click archive → cancel; click → confirm · no message; then `archive_session` once (test-plan #F2)
- [x] 5.12 Test: ended no confirm — see `SessionCard.test.tsx`; ended · click archive · `archive_session` sent, no dialog (test-plan #F3)
- [x] 5.13 Test: fold retry — new `packages/client/src/hooks/__tests__/useArchivedSessions.test.tsx`, glue from `useAsyncAction.test.tsx`; fetch rejects · expand · retry control, no skeleton; retry → fetch again (test-plan #F6)
- [x] 5.14 Test: fold cache + invalidation — see `useArchivedSessions.test.tsx`; rows loaded · collapse, expand; then `archived_count_updated{cwd}` · no new fetch; then expand refetches (test-plan #F7)
- [x] 5.15 Test: hidden-workers footer — see `packages/client/src/components/__tests__/SessionList.test.tsx`; 300 archived + 0 hidden / 2 hidden workers · render · no indicator / `2 hidden workers` (test-plan #E29)
- [x] 5.16 Test: fold label BVA — see `SessionList.test.tsx`; N=312 loaded 300 / N=30 loaded 0 · render · `Load 12 more`, `Load 30 more`, `showing 300 of 312` (test-plan #E22)
- [x] 5.17 Test: fold hidden at zero — see `SessionList.test.tsx`; count 0 / absent · render · no fold (test-plan #F5)
- [x] 5.18 Test: settings fields BVA — see `packages/client/src/components/__tests__/SettingsPanel.test.tsx`; `archiveAfterDays` -1/0/14, interval 0/1 · edit, save · error+Save disabled / ok / ok; error / ok; PATCH carries `sessionList.archiveAfterDays:14` (test-plan #E33)
- [x] 5.19 Test: chip off — see `packages/client/src/components/__tests__/SessionList.tags-filter.test.tsx`; chip off, query matches only archived · type · no fetch, no `Archive matches` (test-plan #F11)
- [x] 5.20 Test: chip on debounce + grouping — see `SessionList.tags-filter.test.tsx` with fake timers; chip on · type `al`→`all`→`allow` within 300 ms · one fetch `q=allow`; `Archive matches (2)` grouped by `groupPath` (test-plan #F12)
- [x] 5.21 Test: chip persistence — see `packages/client/src/lib/__tests__/session-filter-storage.test.ts`; chip on · remount · `aria-pressed=true` (test-plan #F13)

## 6. Settings, i18n, E2E, manual

- [x] 6.1 `SettingsPanel.tsx` Sessions page: `NumberField`s for `archiveAfterDays` (min 0, unit days, "0 = never" hint) and `archiveSweepIntervalMinutes` (min 1, unit min) buffered into the draft; verified by 5.18
- [x] 6.2 i18n en + hu keys from `mockups/ui-plan.md` (`sessionList.archiveFold`, `sessionList.hiddenWorkers`, `search.includeArchive`, `search.archiveMatches`, card/row/dialog strings); remove manual-hide keys; verify the i18n parity test passes
- [x] 6.3 `packages/extension/.pi/skills/pi-dashboard/scripts/dashboard-bus.ts`: `hide`/`unhide` → `archive`/`unarchive`; `SKILL.md` verb table + note on `/api/sessions/archived`; verify `npm test -w packages/extension` passes
- [x] 6.4 E2E: fold lazy load — new `tests/e2e/archive-fold.spec.ts`, glue from `tests/e2e/ended-session-endedat.spec.ts` (out-of-band sidecar seeding, harness port from `.pi-test-harness.json`); folder with 3 archived + 1 ended · expand `folder-archive-toggle-<cwd>` · skeletons → 3 rows; exactly one listing request; `sessions` size unchanged (test-plan #F4)
- [x] 6.5 E2E: restore from row — see `archive-fold.spec.ts`; fold open · Restore row 1 · row gone, `Archive (2)`, card in ended group, `GET /api/sessions` includes id (test-plan #F8)
- [x] 6.6 E2E: delete from row — see `archive-fold.spec.ts`; fold open · Delete → confirm · row gone, `Archive (2)`, files absent on harness fs (test-plan #F9)
- [x] 6.7 E2E: read-only open + reload — see `archive-fold.spec.ts`; fold open · click row; reload · transcript renders, composer absent, URL `?archived=1`; same view after reload via `/archived/:id`; `sessions` lacks id (test-plan #F10)
- [x] 6.8 E2E: multi-client eviction — see `tests/e2e/automation-fanout.spec.ts` for two-context glue; two contexts, ended session · archive from A · B's card gone, B fold count +1 (test-plan #F14)
- [x] 6.9 E2E: worktree fold — see `tests/e2e/submodule-folder-grouping.spec.ts`; archived sidecar cwd `<repo>/.worktrees/x` mainPath `<repo>` · expand `<repo>` fold · row under `<repo>`, no fold for worktree path (test-plan #F15)
- [x] 6.10 E2E: fold fetch 500 — see `archive-fold.spec.ts` with `page.route`; listing stubbed 500 · expand · retry control; unstub, retry → rows (test-plan #X8)
- [x] 6.11 E2E: snapshot size — see `archive-fold.spec.ts`; harness 500 seeded, 400 aged > 30 d · connect · first `sessions_snapshot` < 25 % of all-resident size and `sessions.length === 100` (test-plan #P3)
- [x] 6.12 Manual: archived row visuals in dark + light — dashed border / muted tone reads as "archive", distinct from ended cards (test-plan: manual-only)

## 7. Integration, measurement, docs

- [x] 7.1 Update `smoke-integration.test.ts` for archive verbs; run `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` and verify zero failures
- [x] 7.2 Measure before/after on the reference instance (resident count from `/api/sessions`, `sessions_snapshot` bytes, renderer RSS, first-boot archive log line) and record in `design.md` Context; verify snapshot < 1 MB and resident ≈ sessions ≤ 30 d
- [x] 7.3 Docs via DocScribe: `docs/architecture.md` session lifecycle (archived state, index, sweeper, endpoints), `docs/faq.md` "where did my old sessions go / restore"; main agent updates directory `AGENTS.md` rows for every new/changed file; verify `kb dox lint` reports no stale/missing rows
