# openspec-change-grouping Specification

## Purpose

Per-repo grouping of OpenSpec changes. Server-side persistence in `<cwd>/openspec/groups/groups.json`, REST CRUD routes, mtime-gated read cache, atomic writes with race retry, debounced WebSocket broadcasts, and server-side join of `groupId` into emitted `OpenSpecChange` payloads. Single-source-of-truth used by folder section, archive browser, and attach dialog UIs.

## Requirements

### Requirement: Per-repo groups file location and shape
Each repository SHALL hold its OpenSpec change grouping data in a single JSON file located at `<cwd>/openspec/groups/groups.json`. The file SHALL contain a top-level object with three fields: `schemaVersion: number`, `groups: OpenSpecGroup[]`, and `assignments: Record<string, string>` (changeName → groupId). The file is opt-in: when absent, the dashboard SHALL behave as if `groups: []` and `assignments: {}` were present, and SHALL NOT create the directory or file until the first write.

#### Scenario: File absent → empty default returned on read
- **WHEN** a `GET /api/openspec/groups?cwd=/project/foo` is issued and `<cwd>/openspec/groups/groups.json` does not exist
- **THEN** the response SHALL be `{ success: true, data: { schemaVersion: 1, groups: [], assignments: {} } }`
- **AND** the directory `<cwd>/openspec/groups/` SHALL NOT be created on the read

#### Scenario: File present → contents returned verbatim
- **WHEN** a GET is issued and the file contains `{ schemaVersion: 1, groups: [{ id: "ui", name: "UI", color: "#3b82f6", order: 0 }], assignments: { "add-foo": "ui" } }`
- **THEN** the response data SHALL equal the file contents exactly

#### Scenario: First write creates directory and file
- **WHEN** a POST creates the first group for a cwd that has no `openspec/groups/` directory yet
- **THEN** the server SHALL create `<cwd>/openspec/groups/` and write `groups.json` atomically
- **AND** the file SHALL contain `schemaVersion: 1`, the new group in `groups`, and an empty `assignments` object

### Requirement: Schema versioning and unsupported-version rejection
The server SHALL include `schemaVersion: 1` on every write. On every read it SHALL validate that `schemaVersion === 1`. Reads of files with unknown / future versions SHALL fail with HTTP 422 "unsupported schema version" rather than coercing or silently dropping fields.

#### Scenario: Unknown schema version on read
- **WHEN** the on-disk file contains `{ schemaVersion: 2, groups: [...], assignments: {...} }`
- **THEN** the read API SHALL return HTTP 422 with `{ success: false, error: "unsupported schema version: 2" }`
- **AND** no cache entry SHALL be populated for that cwd

#### Scenario: Missing schemaVersion field
- **WHEN** the on-disk file lacks the `schemaVersion` field
- **THEN** the read API SHALL return HTTP 422 with an error mentioning the missing field

### Requirement: OpenSpecGroup shape
Each entry in `groups[]` SHALL conform to the `OpenSpecGroup` shape: `{ id: string, name: string, color?: string, order: number }`. `id` is server-generated (slug of `name` plus collision suffix when needed) and stable across rename. `name` is user-visible and editable. `color` is an optional CSS hex (`#RRGGBB`) or omitted (clients pick a default from the palette). `order` is a non-negative integer; the server SHALL keep `order` values contiguous (`0..groups.length - 1`) after every reorder.

#### Scenario: ID generated server-side from name slug
- **WHEN** a POST creates a group with `name: "User Interface"`
- **THEN** the response SHALL include `id` starting with `user-interface` (e.g., `user-interface` or `user-interface-2` if a collision exists)

#### Scenario: ID stable across rename
- **WHEN** a PATCH updates the group with `id: "ui"` to `name: "Frontend"`
- **THEN** the stored group SHALL have `id: "ui"` and `name: "Frontend"`

#### Scenario: Order normalized after PATCH reorder
- **WHEN** groups have `order: [0, 1, 2]` and a PATCH sets `order: 5` on the first group
- **THEN** the resulting `order` values SHALL be `[2, 0, 1]` (or some valid contiguous 0..2 reordering reflecting the user intent)
- **AND** no two groups SHALL share an `order`

