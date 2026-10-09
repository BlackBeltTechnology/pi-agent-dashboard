# Test Plan — archive-service-sessions-on-end

Stage: design   Generated: 2026-09-23

Hard gate: passed. Gaps G1–G3 (viewed retry, backfill predicate, legacy-leg
fence) and doubt-cycle decisions (all runs declare, `live !== true` gate,
one-shot legacy pass, monitor fallback) are resolved in `design.md` D2–D7.
Grace window = 30 s (`SERVICE_ARCHIVE_GRACE_MS`). Log lines =
`[archive] service-end archived <id>` / `[archive] service-end-backfill archived <id>`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | meta-json: disposability durable | state-transition | L1 | automated | session `{archiveOnEnd:true}` + unrelated field change | `sessionToMeta` → write → `sessionFromMeta` | restored session `archiveOnEnd === true` |
| E2 | meta-json: unclassified gains no bytes | EP | L1 | automated | plain user session, no `archiveOnEnd`, no `lifecyclePolicy` | `sessionToMeta` serialize | JSON has no `archiveOnEnd` key; bytes equal to pre-change fixture |
| E3 | meta-json: undeclared ephemeral gains no key | EP | L1 | automated | session `{lifecyclePolicy:"ephemeral"}`, no declaration | `sessionToMeta` serialize | JSON has no `archiveOnEnd` key (pass-through, no synthesized `false`) |
| E4 | meta-json: declaration-only spawn durable | state-transition | L1 | automated | pending filing with empty ref + `lifecycle:{archiveOnEnd:true}` | register; read sidecar before any routine save | `file()` returns `true`; sidecar `archiveOnEnd === true` |
| E5 | D1 reserved key | EP | L1 | automated | plugin ref body `{archiveOnEnd:true, foo:1}`, no declaration | `sanitizePluginRef` / register | `archiveOnEnd` dropped (warn once); session not declared |
| E6 | on-end: declared archived | state-transition | L1 | automated | resident session `archiveOnEnd:true`, setting on | `→ ended`; advance 30 000 ms | `archiveSession(id,"service-end")` called once; `session_archived` broadcast; log line names id |
| E7 | on-end: grace boundary | BVA | L1 | automated | as E6 | advance 29 999 ms, then +1 ms | at 29 999 ms session resident + not archived; at 30 000 ms archived |
| E8 | on-end: undeclared / ephemeral-only untouched | decision-table | L1 | automated | (a) no declaration (b) `lifecyclePolicy:"ephemeral"`, no declaration | `→ ended`; advance 60 s | no `scheduleServiceArchive` timer; session resident |
| E9 | on-end: setting off at schedule | decision-table | L1 | automated | declared, `archiveServiceSessionsOnEnd:false` | `→ ended`; advance 60 s | not archived |
| E10 | on-end: independent of age threshold | decision-table | L1 | automated | declared, `archiveAfterDays:0`, setting on | `→ ended`; advance 30 s | archived |
| E11 | re-validation matrix | decision-table | L1 | automated | scheduled; at fire: (a) removed (b) status back to `idle` (c) `archiveOnEnd` cleared (d) `live:true` (e) setting flipped `false` | advance 30 s | each case: not archived, timer dropped, no re-arm |
| E12 | idempotent per id | state-transition | L1 | automated | declared session ended | `onEnded` fires twice (closedReason change) within window; advance 30 s | exactly 1 `archiveSession` call |
| E13 | viewed → re-arm | state-transition | L1 | automated | declared, `isViewed` true at first fire | advance 30 s (viewed), set unviewed, advance 30 s | not archived at first fire; archived at second fire (≤ 30 s after unview) |
| E14 | restore inside grace | state-transition | L1 | automated | declared, ended | manual archive at t=5 s; unarchive at t=10 s (`restoredAt` set); advance to 35 s | session resident; no second archive |
| E15 | restore beats view | decision-table | L1 | automated | as E14 + `isViewed` true at fire | advance to 35 s, then +60 s | not archived; no re-arm (no timer in map) |
| E16 | restored + re-notified end | state-transition | L1 | automated | restored session (`restoredAt ≥ endedAt`) | `onEnded` re-fires (closedReason → `"manual"`) | `scheduleServiceArchive` no-op; no timer; resident after 60 s |
| E17 | not retroactive | state-transition | L1 | automated | declared session ended while setting `false` | flip setting to `true`; advance 60 s | not archived by the on-end rule |
| E18 | boot declared leg | decision-table | L1 | automated | sidecar `archiveOnEnd:true`, `live:false`, no `archived`, `status:"idle"`, age 1 h | `scanAllSessions` | archived at scan (sidecar `archived:true`, in `archived[]`, absent from `sessions`); no broadcast |
| E19 | boot declared leg non-ephemeral | decision-table | L1 | automated | as E18, no `lifecyclePolicy` | `scanAllSessions` | archived at scan |
| E20 | boot legacy leg first pass | decision-table | L1 | automated | 3 sidecars `lifecyclePolicy:"ephemeral"`, no `archiveOnEnd`, `live:false`, ended 3 weeks ago (< 30 d); `legacyPass:true` | `scanAllSessions` | all 3 archived; first snapshot excludes them; per-id backfill log lines |
| E21 | boot legacy leg runs once | state-transition | L1 | automated | boot-state without stamp | boot #1 (setting on) → stamp written; add new ephemeral undeclared sidecar; boot #2 | boot #1 archives legacy; `serviceArchiveBackfillAt` set; boot #2 keeps the new sidecar |
| E22 | legacy pass deferred while disabled | state-transition | L1 | automated | boot-state without stamp | boot with setting `false`; then boot with setting `true` | first boot: no archive, no stamp; second boot: legacy archived + stamp |
| E23 | boot gate exclusions | decision-table | L1 | automated | sidecars: (a) `archived:false` + ephemeral (b) `live:true` + declared (c) `live:true` + ephemeral (d) setting `false` + declared | `scanAllSessions` (legacyPass true) | none archived by this rule |
| E24 | config flag parse/validate | EP | L1 | automated | `sessionList` absent / `{archiveServiceSessionsOnEnd:false}` / `"yes"` | `parseSessionListConfig`; `validateSessionListConfig` | default `true`; `false`; parse → `true`, validate → error |
| E25 | config flag via endpoint, live | state-transition | L1 | automated | running server, setting `true` | PUT config `archiveServiceSessionsOnEnd:false`; then end a declared session | GET returns `false`; session not archived (no restart) |
| E26 | engine declares on every run | EP | L1 | automated | automation with `visibility:"hidden"` and one with `"shown"` | `startRunFor` | both spawn `lifecycle` include `archiveOnEnd:true`; goal plugin spawn does not |
| E27 | settings hint wording | EP | L1 | automated | Sessions settings page | render | archive-after hint text contains "age-based" |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | automation: shown run leaves board when archived | state-convergence | L3 | automated | docker harness; seeded run session `kind:"automation"`, `automationRun`, `visibility:"shown"`, `archiveOnEnd:true`, ended | wait ≤ 45 s after end | board card count for that id converges 1 → 0; folder `Archive (N)` count +1; Automation view still lists the run |
| F2 | run monitor archived fallback | state-transition | L1 | automated | `AutomationRunMonitor` with `session` undefined, `params.sid` set; result endpoint mocked `{status:"done", result:"# findings"}` | render | shows terminal status (not "running"), renders result markdown, transcript link href `/session/<sid>?archived=1` |
| F3 | run monitor live unchanged | regression | L1 | automated | resident running session | render | existing `run-live-hint` shown; no archived link |
| F4 | result endpoint by sessionId | EP | L1 | automated | run store with child `{sessionId:"s1", runId:"r1"}` + `result.md` | `GET /result?sessionId=s1` / unknown id | 200 with result + status; unknown → 404 |
| F5 | monitor on archived run end-to-end | state-transition | L3 | automated | docker harness; archived run session + run record | open `/folder/:cwd/automations/run/:sid` | status terminal, findings rendered, transcript link opens read-only archived chat |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | result capture not raced | fault-injection (delay) | L1 | automated | end-of-session handler reads session 20 s after `→ ended` | `onUnregister` end path; advance 20 s then 30 s | read at 20 s finds session resident with `result.md` captured; archive at 30 s |
| X2 | late automation event after archive | fault-injection (abort) | L1 | automated | session archived (removed from live set) | engine receives late `agent_end` / `onSessionDeath` for that id | no throw; run record status unchanged; no error log |
| X3 | pending timers cancelled on stop | fault-injection (abort) | L1 | automated | 3 pending grace timers | `archiveSweeper.stop()`; advance 60 s | 0 archives; timer map empty |
| X4 | no scheduling after stop (latch) | fault-injection | L1 | automated | sweeper stopped | `scheduleServiceArchive(id)`; `start()`; advance 2 h | no timer, no interval armed, 0 archives |
| X5 | server shutdown wiring | fault-injection | L1 | automated | server built with sweeper spy | server `stop()`; separately `start()` failure teardown | `archiveSweeper.stop()` called after `piGateway.stop()` on both paths |
| X6 | archive call fails at fire | fault-injection (abort) | L1 | automated | `sessionArchive.archiveSession` returns `{ok:false}` | fire | no throw; timer dropped; no success log line |
| X7 | boot-state unreadable | fault-injection | L1 | automated | `boot-state.json` missing / corrupt JSON | boot scan | treated as no stamp (legacy pass runs once); stamp written atomically after scan |

### Manual

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | backlog reclaimed on a real install | exploratory | — | manual-only | copy of a real `~/.pi/agent/sessions` with pre-#710 run sidecars | upgrade boot | folder boards no longer show stale run cards; `Archive (N)` counts rise; user sessions untouched; [judgment: board "looks clean"] |

---

## Coverage summary

- Requirements covered: 12/12 (meta-json 1, automation-run-lifecycle 2, session-archive-sweeper 5 incl. MODIFIED threshold, settings-panel 1, attributable log, monitor, config)
- Scenarios by class: edge 27 · perf 0 · frontend 5 · error 7 · manual 1
- Scenarios by level: L1 37 · L2 0 · L3 2
- Scenarios by disposition: automated 39 · manual-only 1

## New infra needed

- none (L3 seeds sidecars via the docker harness like `tests/e2e/automation-identity-restart.spec.ts`)
