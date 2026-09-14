## Why

A long-lived dashboard instance keeps every session it has ever discovered resident in `sessionManager`, ships all of them in `sessions_snapshot` on every browser connect, and holds them all in the client `sessions` Map. Measured on the reference instance: **4090 resident sessions (4081 ended, 3345 older than 30 days), a 4.08 MB snapshot frame, 5.3 GB Electron renderer RSS**. The existing `hidden` flag cannot fix this — it conflates three meanings (user-hid, auto-hidden headless worker, disk-discovered history) and hidden sessions are still resident and still shipped.

Ended sessions older than a threshold should leave the hot path entirely and come back only on demand, per folder.

## What Changes

- **New `archived` flag**, orthogonal to `hidden`. Persisted in `.meta.json` (`archived`, `archivedAt`, `restoredAt`). Only `status === "ended"` sessions can be archived. `hidden` is narrowed to auto-hidden headless workers only.
- **Archived sessions are non-resident**: excluded from `sessionManager`, `sessions_snapshot`, `GET /api/sessions`, `session_added`/`session_updated` broadcasts and the client `sessions` Map. Eviction uses a new `session_archived { sessionId, cwd, count }` broadcast that deletes the id client-side (`session_removed` keeps its current "mark ended, preserve transcript" semantics). Boot discovery reads only the meta cache for them (no `.jsonl` stats extraction).
- **Auto-archive sweeper**: server-side interval sweep archives ended sessions whose `max(endedAt, restoredAt)` is older than `sessionList.archiveAfterDays` (default 30; `0` = never). Interval `sessionList.archiveSweepIntervalMinutes` (default 60). Config read live — no restart. At boot the same age rule is applied **inside the meta scan**: sessions already past the threshold are archived at scan time and never restored, so no eviction broadcasts fire; the runtime sweep only handles sessions that cross the threshold while the server runs. Sessions with `live === true` (interrupted, recovery candidates) are never archived.
- **Manual archive** replaces manual hide. **BREAKING**: `session-hide-btn` / `session-unhide-btn` removed from cards; `hide_session` / `unhide_session` WS verbs and `POST /api/session/:id/hide|unhide` removed. New `archive_session` / `unarchive_session` verbs + `POST /api/session/:id/archive|unarchive`. Archive button shown on **idle** and **ended** cards, never on running; archiving an idle (alive) session asks for confirmation (it terminates the pi process), then ends it and archives on the `ended` transition (intent expires after 60 s). Archiving an ended session needs no confirmation. Archiving broadcasts `session_archived`; restoring sets `restoredAt = now`, clears `hidden`, re-registers the session in `sessionManager` as ended, broadcasts `session_added`. `archived`, `archivedAt`, `restoredAt` are fields on `DashboardSession` and flow through `sessionToMeta`, so routine debounced meta writes preserve them.
- **In-memory archive index**: the boot scan builds `ArchivedSessionSummary` rows (`id, name, firstMessage, cwd, gitWorktree, endedAt, archivedAt, sessionFile`) for every archived sidecar, keyed by the folder **group path** (`resolveSessionGroupPath` — pin > worktree main > cwd, rebuilt on pin change) so worktree sessions land under their parent repo. Count, listing and search all serve from this index; no per-request disk IO.
- **Per-folder archive count** in the snapshot (`archivedCountByCwd: Record<groupPath, number>`, from the index, maintained incrementally on archive/restore/delete). Folder header renders an `Archive (N)` fold below the ended fold; hidden when N = 0.
- **On-demand archive listing**: `GET /api/sessions/archived?cwd=&limit=&cursor=` returns `{id, name, firstMessage, cwd, groupPath, endedAt, archivedAt}` rows, newest-ended first, paginated with an opaque `(endedAt, id)` cursor; `GET /api/sessions/archived/:id` returns one row (deep links / read-only open). Fetched on first fold expand; rendered by a lightweight `ArchivedSessionRow` (Restore / Delete actions; click = read-only open loading the transcript on demand). Rows never enter the `sessions` Map.
- **Opt-in archive search**: search-bar chip `include archive` (off by default, persisted in localStorage). When on and query ≥ 3 chars, debounced request to `GET /api/sessions/archived?q=` (server substring match on cached meta `name` / `firstMessage`); matches render per folder under `Archive matches (N)`. `activeOnly`, tag and phase axes do not apply to archived rows.
- **Footer**: "N hidden" indicator becomes "N hidden workers" and counts only `hidden === true` sessions.
- **Settings › Session list**: `archiveAfterDays` and `archiveSweepIntervalMinutes` number fields.
- **Migration** (one-shot at boot): ended sessions with `hidden: true` in `.meta.json` become `archived: true` (`archivedAt = endedAt ?? mtime`); `hidden` is left untouched so a rollback still sees them hidden. Discovered TUI history younger than the threshold becomes a visible ended session (no longer auto-hidden). Alive hidden sessions keep `hidden`.

## Capabilities