### Requirement: Single-group assignment per change
Each change SHALL be assigned to at most one group. The `assignments` map SHALL store one entry per assigned change with the group's `id` as value. Unassigned changes SHALL have no entry in the map.

#### Scenario: Assigning a change adds a single map entry
- **WHEN** a PUT assigns change `"add-foo"` to group id `"ui"`
- **THEN** `assignments` SHALL contain `{ "add-foo": "ui" }`

#### Scenario: Reassigning replaces the previous group
- **WHEN** `assignments["add-foo"]` is `"ui"` and a PUT assigns `"add-foo"` to `"server"`
- **THEN** `assignments["add-foo"]` SHALL equal `"server"` (no duplicate, no second entry)

#### Scenario: Unassigning removes the map entry
- **WHEN** `assignments["add-foo"]` is `"ui"` and a PUT sets `groupId: null` for `"add-foo"`
- **THEN** the `"add-foo"` key SHALL be absent from `assignments`

### Requirement: Group CRUD REST routes
The server SHALL expose REST routes under `/api/openspec/groups` accepting a `cwd` query parameter:
- `GET /api/openspec/groups?cwd=<path>` — returns `{ schemaVersion, groups, assignments }`.
- `POST /api/openspec/groups?cwd=<path>` — body `{ name: string, color?: string }` creates a group and returns the new entry.
- `PATCH /api/openspec/groups/:id?cwd=<path>` — body subset of `{ name, color, order }` partial-updates the group; reorders normalize across all groups.
- `DELETE /api/openspec/groups/:id?cwd=<path>` — removes the group; assignments referencing it are removed (changes revert to Ungrouped).
- `PUT /api/openspec/groups/assignments?cwd=<path>` — body `{ changeName: string, groupId: string | null }` sets one assignment.

#### Scenario: GET on missing cwd parameter
- **WHEN** a GET is issued without `cwd`
- **THEN** the response SHALL be HTTP 400 with `{ success: false, error: "Missing cwd" }`

#### Scenario: POST creates group with generated id and order
- **WHEN** a POST sends `{ name: "UI", color: "#3b82f6" }` for cwd `/project/foo` with zero existing groups
- **THEN** the response SHALL be `{ success: true, data: { id: "ui", name: "UI", color: "#3b82f6", order: 0 } }`

#### Scenario: POST collision suffix
- **WHEN** a POST sends `{ name: "UI" }` and a group with `id: "ui"` already exists
- **THEN** the new group SHALL have `id: "ui-2"` (or the next available `ui-N` slug)

#### Scenario: PATCH updates name only
- **WHEN** a PATCH targets `id: "ui"` with body `{ name: "Frontend" }`
- **THEN** the stored group SHALL have `name: "Frontend"` and unchanged `id`, `color`, `order`

#### Scenario: PATCH on unknown group id
- **WHEN** a PATCH targets `id: "does-not-exist"`
- **THEN** the response SHALL be HTTP 404 with `{ success: false, error: "Group not found" }`

#### Scenario: DELETE cleans up assignments
- **WHEN** a DELETE removes group `id: "ui"` and `assignments` previously contained `{ "add-foo": "ui", "fix-bar": "server" }`
- **THEN** `assignments` after the delete SHALL be `{ "fix-bar": "server" }`

#### Scenario: PUT assignment validates groupId
- **WHEN** a PUT sets `assignments["add-foo"] = "does-not-exist"`
- **THEN** the response SHALL be HTTP 422 with `{ success: false, error: "Unknown groupId" }`
- **AND** the on-disk file SHALL be unchanged

#### Scenario: PUT assignment with null clears entry
- **WHEN** a PUT sends `{ changeName: "add-foo", groupId: null }`
- **THEN** the response SHALL be `{ success: true }`
- **AND** `"add-foo"` SHALL be absent from `assignments`

#### Scenario: PUT assignment tolerates unknown changeName
- **WHEN** a PUT sets `assignments["never-existed"] = "ui"` for an existing groupId
- **THEN** the response SHALL be `{ success: true }` (no validation against live changes)
- **AND** the on-disk `assignments` SHALL contain the entry

