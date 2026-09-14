## Context

See `proposal.md` — Why. Current shape that constrains the design:

- Boot has **two** discovery paths:
  1. **Meta scan (primary, all dirs):** `server.ts:445` → `scanAllSessions()` (`session-scanner.ts`) walks every `~/.pi/agent/sessions/*/` dir, reads each `.meta.json`, calls `extractSessionStats(jsonl)` on cache misses, builds a `DashboardSession` via `sessionFromMeta` (`status = meta.status ?? "ended"`, `hidden = meta.hidden ?? false`, keeps `live`), and the `server.ts` loop restores each into the manager (`dataUnavailable: true`) and collects `live===true` recovery candidates.
  2. **Pinned-dir header scan:** `session-bootstrap.ts` → `directoryService.discoverSessions(cwd)` → `discoverSessionsForCwd` reads `.jsonl` headers only (no meta) and restores anything the manager does not already hold as `{status:"ended", hidden:true}`.
  Both loops are synchronous.
- `MemorySessionManager` exposes `restore / update / get / listActive / listAll` — **no `remove`**. Nothing today evicts a session from the manager except process restart.
- Folder grouping is by **group path**, not raw cwd: `resolveSessionGroupPath(session, pinnedKeys, platform)` (`shared/session-group-path.ts`) = pin > `gitWorktree.mainPath` > cwd. `SessionMeta` carries `gitWorktree`, so the group path is computable from the sidecar alone; the pinned set can change at runtime.
- Recovery: sessions with `live === true` in meta are cold-start recovery candidates (normalised to `ended` but offered for reopen); they must never be archived. A clean server `stop()` clears `live` **without** persisting `status: "ended"`, so many on-disk sidecars of long-finished sessions still carry `idle`/`streaming`; the `server.ts` loop normalises them to `ended` in memory only.
- A server-side viewed-session set exists (`viewed-session-tracker.ts`).
- `browserGateway.broadcastSessionRemoved(id)` exists, but the client handler for `session_removed` (`useMessageHandler.ts:446`) does **not** delete — it marks the session `ended` and preserves transcript/statistics (the clean-shutdown / force-kill boundary). Eviction needs a distinct message.
- Meta persistence is two-path: `metaPersistence.save()` (debounced, **full overwrite** from `sessionToMeta`, which enumerates fields explicitly) and eager `mergeSessionMeta`. `writeNow` carries forward only `live/liveEpoch/closedReason` from disk; any other field not in `sessionToMeta` is wiped by the next debounced write.
- `subscription-handler.ts` hydrates a transcript from `sessionManager.get(id)?.sessionFile` — non-resident sessions cannot be opened today.
- `GET /api/sessions` returns `listAll()`; the shipped `pi-dashboard` skill (`scripts/dashboard-bus.ts`) resolves ids against it and sends `hide_session`/`unhide_session`.
- `sessions_snapshot` is built from `listAll()` filtered by nothing; client replaces its Map atomically (spec `session-listing`).
- Config is read live through `getConfigSnapshot()`; the settings page already buffers numeric fields and PATCHes through the config write endpoint.
- `mergeSessionMeta(sessionFile, partial)` is a **synchronous** read-merge-atomic-write (the eager path the liveness marker uses); the debounce lives in the caller-side meta cache. `SessionMeta` is all-optional by spec.
- Client search runs `filterByQuery` over the resident pool; the sidebar list is virtualised, so DOM size is not the bottleneck — the Map, reducers and snapshot bytes are.
- Mockups + surface/token plan: `mockups/archive-ux.html`, `mockups/ui-plan.md`.

### Measured (harness, change: archive-sessions-lazy-load)

- Boot migration: 400 aged (>30 d) sidecars -> 0 present in `GET /api/sessions`, 0 in the first `sessions_snapshot` frame, all served from `GET /api/sessions/archived` (E2E `archive-fold.spec.ts` P3).
- Snapshot size: the pre-existing window (`SNAPSHOT_ENDED_GLOBAL=120`, `SNAPSHOT_ENDED_PER_GROUP=3`, change `fix-connect-snapshot-frame-loss`) already bounds the ended frame, so the literal `< 25% of all-resident` ratio is not a property archive introduces; the measured contribution is eviction from the live set + per-session RAM, not raw frame bytes. P3 therefore asserts exclusion + index service instead of a ratio.
- Boot log line `archive: N indexed, M migrated, K aged-out (X ms)` is observed at L1 with 3000 aged sidecars (`session-scanner.test.ts` P1); the listing request-timing line is observed at L1 under a 20-concurrent burst (`session-api.test.ts` P2).

