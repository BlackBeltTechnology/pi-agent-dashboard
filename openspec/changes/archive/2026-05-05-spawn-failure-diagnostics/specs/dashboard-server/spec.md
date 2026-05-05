## ADDED Requirements

### Requirement: GET /api/spawn-failures returns recent failed-spawn entries
The dashboard server SHALL expose `GET /api/spawn-failures` returning the last N entries from `~/.pi/dashboard/sessions/spawn-failures.log` (and its rotated `.log.1` predecessor) as JSON `{ entries: SpawnFailureEntry[] }`. The route SHALL accept an optional `limit` query parameter, default `50`, max `500`. The route SHALL be registered in `packages/server/src/routes/system-routes.ts` and SHALL be subject to the existing Fastify auth plugin (no auth-bypass entry added).

#### Scenario: default limit returns last 50
- **WHEN** `GET /api/spawn-failures` is called and the log contains 200 entries
- **THEN** the response body SHALL be `{ entries: [...] }` with `entries.length === 50`
- **AND** the entries SHALL be the most recent 50 in file order (oldest of the 50 first)

#### Scenario: custom limit honored
- **WHEN** `GET /api/spawn-failures?limit=10` is called
- **THEN** the response SHALL contain at most 10 entries

#### Scenario: limit clamped to maximum
- **WHEN** `GET /api/spawn-failures?limit=10000` is called
- **THEN** the response SHALL contain at most 500 entries

#### Scenario: invalid limit falls back to default
- **WHEN** `GET /api/spawn-failures?limit=abc` is called
- **THEN** the response SHALL contain at most 50 entries (default applied)

#### Scenario: no log file
- **WHEN** `GET /api/spawn-failures` is called and no log file exists yet
- **THEN** the response SHALL be `{ entries: [] }` with HTTP 200

#### Scenario: auth required
- **WHEN** `GET /api/spawn-failures` is called without valid auth credentials in an auth-enabled deployment
- **THEN** the request SHALL be rejected by the existing auth plugin (HTTP 401), with no special bypass

### Requirement: Browser protocol carries spawn diagnostic fields
`packages/shared/src/browser-protocol.ts` SHALL extend the existing `spawn_error` message type with two optional fields: `code?: SpawnFailureCode` and `reasons?: PreflightReason[]`. It SHALL also add two new message types:
- `spawn_register_timeout` with shape `{ type: "spawn_register_timeout"; cwd: string; pid?: number; stderrTail?: string }` (`pid` optional because tmux/wt/wsl-tmux watches are cwd-keyed only).
- `spawn_register_recovered` with shape `{ type: "spawn_register_recovered"; cwd: string; pid?: number }`.

All additions SHALL be optional/additive — no protocol version bump and no removal of existing fields.

#### Scenario: spawn_error with code accepted by typed handler
- **WHEN** the browser receives a `spawn_error` carrying `code: "PI_NOT_FOUND"`
- **THEN** the typed message handler SHALL accept the field without runtime error

#### Scenario: spawn_register_timeout dispatched to handler
- **WHEN** the browser receives `{ type: "spawn_register_timeout", cwd, pid?, stderrTail? }`
- **THEN** the message router SHALL dispatch it to the spawn-error subsystem (no "unknown message type" warning)

#### Scenario: spawn_register_recovered dispatched to handler
- **WHEN** the browser receives `{ type: "spawn_register_recovered", cwd, pid? }`
- **THEN** the message router SHALL dispatch it to the spawn-error subsystem so it can clear any matching timeout banner

#### Scenario: legacy spawn_error without code still parses
- **WHEN** the browser receives a `spawn_error` lacking `code` and `reasons`
- **THEN** the message SHALL parse and dispatch identically to pre-change behavior