### Requirement: Atomic write with mtime-recheck and 1-shot retry on race
Every server write SHALL go through an atomic write-to-temp-then-rename via the existing `json-store.ts` helpers. Inside the per-cwd FIFO write mutex, the server SHALL re-stat the file before rename; if the file's `mtimeMs` differs from the value seen at the start of the write cycle, the server SHALL re-read, re-compute, and retry the write **once**. A second mtime mismatch SHALL produce HTTP 409 Conflict with the current file payload.

#### Scenario: Successful write under no contention
- **WHEN** a POST creates a group and no other writer/editor touches the file
- **THEN** the temp file SHALL be written and renamed in place atomically
- **AND** the cache for that cwd SHALL be updated with the new `mtimeMs` and parsed `data`

#### Scenario: Hand-edit during write triggers retry
- **WHEN** the server has read the file, computed the new state, and is about to rename, and a hand-edit increments mtime in between
- **THEN** the server SHALL re-read the file, re-compute the state on the new base, and write once more
- **AND** the response SHALL succeed if the second attempt sees a stable mtime

#### Scenario: Sustained race returns 409 with current payload
- **WHEN** a second mtime mismatch is detected on the retry attempt
- **THEN** the response SHALL be HTTP 409 with `{ success: false, error: "Concurrent edit detected", data: <current file payload> }`
- **AND** the on-disk file SHALL be unchanged from its second-edit state

### Requirement: Per-cwd FIFO write mutex
The server SHALL serialize concurrent dashboard writes to the same cwd via a per-cwd promise chain. Writes for different cwds proceed in parallel. Reads do NOT enter the mutex.

#### Scenario: Two concurrent writes to the same cwd serialize
- **WHEN** two POST requests for cwd `/project/foo` arrive simultaneously
- **THEN** the second write SHALL await completion of the first before its read-modify-write cycle begins
- **AND** the final file state SHALL contain both newly created groups (no lost write)

#### Scenario: Concurrent writes to different cwds proceed in parallel
- **WHEN** a POST for `/project/foo` and a POST for `/project/bar` arrive simultaneously
- **THEN** they SHALL run in parallel without contending on each other's mutex

### Requirement: mtime-gated read cache
The server SHALL maintain an in-memory cache `Map<cwd, { mtimeMs, data, inFlight? }>` for groups files. On each read the server SHALL `fs.stat` the file and compare `stat.mtimeMs` to the cached value. On a hit (mtime equal) it SHALL return the cached parsed `data` without reading or parsing the file. On a miss it SHALL read, parse, validate, and replace the cache entry. Concurrent reads in the same tick SHALL share a single in-flight promise.

#### Scenario: Cache hit on unchanged mtime
- **WHEN** a read happens, the cache contains `{ mtimeMs: 1000, data: D }`, and `fs.stat` returns `mtimeMs: 1000`
- **THEN** the server SHALL return `D` without calling `fs.readFile`

#### Scenario: Cache miss on mtime change refreshes entry
- **WHEN** a read happens, the cache contains `{ mtimeMs: 1000, data: D1 }`, and `fs.stat` returns `mtimeMs: 2000`
- **THEN** the server SHALL read and parse the file
- **AND** the cache entry SHALL be replaced with `{ mtimeMs: 2000, data: D2 }`
- **AND** the response SHALL contain `D2`

#### Scenario: Concurrent reads in the same tick share one fs read
- **WHEN** five concurrent GETs for cwd `/project/foo` are issued in the same event-loop tick on a stale cache
- **THEN** only one `fs.readFile` call SHALL be made
- **AND** all five responses SHALL receive the same parsed payload

#### Scenario: File deleted between reads invalidates cache
- **WHEN** the file existed and a subsequent stat returns ENOENT
- **THEN** the cache entry SHALL be cleared
- **AND** the response SHALL be the empty default `{ schemaVersion: 1, groups: [], assignments: {} }`

#### Scenario: Within-second second write detected via size
- **WHEN** two writes happen within a 1-second mtime resolution window and produce different file sizes
- **THEN** the cache key combining `mtimeMs + size` SHALL detect the change
- **AND** the second read SHALL re-parse and return the latest payload

