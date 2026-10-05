## ADDED Requirements

### Requirement: Opt-in plugin package with server and client entries
The system SHALL provide a workspace package `packages/voice-wall-plugin` whose `pi-dashboard-plugin` manifest declares a `server` entry, a `client` entry, no `bridge` entry, and `defaultEnabled: false`.
- The package SHALL vendor upstream `set-copilot`'s wall server modules and the DOM-free client modules (`wall-core.mjs`, `text-format.mjs`) under `src/vendor/set-copilot/`.
- `NOTICE` SHALL record the upstream commit SHA and the vendored file list.
- The package SHALL NOT vendor or serve upstream's wall page (`index.html`, `wall.js`, `wall.css`, `transcript.*`), `runWall`, or the fake feed.
- Vendored files SHALL be byte-identical to upstream except for patches named in `NOTICE`. The only v1 patch is `proxy-secret.patch`.

#### Scenario: Fresh install leaves the wall disabled
- **WHEN** the dashboard starts with the package present and no explicit plugin config
- **THEN** the plugin is not activated, registers no routes or slots, mounts no `/apps/wall/`, and provides no `voice-wall` service

#### Scenario: Vendored files match upstream
- **WHEN** a reviewer diffs `src/vendor/set-copilot/` against the pinned SHA
- **THEN** every difference is covered by a patch named in `NOTICE`, and every file is listed there

### Requirement: Walls run in-process on loopback without process-level side effects
The system SHALL host each meeting's wall as a vendored `WallServer` inside the dashboard process, bound to `127.0.0.1` on an ephemeral port, fed by a tail of `<runtimeDir>/wall-events.jsonl`.
- It SHALL obtain wall options by calling vendored `loadConfig` with `SET_COPILOT_DIR` set to the runtime dir, inside a snapshot of `process.env` that is restored exactly afterwards.
- It SHALL keep only the wall-related fields of the result, and SHALL build the category registry from config categories only, ignoring `wall.categoriesModule` with a logged warning.
- It SHALL reset the input offset (`wall-input-offset` = 0) on start, as upstream does.
- It SHALL feed the wall from an incremental tail that reads only appended bytes, resetting on truncation, and SHALL start at most one wall per meeting even under concurrent `ensureWall` calls.
- It SHALL NOT spawn a wall process, write `wall.pid` or `wall.url`, install signal handlers, or register a live-server row.

#### Scenario: Project .env does not leak into the dashboard
- **WHEN** a wall starts for a project whose `.env` defines `SONIOX_API_KEY` and `FOO=1`
- **THEN** the dashboard's `process.env` is byte-identical before and after

#### Scenario: Project code is not executed
- **WHEN** the project's config sets `wall.categoriesModule` to a module that writes a marker file when imported
- **THEN** the wall starts with config categories, the marker file is not created, and `status` carries a note about the ignored module

#### Scenario: Concurrent starts share one wall
- **WHEN** `ensureWall` is called twice concurrently for one `meetingId`
- **THEN** exactly one loopback server is bound and both calls resolve to the same result

#### Scenario: Loopback server refuses requests without the proxy secret
- **WHEN** a local process or a cross-origin page posts to the wall's loopback `/api/input`, or requests `/media`, without the per-host proxy secret header
- **THEN** the response is 404 and `wall-input.jsonl` is unchanged

#### Scenario: Redaction is applied
- **WHEN** the project config defines a redaction rule and a public-bound event matches it
- **THEN** viewers receive the redacted form

#### Scenario: Wall port is loopback only
- **WHEN** a client on another machine connects to the wall's bound port
- **THEN** the connection is refused

#### Scenario: Malformed events do not crash the dashboard
- **WHEN** a producer appends malformed lines, oversized lines, and an externally supplied `show` or `heartbeat` to `wall-events.jsonl`
- **THEN** the dashboard keeps serving, the wall drops those lines as upstream does, and subsequent valid events still reach clients