## Goals / Non-Goals

**Goals:**
- Archived sessions cost the server one sidecar read at boot and zero bytes per browser connect.
- Every archive transition (manual, sweep, boot migration) goes through one server function so residency, sidecar and broadcast can never disagree.
- Listing archived sessions is a bounded, paginated, sidecar-only read — never a transcript parse.
- No client component that renders an archived row is a `SessionCard`.

**Non-Goals:**
- Archiving alive sessions directly (idle → end → archive is the only alive path).
- Full-text search of archived transcripts (only `name`/`firstMessage` from sidecar).
- Deleting archived sessions in bulk / retention purge (only per-row delete).
- Changing the auto-hide heuristic for headless workers.
- Reworking `sessions_snapshot` for resident sessions (field trimming is a separate change).

## Decisions

**D1 — `archived` lives in the sidecar, not `state.json`.**
The sidecar is already the per-session persistence unit, scanned at boot and written atomically. Putting the flag there means boot can decide "count or restore" from the same read it already does, with no second store to reconcile. *Alternative:* an `archived-ids.json` index — rejected: two sources of truth, and a delete of a session file would leave a dangling id.

**D2 — One transition function: `archiveSession(id, reason)` / `unarchiveSession(id)` in a new `session/session-archive.ts`, which also owns the archive index.**
Both the WS verb, the REST route and the sweeper call it. It (a) validates eligibility (`status === "ended"` and `live !== true`), (b) `metaPersistence.flush(sessionFile)` (new: `writeNow` for one file, so a pending rename/tag is not lost), then `mergeSessionMeta({archived:true, archivedAt})` — eager synchronous path, durable before the in-memory removal, (c) `sessionManager.remove(id)` (new method; no further debounced writes can originate for a non-resident session), (d) inserts an `ArchivedSessionSummary` row into the index (D6), (e) broadcasts **`session_archived { sessionId, cwd: groupKey, count }`** — a new message whose client handler *deletes* the id from `sessions` and updates the count in one step. `session_removed` is not reused (its handler intentionally keeps the session). Unarchive is the mirror: index row → `readSessionMeta` → `sessionFromMeta` → set `archived:false, restoredAt:now, hidden:false` (restore is an explicit "show me this", and migrated rows still carry `hidden:true`) → `restore` → `broadcastSessionAdded` + `archived_count_updated`. `archived`, `archivedAt`, `restoredAt` become `DashboardSession` fields enumerated in `sessionToMeta`, and `writeNow` carries them forward like the liveness trio, so the sweeper's `restoredAt` and a still-archived sidecar survive routine writes. *Alternative:* handle in `session-meta-handler` like hide — rejected: three callers would triplicate the sequence.

**D3 — Idle-alive archive = confirm → `end` → archive on the `ended` transition, with an expiring intent.**
The client shows a confirmation dialog for alive sessions (it terminates a pi process; ended sessions need none), then sends the same `archive_session`. The **server** decides: ended → archive now, reply `{success:true}`; idle-alive → register a one-shot intent (registry modelled on `PendingResumeIntentRegistry`, 60 s stale expiry, cleared on resume / turn start), issue the existing end action itself, reply `{success:true, pending:true}`; when status flips to `ended` the intent fires `archiveSession`. If the end fails or the intent expires, nothing is archived. Running or `live===true` → rejected (WS error reply; REST 409). One wire flow for WS and REST. *Alternative:* force-archive alive sessions — rejected: a live bridge would re-register it and the client would see a ghost.

**D4 — Boot: `scanAllSessions` decides index-vs-restore per sidecar; migration and scan-time age archive are part of the same pass.**
`scanAllSessions` already reads every sidecar. Per file, after the orphan check (`.jsonl` must exist), in order:
1. `meta.archived === true` → push an index row, skip `extractSessionStats`, skip restore.
2. `live !== true` (i.e. not a recovery candidate — persisted status is ignored here because a clean `stop()` leaves it non-`ended`; the restore loop normalises such sessions to `ended` anyway) and (`meta.hidden === true && meta.archived === undefined` **or** `max(endedAt ?? mtime, restoredAt) < now - archiveAfterDays`, threshold > 0) → `mergeSessionMeta({archived:true, archivedAt: endedAt ?? mtime})` (leaving `hidden` as-is), push an index row, skip stats + restore. This is both the one-shot ended+hidden migration and the scan-time age archive; it never broadcasts because nothing was restored.
3. Else build the session as today; the `server.ts` restore loop is unchanged except that scanner output no longer contains archived sessions.
The pinned-dir path (`session-bootstrap.ts`) additionally skips any id present in the archive index so it cannot re-restore an archived session from its `.jsonl` header. Idempotent: step 2 only fires when `archived` is unset, and step 1 catches it on every later boot. Boot logs one line `archive: N indexed, M migrated, K aged-out`. *Alternative:* separate migration script / post-boot sweep with eviction broadcasts — rejected: double parse, and ~3 k eviction frames per connected browser.

