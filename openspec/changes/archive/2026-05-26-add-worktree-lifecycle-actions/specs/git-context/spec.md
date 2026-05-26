## ADDED Requirements

### Requirement: cwdMissing flag on DashboardSession
`DashboardSession` SHALL carry an optional `cwdMissing?: boolean` field set by any of three probe sites: (1) the bridge's 30 s VCS tick, (2) the server's session scanner on boot, (3) the `worktree/remove` lifecycle endpoint. The field is purely computed and SHALL NOT be persisted.

#### Scenario: Bridge probe flips on deletion
- **WHEN** the bridge's 30 s tick discovers `existsSync(ctx.cwd) === false` for the first time
- **THEN** the bridge SHALL send `{ type: "cwd_missing", sessionId }` to the server
- **AND** the server SHALL stamp `cwdMissing: true` and broadcast `session_updated`

#### Scenario: Scanner re-probes ended sessions
- **WHEN** the server's session scanner enumerates an ended session whose `cwd` no longer exists on disk
- **THEN** the scanner SHALL stamp `cwdMissing: true` on the in-memory `DashboardSession` before adding it to the manager

#### Scenario: Optimistic stamp on lifecycle remove
- **WHEN** `POST /api/git/worktree/remove` succeeds
- **THEN** every session whose `cwd` was inside the removed path SHALL receive `cwdMissing: true` via `session_updated`

#### Scenario: Backward compatibility with older bridges
- **WHEN** a bridge older than this change is connected
- **THEN** the field SHALL remain `undefined` for every session managed by that bridge
- **AND** the client SHALL treat `undefined` as "not missing"

### Requirement: Stable error code cwd_missing
The server's spawn / resume preflight SHALL return error `code: "cwd_missing"` (replacing the older `cwd_invalid`) when the session's cwd no longer exists. For one release the response envelope SHALL include both keys to preserve compatibility with older clients reading `cwd_invalid`.

#### Scenario: Resume fails with cwd_missing
- **WHEN** a client attempts to resume a session whose cwd has been deleted
- **THEN** the server SHALL respond with `{ success: false, error: "cwd_missing", stderr: "<path>" }`