#### Scenario: Failed start leaves nothing behind
- **WHEN** `WallServer.start()` rejects
- **THEN** `ensureWall` rejects with the reason, `status` reports `error`, and no proxy route answers for that meeting

### Requirement: Runtime dirs are confined to the shared voice scratch root
The system SHALL accept only runtime dirs under `~/.pi/dashboard/voice/` (shared with the voice-assistant plugin) for `ensureWall` and `appendEvent`.

#### Scenario: Runtime dir inside a project tree is rejected
- **WHEN** `ensureWall` or `appendEvent` is called with a runtime dir inside the project's working tree
- **THEN** it rejects and starts or appends nothing

### Requirement: voice-wall provided service v2
The system SHALL provide a cross-plugin service named `voice-wall` with:
- `version: 2`;
- `scratchRoot`;
- `ensureWall({ projectRoot, runtimeDir, meetingId, owner, title? })` → `{ meetingId, folderPath, appPath }`;
- `stopWall(meetingId, { archiveTo? })`;
- `status(meetingId)`;
- `appendEvent(runtimeDir, raw, { projectRoot? })`.

`ensureWall` SHALL be idempotent per `meetingId`. `appendEvent` SHALL validate with upstream `normalizeEvent`, passing the project root known for that runtime dir (or given), and append to `wall-events.jsonl`, never bypassing the file.

#### Scenario: Second ensure returns the same wall
- **WHEN** `ensureWall` is called twice with the same `meetingId`
- **THEN** exactly one `WallServer` runs and both calls resolve to the same result

#### Scenario: Invalid event rejected
- **WHEN** a producer calls `appendEvent` with a payload upstream `normalizeEvent` rejects
- **THEN** it returns `{ ok: false, reason }` and appends nothing

#### Scenario: Service absent when plugin disabled
- **WHEN** the plugin is disabled
- **THEN** `consume("voice-wall")` returns undefined and consumers degrade without error

### Requirement: Pure event-schema export
The package SHALL provide a `./emit` subpath export exposing only the wall event validator and the events-file path helper, importable without loading the server entry or calling config loading.

#### Scenario: Import from a pi session
- **WHEN** a pi extension imports `./emit` and validates an event
- **THEN** no server-entry code runs and `process.env` is unchanged

### Requirement: Last-meeting archive and replay
`stopWall` with `archiveTo` SHALL first stop the wall, then copy the meeting's `wall-events.jsonl` to `archiveTo`, only when `archiveTo` ends in `.wall.jsonl` and its parent directory's realpath is inside the project root (`path.relative` is neither absolute nor `..`-prefixed). It SHALL record the copy as that project's last replay in plugin config and return its path. A replay SHALL be served by a transient read-only wall over that file, stopped after 5 minutes without a client.

#### Scenario: Archive includes the last event
- **WHEN** a producer appends an event, then `stopWall` is called with a valid `archiveTo`
- **THEN** the archived file contains that event

#### Scenario: Archive path outside the project refused
- **WHEN** `stopWall` is called with `archiveTo` resolving outside the project root, or not ending in `.wall.jsonl`
- **THEN** nothing is copied, the previous replay pointer is kept, and the wall still stops

#### Scenario: Idle replay host stops
- **WHEN** no client has read a replay for 5 minutes
- **THEN** its transient wall is stopped

### Requirement: Teardown on stop, disable and shutdown
On `stopWall`, plugin disable, or dashboard shutdown, the system SHALL:
1. revoke the meeting's share links;
2. end every proxied stream with a `share-ended` frame;
3. stop the `WallServer`;
4. release its port.

#### Scenario: Dashboard restart leaves no wall serving
- **WHEN** `POST /api/restart` is issued while walls are running
- **THEN** no wall port stays bound and every open viewer stream's connection closes

#### Scenario: Stop ends streams cleanly
- **WHEN** `stopWall` is called or the plugin is disabled with viewers connected
- **THEN** each stream receives a `share-ended` frame before closing
