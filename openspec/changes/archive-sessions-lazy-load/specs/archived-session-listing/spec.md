## Purpose

Lets users find and act on archived sessions per folder without those sessions ever entering the live session set: a per-folder count in the snapshot, a paginated on-demand listing endpoint, a lazy folder fold, an opt-in search chip, and a lightweight archived row with restore and delete.

## ADDED Requirements

### Requirement: Per-folder archived count in the snapshot

The server SHALL keep an in-memory archive index of `ArchivedSessionSummary` rows (`id, name, firstMessage, cwd, gitWorktree, endedAt, archivedAt, sessionFile`) built from the boot sidecar scan, keyed by `pathKey(resolveSessionGroupPath(row))` (pin > worktree main path > cwd, then the same path normalisation the client uses for folder keys) and re-keyed when the pinned set changes. Each row SHALL carry its display `groupPath`. `endedAt` SHALL fall back to the sidecar mtime when absent. `sessions_snapshot` SHALL carry `archivedCountByCwd: Record<groupKey, number>` derived from the index and maintained on every archive, restore and delete. The server SHALL broadcast `archived_count_updated { cwd, count }` whenever a folder's count changes. Folders with count `0` MAY be omitted from the map.

#### Scenario: Count in snapshot
- **WHEN** a browser connects and folder `/a` has 312 archived sessions
- **THEN** `sessions_snapshot.archivedCountByCwd["/a"]` SHALL be `312`

#### Scenario: Count updates on archive
- **WHEN** a session in `/a` is archived
- **THEN** the server SHALL broadcast `session_archived { sessionId, cwd: "/a", count: 313 }` and SHALL NOT additionally broadcast `archived_count_updated`

#### Scenario: Count updates on restore
- **WHEN** a session in `/a` is restored
- **THEN** the server SHALL broadcast `archived_count_updated { cwd: "/a", count: 311 }`

#### Scenario: Path spelling variants share one key
- **WHEN** two archived sessions have `cwd = /a` and `cwd = /a/`
- **THEN** both SHALL be counted under the same key

#### Scenario: Worktree session counts under its parent repo
- **WHEN** an archived session has `cwd = /a/.worktrees/x` and `gitWorktree.mainPath = /a`, and `/a/.worktrees/x` is not pinned
- **THEN** it SHALL be counted under `/a`

#### Scenario: Pin change re-keys
- **WHEN** the user pins `/a/.worktrees/x`
- **THEN** that session SHALL move to the `/a/.worktrees/x` key and `archived_count_updated` SHALL be broadcast for both keys

### Requirement: On-demand archived listing endpoint

The server SHALL expose `GET /api/sessions/archived` accepting query params `cwd` (folder group path), `limit` (1–200, default 50), `cursor` (opaque, encodes `endedAt` + `id` of the last item) and `q` (search text). It SHALL return `{ items: ArchivedSessionSummary[], nextCursor?: string }` where each item has `id`, `name`, `firstMessage`, `cwd`, `groupPath`, `endedAt`, `archivedAt`, ordered by `endedAt` descending then `id` descending. Items SHALL be served from the in-memory archive index only; the endpoint SHALL NOT read sidecars or `.jsonl` transcripts. `cwd` SHALL be rejected with 400 when it is not an absolute path; otherwise it is normalised with `pathKey` and looked up as the index key, and an unknown key SHALL yield an empty page. `limit` outside 1–200 SHALL be clamped. The server SHALL also expose `GET /api/sessions/archived/:id` returning `{ item }` for one archived session, or 404 when the id is not archived.

#### Scenario: First page for a folder
- **WHEN** `GET /api/sessions/archived?cwd=/a&limit=50` is requested and `/a` has 312 archived sessions
- **THEN** the response SHALL contain the 50 most recently ended items and a `nextCursor`

#### Scenario: Subsequent page
- **WHEN** the same request is repeated with `cursor=<nextCursor>`
- **THEN** the response SHALL contain the next 50 older items, none overlapping the first page

#### Scenario: Equal endedAt across a page boundary
- **WHEN** 120 archived sessions share the same `endedAt` and pages of 50 are requested with the cursor
- **THEN** the three pages SHALL contain 120 distinct ids with no duplicates or gaps

#### Scenario: Last page
- **WHEN** fewer than `limit` items remain
- **THEN** the response SHALL omit `nextCursor`

#### Scenario: Invalid cwd
- **WHEN** `cwd` is a relative path
- **THEN** the server SHALL respond 400

#### Scenario: Lookup by id
- **WHEN** `GET /api/sessions/archived/<id>` is requested for an archived session
- **THEN** the response SHALL contain that session's summary row

#### Scenario: Lookup by id not archived
- **WHEN** `GET /api/sessions/archived/<id>` is requested for a resident or unknown id
- **THEN** the server SHALL respond 404

#### Scenario: Unknown cwd
- **WHEN** `cwd` is absolute but matches no group path in the index
- **THEN** the server SHALL respond 200 with `items: []`

#### Scenario: Limit clamped
- **WHEN** `limit=5000` is requested
- **THEN** the server SHALL return at most 200 items

### Requirement: Archived search across folders

When `q` is provided with at least 3 characters, `GET /api/sessions/archived` SHALL return archived sessions from all folders (or the given `cwd` when also provided) whose `name` or, when `name` is empty, `firstMessage` contains `q` case-insensitively. A `q` shorter than 3 characters SHALL yield an empty result.