**D5 — Sweeper is a plain `setInterval` in `session/archive-sweeper.ts`, reading `getConfigSnapshot()` on each tick.**
No scheduler abstraction. Tick: `listAll()` filtered to `status === "ended" && live !== true && !viewed(id)` with `max(endedAt, restoredAt) < now - threshold` — the **same predicate as the boot rule** (D4), where `endedAt` already fell back to mtime when absent → `archiveSession(id, "sweep")` each, **capped at 200 per tick** (oldest first) so a live threshold drop (30 → 7 d) drains over a few ticks instead of one synchronous write loop + frame burst; one log line when N > 0. Boot normally leaves nothing past the threshold (D4), so a tick usually touches a handful; no batch verb. The interval is re-armed when the config value changes (compare on tick). `archiveAfterDays === 0` short-circuits. Currently-viewed sessions are skipped for that tick and picked up later.

**D6 — In-memory archive index, keyed by group path, owned by `session-archive.ts`.**
`Map<groupKey, ArchivedSessionSummary[]>` where **`groupKey = pathKey(resolveSessionGroupPath(row, pinnedKeys, platform), platform)`** — the same normalised key the client's `session-grouping.ts` uses for folders, so `/a` vs `/a/` or case differences never split a folder. A row is `{id, name, firstMessage, cwd, gitWorktree, groupPath, endedAt, archivedAt, sessionFile}` (~250 B; 4 k rows ≈ 1 MB). `endedAt` falls back to sidecar `mtime` at build time so every row sorts. Worktree sessions land under their parent repo. On pin/unpin the map is re-keyed from the rows (in-memory, no IO) and counts re-broadcast for affected keys. `archivedCountByCwd` in the snapshot is keyed by `groupKey`; archive/restore/delete mutate the map and broadcast the count (`session_archived` carries it for archive; `archived_count_updated { cwd: groupKey, count }` for restore/delete/re-key). *Alternative:* count/list by scanning dirs per request — rejected: sync `readFileSync` fan-out on a request path, orphan drift vs the boot count, and raw-cwd keys that no folder renders.

**D7 — Listing + search endpoint serve from the index only.**
`GET /api/sessions/archived?cwd=&limit=&cursor=&q=`: `cwd` must be an absolute path (400 otherwise) and is looked up as `pathKey(cwd)`; unknown key → empty page. Every item carries `groupPath` so the search response (cross-folder) can be grouped client-side without recomputing worktree resolution. `GET /api/sessions/archived/:id` returns the single row (404 if not archived) for deep links and read-only open. Rows sorted `endedAt desc, id desc`; `cursor` is opaque base64 of `<endedAt>:<id>`, so bulk-ended sessions with equal `endedAt` never duplicate or skip across pages. `limit` clamped 1–200. `q` (≥ 3 chars, lowercase plain substring on `name` then `firstMessage`) filters across all keys or the one `cwd`. No disk IO on this path. *Alternative:* SQLite/FTS — deferred (Open Question 1).

**D8 — Client keeps archived data outside the `sessions` Map: `useArchivedSessions(cwd)` hook holding `{items, nextBefore, loading, error}` per folder in a `Map` inside `SessionList` state, plus `archivedCountByCwd` in the message-handler store.**
Rows render through a new `ArchivedSessionRow` (see `ui-plan.md`), not `SessionCard`. Search matches reuse the same hook keyed by `"q:<text>"`. An `archived_count_updated` for a folder invalidates that folder's loaded page set (next expand refetches) so rows restored/deleted from another client do not linger. Nothing in `filterSessions`, `groupSessions` or `sessionOrderMap` sees archived rows.