### Requirement: WebSocket broadcast on group/assignment changes with debounce
After every successful write the server SHALL schedule an `openspec_groups_update` WebSocket broadcast on a per-cwd 50–100 ms trailing-debounce timer. The broadcast payload SHALL include `{ cwd, groups, assignments }` (full payload, no incremental delta). The cache update is synchronous per write so the `GET` API never returns stale data during the debounce window.

#### Scenario: Single write produces single broadcast
- **WHEN** one PATCH succeeds for cwd `/project/foo`
- **THEN** within 50–100 ms exactly one `openspec_groups_update` SHALL be broadcast to all clients subscribed to that cwd
- **AND** the broadcast payload SHALL contain the latest `{ groups, assignments }` from the cache

#### Scenario: Bulk writes coalesce into one broadcast
- **WHEN** five PATCH requests succeed for cwd `/project/foo` within a 50 ms window
- **THEN** exactly one broadcast SHALL be emitted at the end of the debounce window
- **AND** the broadcast payload SHALL reflect the final state after all five writes

#### Scenario: Writes to different cwds do not coalesce
- **WHEN** writes succeed for cwd `/project/foo` and cwd `/project/bar` within the same window
- **THEN** two broadcasts SHALL be emitted (one per cwd)

### Requirement: Server-side join of `groupId` into `OpenSpecChange`
When the server emits `OpenSpecData` for a cwd, each `OpenSpecChange` SHALL be augmented with `groupId: string | null` joined from `assignments[change.name]` for that cwd. Clients SHALL NOT recompute the join.

#### Scenario: Change with assignment exposes groupId
- **WHEN** `OpenSpecData` is broadcast for cwd `/project/foo` and `assignments["add-foo"] = "ui"`
- **THEN** the broadcast `OpenSpecChange` for `"add-foo"` SHALL have `groupId: "ui"`

#### Scenario: Unassigned change exposes null groupId
- **WHEN** `OpenSpecData` is broadcast for a change with no entry in `assignments`
- **THEN** the broadcast `OpenSpecChange` SHALL have `groupId: null`

#### Scenario: Assignment for unknown changeName ignored at join
- **WHEN** `assignments["never-existed"] = "ui"` exists but no live change has that name
- **THEN** no `OpenSpecChange` with that name SHALL be emitted (assignment is dormant, not synthesized)

### Requirement: Authentication and cwd validation
All `/api/openspec/groups*` routes SHALL be auth-gated identical to other dashboard mutation routes. The `cwd` query parameter SHALL be validated against the dashboard's known-cwd set (same validator used by other openspec routes); requests for unknown cwds SHALL return HTTP 403.

#### Scenario: Unauthenticated request rejected
- **WHEN** a GET / POST / PATCH / DELETE / PUT is issued without authentication
- **THEN** the response SHALL be HTTP 401

#### Scenario: cwd not in known-cwd set rejected
- **WHEN** an authenticated request targets a cwd unknown to the dashboard
- **THEN** the response SHALL be HTTP 403 with `{ success: false, error: "cwd not allowed" }`

### Requirement: Groups render as board columns with inline management
On the OpenSpec board, each group SHALL render as a column whose header exposes inline management: rename, recolor, delete, a new-proposal `＋`, and a drag grip for reordering. The standalone "Manage groups" modal entry point is no longer required for these actions.

#### Scenario: Inline manage from column header
- **WHEN** the user activates a column header's `⚙` control
- **THEN** rename, recolor, and delete affordances for that group SHALL be available without opening a separate folder-card modal

#### Scenario: New proposal scoped to column
- **WHEN** the user activates a column header's `＋` control
- **THEN** the new-proposal dialog SHALL open pre-scoped to that column's group

### Requirement: Column order uses persisted group order
Column ordering on the board SHALL be driven by the existing persisted group `order`, and dragging a column header SHALL update that order.

#### Scenario: Column order reflects stored order
- **WHEN** groups have `order` values `[In flight=0, Backlog=1]`
- **THEN** the board SHALL render `In flight` left of `Backlog`

#### Scenario: Drag updates stored order
- **WHEN** the user drags `Backlog` before `In flight`
- **THEN** the server SHALL persist the updated `order` for the moved groups via the existing group update route
