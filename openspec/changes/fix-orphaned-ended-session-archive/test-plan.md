# Test Plan — fix-orphaned-ended-session-archive

Stage: design   Generated: 2026-10-14

No clarifications are needed. Every requirement resolves to a concrete input, trigger and observable result.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | session-archive › Fileless ended sessions are archivable › Archive an ended session with no session file | decision-table (status=ended, live≠true, file=∅, reason=manual) | L1 | automated | resident S `status:"ended"`, `live:undefined`, `sessionFile:undefined`, cwd `/w` | `archiveSession(S, "manual")` | returns `{ok:true}`; `sessionManager.get(S)` undefined; emitter `sessionArchived(S, key("/w"), n)` with `n` equal to `countFor(key)` before the call; `has(S)` false |
| E2 | same › Fileless eviction writes nothing to disk | decision-table | L1 | automated | E1 state in a tmp sessions dir, `writeSessionMeta`/`mergeSessionMeta` spied | `archiveSession(S, "manual")` | zero sidecar writes; no `.meta.json` created in the tmp dir |
| E3 | same › Evicted fileless session is not listed as archived | state-transition (evicted → restore attempt) | L1 | automated | S evicted per E1 | `list({cwd:"/w"})` then `unarchiveSession(S)` | list has no S row; unarchive returns `{ok:false, error:"session is not archived"}` |
| E4 | same › Fileless interrupted session is still refused | decision-table (live=true) | L1 | automated | resident S `ended`, `live:true`, no file | `archiveSession(S, "manual")` | `{ok:false, error:"session is live (interrupted)"}`; S still resident; no emitter call |
| E5 | same › Sweeper does not evict a fileless session | decision-table (reason ∈ sweep/service-end) | L1 | automated | resident S `ended`, non-live, no file, `endedAt` older than `archiveAfterDays` | sweeper `tick()`; separately `archiveSession(S,"service-end")` | S still resident after both; `tick()` returns 0; service-end returns `"session file is unknown"`; no `sessionArchived` emitted |
| E6 | same (regression) — file-backed manual archive unchanged | decision-table (file present) | L1 | automated | resident S `ended`, non-live, `sessionFile=F` in tmp dir | `archiveSession(S,"manual")` | `F.meta.json` has `archived:true`; index row inserted; emitted count = previous+1 |
| E7 | session-identity › Ended predecessor is superseded | state-transition (S1 ended+F, S2 registers F) | L1 | automated | S1 resident `ended`, `sessionFile=F`; F sidecar `{name:"x"}` | `session_register {sessionId:S2, sessionFile:F}` through event wiring | S1 absent from `sessionManager`; one `session_archived` for S1; **no** `session_updated {sessionFile:null}` for S1; S2 resident with `sessionFile=F`; F sidecar has no `archived` key |
| E8 | session-identity › Ended holder marked live is still superseded | decision-table (live=true) | L1 | automated | as E7 with S1 `live:true` | S2 registers F | S1 evicted (absent from `sessionManager`) |
| E9 | session-identity › Non-ended holder keeps today's behaviour | decision-table (status=idle) | L1 | automated | S1 resident `status:"idle"`, `sessionFile=F` | S2 registers F | S1 still resident with `sessionFile` undefined; `session_updated {sessionFile:null}` broadcast for S1; no `session_archived` |
| E10 | session-identity › Same-id reconnect does not evict | state-transition (illegal edge: same id) | L1 | automated | S1 resident `ended`, `sessionFile=F` | S1 re-registers with F | S1 resident, status active; no `session_archived` |
| E11 | session-identity › No orphan remains after supersede (invariant) | invariant assertion | L1 | automated | E7 setup plus a non-holder ended S3 in another cwd | S2 registers F | `listAll()` has no session with `status:"ended"` and `sessionFile` undefined whose prior `sessionFile` was F; S3 untouched |
| E12 | design D2 — `evictSuperseded` re-validates | state-transition (stale snapshot) | L1 | automated | S1 resident `status:"idle"` (not ended) | call `evictSuperseded(S1, S2)` directly | returns not-ok / no-op; S1 still resident; no emitter call |
| E13 | design D1 — event purge on eviction | invariant | L1 | automated | `deleteEvents` dep spy; fileless ended S | `archiveSession(S,"manual")` and separately `evictSuperseded` | `deleteEvents` called exactly once with S each time; not called for file-backed archive (E6) |
| E15 | archived-session-listing › Eviction without an index row keeps the folder count | invariant | L1 | automated | folder `/a` index seeded with 2 archived rows; a fileless ended S in `/a`; an ended S1 holding F in `/a` | `archiveSession(S,"manual")`, then S2 registers F; then build `countsByKey()` | both `sessionArchived` emits carry count 2; `countsByKey()[key("/a")] === 2`; emitter `archivedCountUpdated` never called |
| E14 | session-archive › REST archive of fileless ended session | decision-table | L1 | automated | resident fileless ended S | `POST /api/session/S/archive` | HTTP 200 `{success:true}`; S absent from `GET /api/sessions` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | session-archive › WS archive rejections › Client surfaces the error | state-convergence | L1 | automated | client state with session S rendered | inbound `{type:"archive_session_error", sessionId:S, error:"session is running"}` | error toast whose text contains "session is running"; `sessions[S]` deep-equals pre-message state |
| F2 | session-archive › Fileless eviction on client | state-convergence | L1 | automated | client state with fileless ended S in folder `/w`, archived count 3 | inbound `session_archived {sessionId:S, cwd:key, count:3}` | `sessions` has no S; archived count for key stays 3 |
| F3 | proposal goal — stuck card clears on a live instance | live verification | — | manual-only | running dashboard with an existing fileless ended card (e.g. `01a13a6a…`) after server restart + client build | click the card's archive button | [judgment: card disappears on the first click with no reload; recorded post-merge] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | session-archive › WS archive rejections › Rejected archive replies to the sender | fault-injection (abort: running) | L1 | automated | S `status:"streaming"` | `handleArchiveSession({sessionId:S})` with `ctx.ws=A` | `ctx.sendTo` called once with `(A, {type:"archive_session_error", sessionId:S, error:"session is running"})`; no broadcast call |
| X2 | same › Unknown session id | fault-injection (abort: not found) | L1 | automated | id `nope` not resident | `handleArchiveSession({sessionId:"nope"})` | `sendTo(A, {type:"archive_session_error", sessionId:"nope", error:"session not found"})` |
| X3 | same — archive unavailable / persist failure | fault-injection (abort: dep missing / `mergeSessionMeta` throws ENOSPC) | L1 | automated | (a) ctx without `sessionArchive`; (b) file-backed ended S with `mergeSessionMeta` throwing `ENOSPC` | `handleArchiveSession` | (a) error `"archive unavailable"`; (b) error contains `ENOSPC`; both sent via `sendTo` to the requester; S still resident in (b) |
| X4 | same › Success sends no error | decision-table (ok / pending) | L1 | automated | (a) fileless ended S; (b) idle-alive S with stubbed `endSession` | `handleArchiveSession` | `sendTo` never called with `archive_session_error` in either case |
| X5 | design D3 — error frame not shed under backpressure | fault-injection (backpressure) | L1 | automated | `frameClassOf` input `{type:"archive_session_error", sessionId:"S", error:"x"}` | classify | returns `{cls:"state", key:"archive_session_error:S"}` (not `transcript`) |
| X6 | design D2 — no archive service fallback | fault-injection (dep missing) | L1 | automated | event wiring without `sessionArchive`; S1 ended holding F | S2 registers F | S1 resident with `sessionFile` cleared (today's behaviour); log line `[archive] supersede skipped: archive unavailable` emitted |

---

## Coverage summary

- Requirements covered: 4/4 ADDED delta requirements (archived-session-listing: eviction count ; session-archive: fileless eviction, WS error reply; session-identity: supersede), plus design D1–D3 invariants
- Scenarios by class: edge 15 · perf 0 · frontend 3 · error 6
- Scenarios by level: L1 23 · L2 0 · L3 0
- Scenarios by disposition: automated 23 · manual-only 1

No performance scenarios: the change adds no latency or throughput requirement.

No L3 scenarios: a fileless orphan or a supersede can't be staged deterministically through the docker harness UI (it needs a bridge re-header). The server and client contracts are fully covered at L1, and the live click is F3, manual-only.

## New infra needed

none