**D9 — Read-only open of an archived row reuses the on-demand replay path; `sessionFile` resolves server-side.**
`subscription-handler.ts` hydration gains a fallback: when `sessionManager.get(id)` is undefined, look the id up in the archive index and use that row's `sessionFile`. The client never sends a path. The chat view opens with a `readOnly` flag (composer hidden); the session is not added to `sessions`; the route is `/session/<id>?archived=1` and a refresh re-fetches the summary via `GET /api/sessions/archived/:id`. *Alternative:* auto-restore on click — rejected: breaks the "restore is explicit" model and re-inflates the live set by browsing.

**D9b — Delete-forever of an archived session is its own verb.**
`DELETE /api/sessions/archived/:id` (REST only — no WS verb; it is a rare, confirmed action) removes the `.jsonl` + `.meta.json`, drops the index row, broadcasts `archived_count_updated`. 404 when the id is not archived (resident sessions are not deletable this way). *Alternative:* generic session delete — out of scope (Open Question 2).

**D10 — Remove hide verbs outright (no deprecation shim).**
`hide_session`/`unhide_session`, the REST routes and the card buttons are deleted; `bus-client` generated verbs regenerate. Known callers: the dashboard client and the shipped `pi-dashboard` skill script (`scripts/dashboard-bus.ts` `hide`/`unhide` commands → `archive`/`unarchive`); both migrate in this change. `GET /api/sessions` intentionally stops listing archived sessions — the skill doc points id resolution at `/api/sessions/archived?q=` for them.

## Risks / Trade-offs

- [First boot rewrites thousands of sidecars (migration + scan-time age archive)] → writes are atomic and idempotent, but the scan is synchronous, so the first boot is measurably slower once (~3 k small writes); logged as one summary line. Accepted: one-shot cost vs. the recurring 4 MB snapshot.
- [Sweep evicts a session a user is currently viewing] → sweeper skips the viewed set for that tick (spec'd); manual archive of a viewed session is allowed (the user asked).
- [Bridge re-registers an id that is archived (reattach after dashboard restart)] → registration wins: `unarchiveSession` semantics before `restore`, index row removed, count broadcast. Covered by `meta-json-session-cache` "Bridge reconnects after restart".
- [Pin change re-keys the index while a fold is open] → counts re-broadcast for affected group paths; the client invalidates those folders' loaded pages (D8).
- [Idle-archive intent outlives the user's intent] → 60 s expiry, cleared on resume/turn start (D3).
- [Pre-upgrade manually-hidden *alive* sessions have no unhide] → accepted: they surface under `Show hidden`, can be archived from there (idle) and restored (which clears `hidden`). The footer's "hidden workers" label is slightly inaccurate for this dwindling cohort.
- [`GET /api/sessions` consumers lose archived rows] → intentional (it is the resident set); documented in the skill and FAQ.
- [Client stale `archivedCountByCwd` after reconnect] → the snapshot replaces it atomically (spec `session-listing`).
- [`q` search walks every sessions dir] → gated by chip + ≥ 3 chars + 300 ms debounce; server caps at `limit`; measured cost is ~4 k sidecar reads ≈ tens of ms on SSD. Open Question 1 if it grows.
- [Delete-forever on an archived row is destructive] → confirmation dialog (existing dialog primitive), row-only, no bulk.
- [E2E/unit tests that relied on hide] → rewritten to archive in the same change; `hide-unhide-placement.test.ts` becomes `archive-placement.test.ts`.

## Migration Plan

1. Ship server + shared + client together (protocol verbs change).
2. First boot after upgrade: the meta scan migrates ended+hidden sidecars and archives everything older than `archiveAfterDays` in the same pass, building the index. Expect one slower boot (extra sidecar writes) and one `archive: N indexed, M migrated, K aged-out` log line. No eviction broadcasts.
3. Rollback: revert the build. The old server ignores `archived*` fields. Sessions archived by **migration** still carry `hidden: true` (D4 leaves it) and come back hidden as before. Sessions archived by the **sweeper or manually** after the upgrade come back as *visible* ended sessions — the old ended fold absorbs them; nothing is lost. `archivedAt/restoredAt` stay inert.

## Open Questions

1. If a user has > 20 k archived sessions, is an FTS/SQLite index for the `q` path worth adding (the kb package already ships FTS5)? Deferrable — the endpoint contract does not change.
2. Should `Delete` on an archived row also be offered on resident ended cards? Out of scope here; the row-only placement can be widened later without touching specs.
