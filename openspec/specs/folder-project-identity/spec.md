# folder-project-identity Specification

## Purpose
A folder's project identity — a declared `.pi/dashboard/project.json` plus marker rules from enabled plugins — resolved server-side behind the cwd admission guard, cached client-side, and exposed as synchronous folder predicates so plugins can scope apps to a project type or id.

## Requirements

### Requirement: Declared project identity file
A folder MAY declare its project identity in `<cwd>/.pi/dashboard/project.json` as a JSON object `{ "schemaVersion": 1, "id"?: string, "type"?: string }`.

The dashboard SHALL ignore the whole file when any of these holds:
- it is not a regular file;
- `.pi`, `.pi/dashboard` or the file itself is a symbolic link;
- it is larger than 64 KiB;
- it is not a JSON object;
- its `schemaVersion` is not `1`.

An ignored file SHALL be treated as absent. A file larger than 64 KiB SHALL be rejected without reading more than 64 KiB + 1 byte.

`id` and `type` SHALL be validated independently against `^[a-z][a-z0-9-]{0,63}$`. An invalid field SHALL be treated as absent while the other field is kept. Unknown fields SHALL be ignored, not rejected.

#### Scenario: Valid declaration
- **GIVEN** `acme-erp/.pi/dashboard/project.json` is `{ "schemaVersion": 1, "id": "acme-erp", "type": "judo" }`
- **WHEN** the dashboard resolves the project of `acme-erp`
- **THEN** the result has `id: "acme-erp"`, `types: ["judo"]` and `source: "declared"`

#### Scenario: One invalid field keeps the other
- **GIVEN** the file is `{ "schemaVersion": 1, "id": "acme-erp", "type": "JUDO!" }`
- **WHEN** the dashboard resolves the project of `acme-erp`
- **THEN** `id` is `"acme-erp"` and detection decides `types`

#### Scenario: Symlinked file is ignored
- **GIVEN** `acme-erp/.pi/dashboard/project.json` is a symbolic link
- **WHEN** the dashboard resolves the project of `acme-erp`
- **THEN** the file is treated as absent and its target is not read

### Requirement: Marker-rule detection and precedence
When a folder declares no valid `type`, the dashboard SHALL detect types from the `projectTypes` marker rules of the plugins that are currently loaded and enabled.

**Precedence and output**
- A declared `type` SHALL win: `types` SHALL be exactly `[type]` and no detection SHALL run.
- When no enabled plugin declares rules, detection SHALL NOT touch the filesystem.
- The project `id` SHALL come only from the declaration.
- `types` SHALL be unique and sorted ascending by code point.
- `source` SHALL describe where `types` came from, not where `id` came from: `"declared"` when `types` came from the file, `"detected"` when at least one marker matched, and `"none"` otherwise.

**Matching**
- A type SHALL match when at least one of its markers matches.
- Matching SHALL be case-sensitive.
- `*` SHALL match zero or more characters other than `/`.
- Names starting with `.` SHALL match like any other name.
- A marker SHALL match only a regular file or a directory.
- Symbolic links SHALL never match and SHALL never be followed.
- Detection SHALL never visit `.git` or `node_modules`.

**Bounds**
- One resolution SHALL perform a single shared walk for all rules.
- The walk SHALL read at most 2000 directory entries, stopping as soon as the budget is spent rather than after reading whole directories.
- It SHALL evaluate at most 256 patterns. Plugins are taken in (priority, id) order, the same order as claims, and a plugin whose patterns exceed the remaining budget is skipped.
- At most 4 walks SHALL run at once across the server. Further resolutions SHALL wait for a free slot.
- A resolution SHALL finish within 2 seconds. On reaching the deadline it SHALL stop, release its walk slot and report the types matched so far.
- The dashboard SHALL report `truncated: true` whenever the entry budget is exhausted, the deadline is reached, or any plugin's rules are skipped for the pattern budget.

#### Scenario: Detected type
- **GIVEN** the enabled `judo-app` plugin declares `{ "type": "judo", "markers": ["model/*.judo"] }` and `billing/model/core.judo` exists, with no declaration file
- **WHEN** the dashboard resolves the project of `billing`
- **THEN** the result has `id: null`, `types: ["judo"]` and `source: "detected"`

#### Scenario: Declared type wins over markers
- **GIVEN** `billing` declares `"type": "plain"` and `billing/model/core.judo` exists
- **WHEN** the dashboard resolves the project of `billing`
- **THEN** `types` is `["plain"]` and `source` is `"declared"`

#### Scenario: Declared id with detected type
- **GIVEN** `billing` declares `{ "schemaVersion": 1, "id": "billing" }` and `billing/model/core.judo` exists
- **WHEN** the dashboard resolves the project of `billing`
- **THEN** the result has `id: "billing"`, `types: ["judo"]` and `source: "detected"`

#### Scenario: Symlinked directory is not followed
- **GIVEN** `billing/model` is a symbolic link to a directory containing `core.judo`
- **WHEN** the dashboard resolves the project of `billing`
- **THEN** `judo` is not detected