#### Scenario: Match on name
- **WHEN** `q=allowlist` and an archived session has `name = "Add host allowlist admission"`
- **THEN** it SHALL be in the results

#### Scenario: Fallback to firstMessage
- **WHEN** `q=allowlist` and an archived session has no `name` and `firstMessage = "explore allowlist vs blocklist"`
- **THEN** it SHALL be in the results

#### Scenario: Short query
- **WHEN** `q=al`
- **THEN** the response SHALL contain no items

### Requirement: Folder archive fold loads lazily

Each folder group SHALL render an `Archive (N)` fold below its ended-sessions fold when `N > 0`, collapsed by default. The first expansion SHALL request the first page for that folder and show placeholder skeleton rows while in flight. The expanded fold SHALL show `showing X of N`, and a `Load M more` control (M = min(page size, remaining)) until `nextCursor` is absent. An `archived_count_updated` or `session_archived` for the folder SHALL invalidate its loaded pages so the next expansion (or an already-open fold) refetches the first page. A failed request SHALL show an inline retry control. Rows returned SHALL be rendered by an archived-row component and SHALL NOT be added to the live `sessions` state.

#### Scenario: Fold hidden at zero
- **WHEN** a folder has `archivedCountByCwd` of `0` or absent
- **THEN** no archive fold SHALL be rendered for it

#### Scenario: First expand fetches
- **WHEN** the user expands the archive fold of a folder for the first time
- **THEN** the client SHALL request `GET /api/sessions/archived?cwd=<folder>&limit=50` and render skeletons until the response arrives

#### Scenario: Load more
- **WHEN** the user activates `Load more` and the previous response had `nextCursor`
- **THEN** the client SHALL request the next page with `cursor=<nextCursor>` and append the rows

#### Scenario: Fetch failure
- **WHEN** the listing request fails
- **THEN** the fold SHALL show an inline retry control and no skeletons

#### Scenario: Collapse and re-expand
- **WHEN** the user collapses and re-expands the fold and no `archived_count_updated` arrived for that folder in between
- **THEN** already-loaded rows SHALL render immediately without a new request

#### Scenario: Count change invalidates loaded rows
- **WHEN** rows are loaded for `/a` and `archived_count_updated { cwd: "/a" }` arrives
- **THEN** the fold SHALL refetch the first page for `/a` before rendering rows again

### Requirement: Archived row actions

An archived row SHALL show the session display name, its ended date, a restore action and a delete action, and SHALL be visually distinct from live and ended cards (no drag handle, no status dot animation, dashed border). Restore SHALL send `unarchive_session`; on success the row SHALL disappear from the fold and the session SHALL appear under the folder's ended group. Delete SHALL, after confirmation, call `DELETE /api/sessions/archived/:id`, which removes the session's transcript and sidecar. Clicking the row SHALL open the session read-only, loading its transcript on demand; the server SHALL resolve the transcript file from the archive index by id — the client SHALL NOT send a file path.

#### Scenario: Restore from row
- **WHEN** the user activates restore on an archived row
- **THEN** the client SHALL send `unarchive_session`, remove the row on success, and the session SHALL be visible in the folder's ended group

#### Scenario: Delete from row
- **WHEN** the user confirms delete on an archived row
- **THEN** the session's `.jsonl` and `.meta.json` SHALL be removed, the row SHALL disappear, and `archived_count_updated` SHALL decrement the folder count

#### Scenario: Open read-only
- **WHEN** the user clicks an archived row
- **THEN** the dashboard SHALL open that session's transcript view without adding the session to the live `sessions` state

#### Scenario: Read-only deep link survives reload
- **WHEN** the user reloads `/session/<id>?archived=1`
- **THEN** the client SHALL fetch `GET /api/sessions/archived/<id>` and re-open the read-only view

#### Scenario: Hydrate archived by id
- **WHEN** a browser subscribes to an archived session id
- **THEN** the server SHALL hydrate the transcript from the index row's `sessionFile` without the session entering the live set

### Requirement: Include-archive search chip

The session search bar SHALL render an `include archive` chip, off by default, with its state persisted in local storage. When the chip is on and the search text is at least 3 characters, the client SHALL debounce (≈300 ms) a request to `GET /api/sessions/archived?q=<text>&limit=50` and render matches grouped by each item's `groupPath` under an `Archive matches (N)` section as archived rows, where N is the number of returned matches in that folder. When the chip is off, search SHALL behave exactly as before over resident sessions only. The active-only, tag and phase axes SHALL NOT be applied to archived matches.

#### Scenario: Chip off
- **WHEN** the chip is off and the user types `allowlist`
- **THEN** no archived request SHALL be made and only resident sessions SHALL be filtered

#### Scenario: Chip on with matches
- **WHEN** the chip is on, the user types `allowlist`, and two archived sessions in `/a` match
- **THEN** `/a` SHALL show an `Archive matches (2)` section with two archived rows beneath its resident matches

#### Scenario: Chip on with no matches
- **WHEN** the chip is on and the archived request returns no items
- **THEN** no `Archive matches` section SHALL be rendered

#### Scenario: Chip persists
- **WHEN** the user turns the chip on and reloads the page
- **THEN** the chip SHALL be on
