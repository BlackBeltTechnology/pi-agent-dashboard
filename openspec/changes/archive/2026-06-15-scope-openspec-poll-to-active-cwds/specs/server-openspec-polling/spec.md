## MODIFIED Requirements

### Requirement: Server polls openspec CLI per directory
The server SHALL run `openspec list --json` and `openspec status --change <name> --json` for each known directory at a **configurable interval** (default 30 seconds, range 5–3600 seconds, controlled by `DashboardConfig.openspec.pollIntervalSeconds`) and broadcast results keyed by cwd to connected browsers. Each directory's poll SHALL be offset within the interval by a deterministic per-cwd phase (range 0 to `DashboardConfig.openspec.jitterSeconds`, default 5 s) so that polls do not all align on the same tick.

The set of **known directories** SHALL be the union of:
- every explicitly **pinned** directory, and
- the cwd of every session whose status is **not** `"ended"` (i.e. active sessions).

Ended sessions — including hidden ones — SHALL NOT contribute their cwd to the known-directory set. A directory whose sessions have all ended and that is not pinned SHALL stop being polled until a new session registers in it or it is pinned.

#### Scenario: Periodic poll for a known directory
- **WHEN** one poll interval has elapsed since the last poll for a directory
- **THEN** the server SHALL evaluate the directory for re-polling (subject to change detection, see below) and broadcast an `openspec_update` message with `cwd` and `data` fields if the data has changed

#### Scenario: Configurable interval
- **WHEN** `DashboardConfig.openspec.pollIntervalSeconds` is set to 60
- **THEN** the server SHALL poll every 60 seconds instead of 30
- **AND** changing this value via `PUT /api/config` SHALL take effect without a server restart

#### Scenario: Deterministic per-cwd phase offset
- **WHEN** three known directories exist and `jitterSeconds` is 5
- **THEN** each directory's poll SHALL fire at a stable offset in `[0, 5000) ms` derived from a hash of its cwd
- **AND** the same cwd SHALL receive the same offset on every tick

#### Scenario: Initial poll on server startup
- **WHEN** the server starts with known directories
- **THEN** the server SHALL poll openspec for each known directory and **after each poll completes**, broadcast `openspec_update` to all connected browsers when the prior cache was empty/undefined or the polled data differs from prior

#### Scenario: New directory becomes known
- **WHEN** a new pinned directory is added or a session registers with a new cwd
- **THEN** the server SHALL immediately poll openspec for that directory (bypassing both jitter and change detection for this first poll)

#### Scenario: Ended session cwd is excluded from polling
- **WHEN** every session in a given cwd has status `"ended"` and the cwd is not pinned
- **THEN** the server SHALL NOT include that cwd in the known-directory set
- **AND** the server SHALL NOT spawn `openspec list` / `openspec status` for it on periodic ticks

#### Scenario: Hidden session does not extend poll load
- **WHEN** an ended session is hidden via `POST /api/session/:id/hide`
- **THEN** the server SHALL NOT poll its cwd on account of that session (hiding an ended session never re-adds it to the work set)

#### Scenario: Pinned directory with only ended sessions still polls
- **WHEN** a directory is pinned but all its sessions have ended
- **THEN** the server SHALL continue to poll that directory (pinning is an explicit watch signal independent of session state)

#### Scenario: Reopening an ended cwd repopulates it
- **WHEN** a session registers in a cwd that was previously excluded (all prior sessions ended)
- **THEN** the server SHALL immediately poll that cwd via the new-directory path and broadcast its `openspec_update`

#### Scenario: openspec CLI not available
- **WHEN** `openspec` is not installed or the directory is not an openspec project
- **THEN** the server SHALL cache `{ initialized: false, pending: false, changes: [] }` for that directory

#### Scenario: Browser requests immediate refresh
- **WHEN** a browser sends `openspec_refresh` with a `cwd` field
- **THEN** the server SHALL immediately re-poll the openspec CLI for that directory, **bypassing change detection** but still respecting the concurrency cap, and broadcast the result
