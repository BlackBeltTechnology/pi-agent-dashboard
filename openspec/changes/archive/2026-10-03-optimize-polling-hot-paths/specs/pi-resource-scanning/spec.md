## MODIFIED Requirements

### Requirement: REST endpoint
The server SHALL expose `GET /api/pi-resources?cwd=<path>` returning scanned resources. `cwd` is optional: when it is absent the server SHALL use its own working directory (the global Settings resource pages read only the global scope).

#### Scenario: Successful scan
- **WHEN** a request is made with a valid `cwd` that matches a known session directory
- **THEN** the response SHALL be `{ success: true, data: { local: {...}, global: {...}, packages: [...] } }`

#### Scenario: Missing cwd parameter
- **WHEN** `cwd` is not provided
- **THEN** the server SHALL resolve resources for its own working directory and respond with `{ success: true, data: ... }`

#### Scenario: Localhost only
- **WHEN** a request originates from a non-loopback address
- **THEN** the request SHALL be rejected with HTTP 403

### Requirement: Polling integration
The server SHALL NOT rescan pi resources on a background timer; `openspec.pollIntervalSeconds` SHALL NOT govern when pi resources are scanned (watch reconciliation piggybacks on the OpenSpec poll tick, below). Scan results SHALL be cached per cwd (a request without `cwd` uses the server's own working directory, as the endpoint does today) and produced on demand by `GET /api/pi-resources`:

- **cold miss** (no entry) — the request SHALL scan and wait for the result;
- **stale entry** (marked stale by a watch event, or scanned 5 or more minutes ago) — the request SHALL return the stale entry immediately and start a background rescan;
- **fresh entry** — the request SHALL return it without scanning;
- `refresh=true` — the request SHALL scan and wait, then store the result.

Concurrent scans for the same cwd SHALL share one in-flight scan.

After an entry is first scanned, the server SHALL watch (non-recursively) `<cwd>/.pi/` and its `skills`, `prompts`, `extensions`, `agents`, `themes` subdirectories, and — once per server — `~/.pi/agent/` and the same subdirectories. An event whose filename is `settings.json`, names an entry inside a watched resource subdirectory, names one of the resource subdirectories (directory creation), or carries no filename SHALL mark that cwd's entry stale; under `~/.pi/agent/` it SHALL mark every entry stale. Directories that do not exist or cannot be watched SHALL be skipped. Watch reconciliation — attaching subdirectories that now exist, and closing the watches of entries not requested for 10 minutes — SHALL run on cache access and on every firing of the existing OpenSpec poll timer — before, and regardless of, that tick's in-flight and `openspec.enabled` gates — without a new timer. Closing an entry's watches SHALL keep its cached data, which from then on is treated as stale (served immediately and revalidated in the background on the next request). At most 16 cwds SHALL hold watches at once (least recently requested released first) and at most 64 cwds SHALL keep cached data (least recently requested dropped first). Stopping DirectoryService polling SHALL close every pi-resource watch.

#### Scenario: Polling interval
- **WHEN** DirectoryService polling is running
- **THEN** pi resources SHALL NOT be re-scanned on any timer; they SHALL be scanned only on a request as defined above

#### Scenario: No background rescan
- **WHEN** the server runs for 30 minutes with known session directories and no client requests `/api/pi-resources`
- **THEN** `scanPiResources` SHALL NOT be called

#### Scenario: Cache hit
- **WHEN** `GET /api/pi-resources` is called for a cwd whose entry is fresh
- **THEN** the cached result SHALL be returned without re-scanning

#### Scenario: Stale entry served while revalidating
- **WHEN** a request arrives for a cwd whose entry was scanned 6 minutes ago
- **THEN** the response SHALL carry that entry without waiting, and a background rescan SHALL replace it

#### Scenario: Concurrent misses share one scan
- **WHEN** two requests for the same uncached cwd arrive before the first scan finishes
- **THEN** `scanPiResources` SHALL be called once and both requests SHALL receive its result

#### Scenario: Local skill added
- **WHEN** a file is created under `<cwd>/.pi/skills/` after the cwd's entry was cached
- **THEN** the entry SHALL be marked stale and the next request SHALL trigger a rescan

#### Scenario: Resource directory created later
- **WHEN** `<cwd>/.pi/skills/` did not exist when the entry was cached and is created afterwards
- **THEN** the entry SHALL be marked stale and the new directory SHALL be watched after the next reconciliation

#### Scenario: Global settings changed
- **WHEN** `~/.pi/agent/settings.json` changes
- **THEN** every cached entry SHALL be marked stale

#### Scenario: Watch unavailable
- **WHEN** a watch cannot be attached for a resource directory
- **THEN** the cache SHALL still serve the entry and SHALL treat it as stale once it is 5 minutes old

#### Scenario: Idle entry releases its watches
- **WHEN** a cwd's entry was last requested more than 10 minutes ago and reconciliation runs
- **THEN** that entry's watches SHALL be closed and its data kept as stale
- **AND** the next request for that cwd SHALL be answered from the stale data while a background rescan runs

#### Scenario: Watch cap
- **WHEN** a 17th cwd is scanned while 16 cwds hold watches
- **THEN** the least recently requested cwd SHALL release its watches and keep its cached entry

#### Scenario: Reconciliation with OpenSpec disabled
- **WHEN** `openspec.enabled` is false and a cwd's entry has not been requested for 11 minutes
- **THEN** the next firing of the poll timer SHALL close that entry's watches

#### Scenario: Request without cwd
- **WHEN** the global Settings view requests `/api/pi-resources` without `cwd`
- **THEN** the server SHALL cache and watch under its own working directory exactly like any other cwd

#### Scenario: Manual refresh
- **WHEN** a request carries `refresh=true`
- **THEN** the pi resources cache SHALL be bypassed for that cwd and the result re-scanned and stored