#### Scenario: Disabled plugin's rules do not apply
- **WHEN** the `judo-app` plugin is disabled and the dashboard resolves the project of `billing`
- **THEN** `judo` is not among the detected types

#### Scenario: Entry budget
- **GIVEN** a folder whose tree holds more than 2000 entries before any marker matches
- **WHEN** the dashboard resolves its project
- **THEN** the response carries `truncated: true` and at most 2000 directory entries were read

### Requirement: Folder project endpoint
The server SHALL expose `GET /api/folder/project?cwd=<abs>`, behind the same network guard as the other localhost file routes. It SHALL return `200 { id: string|null, types: string[], source: "declared"|"detected"|"none", truncated?: true }`.

| Condition | Response |
|---|---|
| `cwd` missing or not absolute | `400` |
| `cwd` not admitted | `403` |
| Admission indeterminate | `503` with `Retry-After` and the body `{ "error": "cwd-admission-unavailable", "message": <string>, "retryAfterMs": <number> }` |
| `cwd` admitted but not an existing directory | `404` |

- A `cwd` is admitted when the dashboard already knows it (a session cwd, a pinned directory or a workspace folder) or the shared cwd guard admits it.
- Admission SHALL run before any existence check. A missing path that is not known is refused (`403`), so `404` occurs only for an admitted path that no longer exists.
- The route SHALL be classified in the route tier map at the `observe` tier, like `GET /api/file/exists`.
- On a refused or indeterminate admission, the server SHALL read nothing under the `cwd`.
- The endpoint SHALL NEVER raise an operator access prompt.
- It SHALL be read-only and SHALL NOT create or modify any file.

#### Scenario: Unknown folder refused silently
- **WHEN** a client requests the project of a cwd that is neither known nor admitted by the guard
- **THEN** the server returns `403`, reads nothing under that cwd, and no access prompt is raised

#### Scenario: Plain folder
- **WHEN** a client requests the project of an admitted folder with no declaration and no matching marker
- **THEN** the server returns `200 { id: null, types: [], source: "none" }`

### Requirement: Client project cache and folder predicates
The plugin runtime SHALL provide a per-folder project cache. Each entry SHALL be in one of three states: `loading`, `ready` (with the endpoint's result) or `error`. The runtime SHALL also provide:
- a hook returning a folder's cache entry;
- an invalidation call for one folder;
- two predicate factories, `folderHasProjectType(type)` and `folderHasProjectId(id)`.

Each factory SHALL return a synchronous `(folder: { cwd: string }) => boolean` usable as a folder-scoped claim `predicate`. The predicate SHALL return `true` only for a `ready` entry that matches.

**Fetching**
- On a cache miss the predicate SHALL return `false` and queue a request for the folder. Queuing SHALL happen without updating React state during render.
- Concurrent requests for one folder SHALL be de-duplicated.
- When responses land, the runtime SHALL store them and bump the slot-claims version once per batch of landings. Error landings SHALL bump too.
- Generations SHALL be tracked per folder. Invalidating a folder SHALL advance only that folder's generation, and clearing the cache SHALL advance every folder's. A response requested under an older generation of its folder SHALL be discarded on landing, and that folder SHALL be requested again.

**Errors and invalidation**
- A failed request SHALL be stored as `error`, so gated claims stay hidden (fail closed).
- An `error` entry SHALL expire after 60 seconds. On expiry the runtime SHALL drop the entry and bump the slot-claims version, so the predicate runs again and fetches again without any unrelated re-render.
- The cache SHALL be cleared when the set of enabled plugins changes, and SHALL NOT be cleared on a refresh that leaves the set unchanged.

#### Scenario: Folder entry appears after detection
- **GIVEN** the `judo-app` plugin's folder-section claim uses `predicate: isJudoFolder`, exported as `folderHasProjectType("judo")`
- **WHEN** the sidebar first renders folder `billing`, whose project resolves to `types: ["judo"]`
- **THEN** the folder entry is absent until the response lands and then appears without a page reload or any other state change

#### Scenario: Project-specific entry
- **GIVEN** a claim with predicate `folderHasProjectId("acme-erp")`
- **WHEN** the sidebar shows folders `acme-erp` (declared id `acme-erp`) and `billing` (no id)
- **THEN** only `acme-erp` shows the entry

#### Scenario: Failure fails closed, then retries
- **WHEN** the project request for a folder fails with a network error
- **THEN** every project-gated claim stays hidden for that folder, and 60 seconds later a new request is made without any user action

#### Scenario: Stale response after a plugin-set change is dropped
- **GIVEN** a project request for `billing` is in flight
- **WHEN** the enabled plugin set changes before it lands
- **THEN** the landed response is discarded and `billing` is fetched again under the new set

#### Scenario: Invalidating one folder leaves others in flight
- **GIVEN** project requests for `billing` and `acme-erp` are in flight
- **WHEN** `acme-erp` is invalidated
- **THEN** the `billing` response is stored when it lands, and only `acme-erp` is requested again

#### Scenario: Unchanged plugin set keeps the cache
- **WHEN** a plugin config update refreshes the enabled set without changing it
- **THEN** no folder project is fetched again
