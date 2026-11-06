## MODIFIED Requirements

### Requirement: Per-folder archived count in the snapshot

The server SHALL keep an in-memory archive index of `ArchivedSessionSummary` rows (`id, name, firstMessage, cwd, gitWorktree, endedAt, archivedAt, sessionFile`) built from the boot sidecar scan, keyed by `pathKey(resolveSessionGroupPath(row))` (pin > worktree main path > cwd, then path normalisation that case-folds on darwin and win32) and re-keyed when the pinned set changes. Each row SHALL carry its display `groupPath`. `endedAt` SHALL fall back to the sidecar mtime when absent. `sessions_snapshot` SHALL carry `archivedCountByCwd: Record<string, number>` derived from the index and maintained on every archive, restore and delete. The server SHALL broadcast `archived_count_updated { cwd, count }` whenever a folder's count changes. Folders with count `0` MAY be omitted from the map.

`sessions_snapshot` SHALL also carry `pathKeyPlatform` (`"linux"`, `"darwin"` or `"win32"`), the platform whose path normalisation produced the archive index keys. Every folder identifier sent for archived counts SHALL remain that index key. This covers each `archivedCountByCwd` key, `session_archived.cwd` and `archived_count_updated.cwd`. A client SHALL derive the archive key for a folder by applying the same normalisation, using `pathKeyPlatform`, to the folder's group path. When a server omits `pathKeyPlatform`, the client SHALL fall back to its own platform inference.

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

#### Scenario: Snapshot names the key platform
- **GIVEN** the server runs on darwin
- **WHEN** a browser connects
- **THEN** `sessions_snapshot.pathKeyPlatform` SHALL be `"darwin"`
- **AND** a folder `/Users/x/Proj` with 82 archived sessions SHALL appear as `archivedCountByCwd["/users/x/proj"] = 82`

### Requirement: Folder archive fold loads lazily

Each folder group SHALL render an `Archive (N)` fold below its ended-sessions fold when `N > 0`, collapsed by default. This applies regardless of the server platform's path case sensitivity. The first expansion SHALL request the first page for that folder and show placeholder skeleton rows while in flight. The expanded fold SHALL show `showing X of N`, and a `Load M more` control (M = min(page size, remaining)) until `nextCursor` is absent. An `archived_count_updated` or `session_archived` for the folder SHALL invalidate its loaded pages so the next expansion (or an already-open fold) refetches the first page. A failed request SHALL show an inline retry control. Rows returned SHALL be rendered by an archived-row component and SHALL NOT be added to the live `sessions` state.

#### Scenario: Fold hidden at zero
- **WHEN** a folder has `archivedCountByCwd` of `0` or absent
- **THEN** no archive fold SHALL be rendered for it

#### Scenario: Fold visible for a mixed-case folder on a case-folding host
- **GIVEN** the snapshot has `pathKeyPlatform: "darwin"` and `archivedCountByCwd["/users/x/proj"] = 82`, and a live folder group has `cwd = /Users/x/Proj`
- **WHEN** the sidebar renders
- **THEN** the folder SHALL show an `Archive (82)` fold
- **AND** expanding it SHALL request the first page for that folder and render its rows

#### Scenario: Fold visible for a pinned folder spelled differently
- **GIVEN** the snapshot has `pathKeyPlatform: "darwin"`, the user pinned `/Users/x/Proj/`, and `archivedCountByCwd["/users/x/proj"] = 3`
- **WHEN** the sidebar renders the pinned group
- **THEN** it SHALL show an `Archive (3)` fold

#### Scenario: Linux keeps case-distinct folders apart
- **GIVEN** the snapshot has `pathKeyPlatform: "linux"` and `archivedCountByCwd` is `{ "/a/Proj": 2, "/a/proj": 5 }`
- **WHEN** live groups `/a/Proj` and `/a/proj` render
- **THEN** they SHALL show `Archive (2)` and `Archive (5)` respectively

#### Scenario: Older server without the platform field
- **WHEN** the snapshot omits `pathKeyPlatform`
- **THEN** the client SHALL derive archive keys with its own inferred platform (`/`-rooted paths as `linux`, drive-letter or backslash paths as `win32`)

#### Scenario: Invalidation reaches a mixed-case folder
- **GIVEN** `pathKeyPlatform: "darwin"`, and the fold of live group `/Users/x/Proj` is expanded with rows loaded
- **WHEN** `archived_count_updated { cwd: "/users/x/proj", count: 81 }` arrives
- **THEN** the fold SHALL refetch its first page and show `Archive (81)`

#### Scenario: First expand fetches
- **WHEN** the user expands the archive fold of a folder for the first time
- **THEN** the client SHALL request `GET /api/sessions/archived?cwd=<folder archive key>&limit=50` and render skeletons until the response arrives

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

### Requirement: Include-archive search chip

The sidebar header's filter-funnel popover SHALL render an `Archived` toggle, off by default, with its state persisted in local storage. The toggle SHALL show an archive icon and the label `Archived`. It SHALL render in the same style as the `Hidden` toggle (see session-filtering, Show hidden toggle). It SHALL expose its state via `aria-pressed`. When the toggle is on and the search text is at least 3 characters, the client SHALL debounce (≈300 ms) a request to `GET /api/sessions/archived?q=<text>&limit=50`. It SHALL render matches grouped by each item's `groupPath` (matched to folders by the same archive key as the fold) under an `Archive matches (N)` section as archived rows, where N is the number of returned matches in that folder. When the toggle is off, search SHALL behave exactly as before over resident sessions only. The active-only, tag and phase axes SHALL NOT be applied to archived matches.

#### Scenario: Chip off
- **WHEN** the toggle is off and the user types `allowlist`
- **THEN** no archived request SHALL be made and only resident sessions SHALL be filtered

#### Scenario: Chip on with matches
- **WHEN** the toggle is on, the user types `allowlist`, and two archived sessions in `/a` match
- **THEN** `/a` SHALL show an `Archive matches (2)` section with two archived rows beneath its resident matches

#### Scenario: Chip on with no matches
- **WHEN** the toggle is on and the archived request returns no items
- **THEN** no `Archive matches` section SHALL be rendered

#### Scenario: Chip persists
- **WHEN** the user turns the toggle on and reloads the page
- **THEN** the toggle SHALL be on

#### Scenario: Archive matches attach to a mixed-case folder
- **GIVEN** `pathKeyPlatform: "darwin"`, the toggle is on, and the query matches an archived row whose `groupPath` is `/Users/x/proj`
- **WHEN** a live group `/Users/x/Proj` renders
- **THEN** that group SHALL show the match under `Archive matches (1)`
