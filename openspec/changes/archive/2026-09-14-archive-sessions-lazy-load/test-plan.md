# Test Plan — archive-sessions-lazy-load

Stage: design   Generated: 2026-09-13

Clarifications resolved before writing (HARD gate): first-boot budget → no threshold, log only (P1 observes the log line); listing p95 → no threshold, log only (P2 observes timing log); `Load M more` → M = min(page size, remaining) (E22).

Levels: L1 = vitest (`packages/*/src/**/__tests__`), L3 = Playwright (`tests/e2e/*.spec.ts`, docker harness, port from `.pi-test-harness.json`). No L2 rows: nothing here is OS/install-specific.

Exemplars for the fold: server L1 → `packages/server/src/__tests__/session-scanner.test.ts`, `meta-persistence.test.ts`, `session-api.test.ts`, `pending-resume-intent-registry.test.ts`, `browser-gateway-snapshot-on-connect.test.ts`, `subscription-handler.test.ts`, `hide-unhide-placement.test.ts`; client L1 → `packages/client/src/components/__tests__/SessionCard.test.tsx`, `SessionList.test.tsx`, `SessionList.tags-filter.test.tsx`, `SettingsPanel.test.tsx`, `packages/client/src/hooks/__tests__/useMessageHandler.replay-cache.test.tsx`; L3 → `tests/e2e/ended-session-endedat.spec.ts` (seeds sidecars out-of-band), `tests/e2e/submodule-folder-grouping.spec.ts` (worktree grouping).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | session-archive / meta fields | EP | L1 | automated | sidecar `{name:"x"}` (no archive fields) | `sessionFromMeta` | `archived === false`, not in index |
| E2 | session-archive / meta fields survive | state | L1 | automated | resident session with `restoredAt: R`, `metaPersistence.save` pending | debounce fires (`writeNow`) | sidecar still has `restoredAt: R` |
| E3 | session-archive / queued write | state | L1 | automated | pending debounced save carrying `name:"renamed"`; session ended | `archiveSession(id)` | sidecar has `name:"renamed"` AND `archived:true`; pending map empty for that file |
| E4 | session-archive / eligibility | decision-table | L1 | automated | sessions: (ended,live=false), (ended,live=true), (idle alive), (streaming alive) | `archiveSession` each | archived / error `live` / pending intent + end issued / error `running` |
| E5 | session-archive / intent expiry | state-transition | L1 | automated | idle-alive session, intent registered, fake timers | +60 001 ms, then status→ended | not archived; intent registry empty |
| E6 | session-archive / intent cleared | state-transition | L1 | automated | idle-alive, intent registered | `resume` / turn start, then later ended | not archived |
| E7 | session-archive / non-residency | invariant | L1 | automated | manager: 1 archived + 1 ended + 1 active | build `sessions_snapshot` | `sessions.length === 2`, archived id absent, `archivedCountByCwd[key] === 1` |
| E8 | session-archive / restore | state-transition | L1 | automated | index row with sidecar `{archived:true, hidden:true}` | `unarchiveSession(id)` | manager has id with `status:"ended", hidden:false, archived:false, restoredAt≈now`; `session_added` + `archived_count_updated{count-1}` broadcast; index row gone |
| E9 | session-archive / restore unknown | EP invalid | L1 | automated | id not in index | `unarchiveSession` | error reply; zero broadcasts |
| E10 | session-archive / migration | decision-table | L1 | automated | sidecars: (hidden,live=false,status=idle), (hidden,live=true), (hidden,archived=true), (no hidden, 10 d old) | `scanAllSessions` | #1 rewritten `archived:true, archivedAt=endedAt??mtime`, `hidden` still true, not restored; #2 restored hidden, unchanged on disk; #3 indexed, not rewritten; #4 restored `hidden:false` |
| E11 | session-archive / migration one-shot | idempotence | L1 | automated | E10 fixture after one scan | second `scanAllSessions` | zero sidecar writes (spy on `writeSessionMeta`) |
| E12 | meta-json-session-cache / archived skip | invariant | L1 | automated | sidecar `archived:true` + `.jsonl` present | `scanAllSessions` | `extractSessionStats` not called for that file; row in index |
| E13 | meta-json-session-cache / pinned-dir | invariant | L1 | automated | pinned cwd, `.jsonl` whose id is in index | `discoverAndBroadcastSessions` | `sessionManager.get(id)` undefined; no `session_added` |
| E14 | sweeper / config | BVA | L1 | automated | `sessionList` = absent / `{archiveAfterDays:-1}` / `{0}` / `{1}` / `{archiveSweepIntervalMinutes:0}` / `{1}` | config validate | 30&60 / reject / accept / accept / reject / accept |
| E15 | sweeper / age rule | BVA | L1 | automated | `archiveAfterDays=30`; ended sessions aged 29d23h, 30d exactly, 30d+1ms; fake clock | tick | first two resident, third archived |
| E16 | sweeper / restoredAt clock | state | L1 | automated | `endedAt` 60 d ago, `restoredAt` 5 d ago | tick; advance 26 d; tick | resident after first; archived after second |
| E17 | sweeper / never-archive | decision-table | L1 | automated | eligible-age sessions: `live:true`; viewed by a browser; alive idle | tick | none archived; viewed one archived on next tick after unview |
| E18 | sweeper / cap | BVA | L1 | automated | 1000 eligible, threshold lowered live | tick ×6 | 200 oldest per tick, 1000 after 5, 0 on 6th; one log line per non-empty tick |
| E19 | sweeper / zero disables | EP | L1 | automated | `archiveAfterDays:0`, 100 aged sessions | tick + boot scan | nothing archived, nothing rewritten |
| E20 | sweeper / boot scan age | decision-table | L1 | automated | sidecars: (status idle, live false, mtime 45 d), (ended 45 d, restoredAt 2 d), (ended 45 d, live true) | `scanAllSessions` w/ 30 d | #1 archived at scan, #2 restored, #3 restored as recovery candidate; no `session_archived` frames |
| E21 | listing / index key | EP | L1 | automated | rows cwd `/a`, `/a/`, `/a/.worktrees/x` (mainPath `/a`), pinned `/a/.worktrees/x`→ then unpinned | build index; pin change | one key for first three when unpinned (count 3); after pin, `/a` 2 + worktree key 1; `archived_count_updated` for both keys |
| E22 | listing / fold label | BVA | L1 | automated | N=312 loaded 300; N=30 loaded 0 | render fold | `Load 12 more`; `Load 30 more`; `showing 300 of 312` |
| E23 | listing / cursor | BVA | L1 | automated | 120 rows equal `endedAt`, limit 50 | page 1,2,3 via `nextCursor` | 50+50+20 distinct ids; page 3 lacks `nextCursor` |
| E24 | listing / limit | BVA | L1 | automated | `limit` = 0, 1, 200, 201, 5000, `abc` | GET | 1, 1, 200, 200, 200, default 50 items |
| E25 | listing / cwd validation | EP | L1 | automated | `cwd` = `rel/path`, ``, `/unknown`, `/a/` (rows under `/a`) | GET | 400, 400, 200 `[]`, 200 rows |
| E26 | listing / q | BVA | L1 | automated | `q` = `ab`, `abc` matching name, `abc` matching firstMessage only (empty name), `ABC` | GET | `[]`, hit, hit, hit (case-insensitive) |
| E27 | listing / by id | EP | L1 | automated | archived id; resident id; unknown | GET `/archived/:id` | 200 item / 404 / 404 |
| E28 | dashboard-server / delete | EP | L1 | automated | archived id (files on tmp fs); resident id | DELETE `/archived/:id` | files gone + count-1 broadcast + 200 / 404, files intact |
| E29 | session-filtering / hidden count | EP | L1 | automated | 300 archived, 0 hidden; 2 hidden workers | render footer | no indicator / `2 hidden workers` |
| E30 | session-filtering / legacy verbs | EP invalid | L1 | automated | WS `hide_session` | dispatch | unknown-message error; session unchanged |
| E31 | session-listing / snapshot replace | state | L1 | automated | client has `{/repoA:5}`; snapshot with `{/repoB:312}` | handle | `/repoA` absent, `/repoB` 312 |
| E32 | session-listing / session_archived | state | L1 | automated | client has id `old-z` | `session_archived{old-z,/repoA,6}` | `sessions.has(old-z)===false`; count 6; `session_removed` for another id keeps it (ended) |
| E33 | settings-panel / fields | BVA | L1 | automated | draft `archiveAfterDays` = -1, 0, 14; interval = 0, 1 | edit | error+Save disabled / ok / ok; error / ok; save PATCHes `sessionList.archiveAfterDays:14` |
| E34 | dashboard-server / REST archive | decision-table | L1 | automated | ended / idle-alive / running / live:true | POST `/archive` | 200 `{success:true}` / 200 `{success:true,pending:true}` / 409 / 409 |
| E35 | dashboard-server / list excludes | invariant | L1 | automated | 1 archived + 1 resident | GET `/api/sessions` | only resident id |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | proposal / first boot | soak (observe) | L1 | automated | tmp sessions dir, 3000 aged sidecars | boot log line `archive: N indexed, M migrated, K aged-out` present with M+K=3000; duration logged (no threshold) | one boot |
| P2 | listing endpoint | observe | L1 | automated | index 4000 rows, 20 concurrent GET `?cwd=` | request-timing log line present per request (no threshold); all 200 | one burst |
| P3 | proposal / snapshot size | threshold | L3 | automated | harness seeded 500 sessions, 400 aged > 30 d | first `sessions_snapshot` frame < 25% of the all-resident size AND `sessions.length === 100` | connect |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | card affordance | decision-table | L1 | automated | ended / idle-alive / running / hidden worker | render `SessionCard` | archive btn: yes / yes / no / yes-if-shown; hide/unhide btn never |
| F2 | idle confirm | state | L1 | automated | idle-alive card | click archive → cancel; click → confirm | no message; then `archive_session` sent once |
| F3 | ended no confirm | state | L1 | automated | ended card | click archive | `archive_session` sent, no dialog |
| F4 | fold lazy load | state-convergence | L3 | automated | harness folder with 3 archived + 1 ended sidecars | expand `folder-archive-toggle-<cwd>` | skeletons → 3 `ArchivedSessionRow`; only one `GET /api/sessions/archived` in network; `sessions` state size unchanged |
| F5 | fold at zero | EP | L1 | automated | folder count 0 / absent | render | no fold |
| F6 | fold retry | fault | L1 | automated | fetch rejects | expand | retry control, no skeleton; click retry → fetch again |
| F7 | fold cache | state | L1 | automated | rows loaded | collapse, expand | no new fetch; then `archived_count_updated{cwd}` → expand refetches |
| F8 | restore from row | convergence | L3 | automated | F4 fold open | click Restore on row 1 | row gone; fold `Archive (2)`; session card in ended group; `GET /api/sessions` includes id |
| F9 | delete from row | convergence | L3 | automated | F4 fold open | Delete → confirm | row gone; fold `Archive (2)`; files absent on harness fs |
| F10 | read-only open | convergence | L3 | automated | F4 fold open | click row | transcript renders, composer absent, URL `?archived=1`; reload → same view via `/archived/:id`; `sessions` still lacks id |
| F11 | search chip off | invariant | L1 | automated | chip off, query matches only archived | type | no fetch; no `Archive matches` |
| F12 | search chip on | state-convergence | L1 | automated | chip on, fake timers | type `al` → `all` → `allow` within 300 ms | exactly one fetch with `q=allow` after debounce; section `Archive matches (2)` grouped by `groupPath` |
| F13 | chip persistence | state | L1 | automated | chip on | remount | chip on (`aria-pressed=true`) |
| F14 | multi-client eviction | convergence | L3 | automated | two browser contexts, ended session | archive from A | B's card disappears; B fold count +1 |
| F15 | worktree fold | convergence | L3 | automated | archived sidecar cwd `<repo>/.worktrees/x`, mainPath `<repo>` | expand `<repo>` fold | row present under `<repo>`; no fold for worktree path |
| F16 | archived row visuals | visual | — | manual-only | dark + light theme | look at fold + rows | [judgment: dashed border / muted tone reads as "archive", distinct from ended cards] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | session-archive / write failure | fault-injection (abort) | L1 | automated | `writeSessionMeta` throws EACCES | `archiveSession` | error reply; session still resident; no broadcast; index unchanged |
| X2 | session-archive / bridge re-register | state-transition | L1 | automated | id in index (archived) | bridge `register` same id | index row removed, `archived_count_updated{count-1}`, session live in manager with `archived:false` |
| X3 | session-archive / end fails | fault-injection | L1 | automated | idle-alive, end action rejects | `archive_session` | reply error; no intent left; not archived |
| X4 | listing / bad cursor | EP invalid | L1 | automated | `cursor=%%%` / cursor from another folder | GET | 400 / 200 empty end-of-list page (cursor is a sort position, not a folder token; a foreign cursor can only under-read, never duplicate) |
| X5 | subscription / archived hydrate | fault | L1 | automated | archived id; index row `sessionFile` deleted on disk | subscribe | replay error frame, no crash; resident sessions unaffected |
| X6 | delete / partial | fault-injection | L1 | automated | `.jsonl` unlink ok, `.meta.json` unlink throws | DELETE | 500; index row kept; count unchanged; log line |
| X7 | boot / corrupt sidecar | fault | L1 | automated | `.meta.json` invalid JSON next to valid `.jsonl` | `scanAllSessions` | session restored via `.jsonl` header path; not archived; no throw |
| X8 | fold fetch 500 | fault (L3) | L3 | automated | harness endpoint returns 500 (route stub) | expand fold | retry control shown; click retry after stub removed → rows |

---

## Coverage summary

- Requirements covered: 31/31 (all ADDED/MODIFIED requirements across 9 spec deltas)
- Scenarios by class: edge 35 · perf 3 · frontend 16 · error 8
- Scenarios by level: L1 51 · L2 0 · L3 10 · — 1
- Scenarios by disposition: automated 61 · manual-only 1

## New infra needed

- none. L3 rows seed sidecars out-of-band like `ended-session-endedat.spec.ts`; X8 needs a route stub the harness already supports via Playwright `page.route`.