### New Capabilities
- `session-archive`: archive flag semantics, eligibility (ended only), manual archive/restore verbs + REST, `session_archived`/`session_added` broadcast on transition, non-residency invariant, meta persistence, boot migration from ended+hidden.
- `session-archive-sweeper`: interval auto-archive by `archiveAfterDays` / `archiveSweepIntervalMinutes`, `restoredAt` clock restart, live config read, scan-time archive at boot, never-archive rules (live, currently viewed).
- `archived-session-listing`: in-memory index keyed by group path, `archivedCountByCwd` in snapshot, `GET /api/sessions/archived` (group-path-scoped cursor pagination and `q` search), folder `Archive (N)` fold with lazy load / skeletons / `Load more`, `ArchivedSessionRow` (restore, delete, read-only open), include-archive search chip.

### Modified Capabilities
- `session-filtering`: remove "Per-card hide" and manual unhide; "Show hidden toggle" and "Hidden count indicator" narrow to auto-hidden workers ("N hidden workers"); "Filter interaction" gains the archived axis; "Server-side hidden state" no longer covers manual hide.
- `dashboard-server`: "Session hide/unhide REST endpoints" replaced by archive/unarchive endpoints.
- `meta-json-session-cache`: "Session discovery by filesystem scan" — sessions whose meta carries `archived: true` are counted per cwd but not restored into the session manager and never trigger `.jsonl` parsing; new optional meta fields.
- `session-search`: "Substring match against display name" gains the opt-in archive branch (server-side, name/firstMessage only, ≥ 3 chars).
- `session-listing`: "Sessions snapshot replaces client state atomically" — snapshot carries `archivedCountByCwd`; archived sessions are never in `payload.sessions`.
- `settings-panel`: Sessions page exposes `archiveAfterDays` and `archiveSweepIntervalMinutes` (added requirement).

## Impact

- `packages/shared/src/`: `types.ts` (`DashboardSession.archived?`), `session-meta.ts` (3 fields), `config.ts` (`sessionList.*`), `browser-protocol.ts` (verbs, snapshot payload).
- `packages/server/src/`: `session/session-to-meta.ts` + `persistence/meta-persistence.ts` (persist + carry forward `archived*`/`restoredAt`), `browser-handlers/subscription-handler.ts` (hydrate archived session by id from the index), `routes/session-routes.ts` (`/api/sessions` excludes archived; new archived routes), `session/session-scanner.ts` (`scanAllSessions` / `sessionFromMeta`: archive decision, scan-time age archive, migration, index rows) + the `server.ts` restore loop (skip archived), `session/session-bootstrap.ts` (pinned-dir `.jsonl` discovery must skip archived ids; drop its `hidden: true` literal), `session/memory-session-manager.ts` (remove on archive, restore on unarchive), new `session/session-archive.ts` (transition fn + index) and `session/archive-sweeper.ts`, `session/session-api.ts` (routes), `browser-handlers/session-meta-handler.ts`, `pairing/browser-gateway.ts` (snapshot), `bus-client` generated verbs.
- `packages/client/src/`: `SessionCard.tsx` (button swap), `SessionList.tsx` (archive fold, chip, footer copy), new `ArchivedSessionRow.tsx`, `hooks/useSessionActions.ts`, `hooks/useMessageHandler.ts` (`archivedCountByCwd`), `lib/session/session-grouping.ts`, `SettingsPanel.tsx`, i18n en + hu (keys listed in `mockups/ui-plan.md`).
- `packages/extension/.pi/skills/pi-dashboard/`: `scripts/dashboard-bus.ts` `hide`/`unhide` commands become `archive`/`unarchive`; `SKILL.md` verb table + note that `GET /api/sessions` no longer lists archived sessions (use `/api/sessions/archived`).
- Tests: `hide-unhide-placement.test.ts`, `session-api.test.ts`, `smoke-integration.test.ts` rewritten for archive; new sweeper / listing / migration unit tests; one Playwright spec for fold lazy-load + restore.
- Docs: `docs/architecture.md` session lifecycle section, directory `AGENTS.md` rows, `docs/faq.md` entry ("where did my old sessions go").
- Expected effect on the reference instance: resident sessions 4090 → ~745, snapshot 4.08 MB → ~0.75 MB, boot skips `.jsonl` stats extraction for ~3345 files.

## Discipline Skills

- `performance-optimization` — the whole change is a measured memory/latency budget (snapshot bytes, resident count, renderer RSS); measure before/after on the reference instance.
- `doubt-driven-review` — the boot migration (ended+hidden → archived) and removal of the hide verbs are irreversible/public-API steps; review before they stand.
- `security-hardening` — `GET /api/sessions/archived` takes untrusted `cwd`, `q`, `limit`, `cursor` query params; clamp and normalise. Read-only open resolves `sessionFile` server-side from the index by id — the client never supplies a path.
- `observability-instrumentation` — new sweeper job + new endpoint need a log line per sweep (`archived N in M ms`) and request timing.
- `review-code` — before commit.
