## MODIFIED Requirements

### Requirement: Health endpoint

The dashboard server SHALL expose a `GET /api/health` endpoint that returns server liveness information including process ID, uptime, and the launch source under which the server is running.

**Modification:** the response body SHALL include a `launchSource` field of type `"electron" | "standalone" | "bridge"`. The field is the single source of truth used by browser clients to gate arm-specific UI affordances (notably the pi-core update path under Electron).

Detection rule, evaluated in priority order:

1. If `process.env.DASHBOARD_STARTER === "Electron"` → `"electron"`
2. Else if `process.env.DASHBOARD_STARTER === "Bridge"` → `"bridge"`
3. Else → `"standalone"`

The field SHALL NOT change between requests within a single server process lifetime — clients MAY cache the value at module scope and revalidate only on server restart.

#### Scenario: Health check response shape

- **WHEN** a `GET /api/health` request is received
- **THEN** the server SHALL respond with `{ ok: true, pid: <number>, uptime: <seconds>, launchSource: "electron" | "standalone" | "bridge" }`

#### Scenario: Electron launchSource

- **GIVEN** the server was spawned with `DASHBOARD_STARTER=Electron` in its environment
- **WHEN** a `GET /api/health` request is received
- **THEN** the `launchSource` field SHALL equal `"electron"`

#### Scenario: Bridge launchSource

- **GIVEN** the server was spawned with `DASHBOARD_STARTER=Bridge` in its environment
- **WHEN** a `GET /api/health` request is received
- **THEN** the `launchSource` field SHALL equal `"bridge"`

#### Scenario: Standalone launchSource default

- **GIVEN** the server was started from the CLI (`pi-dashboard start`) with no `DASHBOARD_STARTER` env var (or any value other than `"Electron"` / `"Bridge"`)
- **WHEN** a `GET /api/health` request is received
- **THEN** the `launchSource` field SHALL equal `"standalone"`

#### Scenario: Health check from localhost

- **WHEN** a `GET /api/health` request is received from any origin
- **THEN** the server SHALL respond successfully (no localhost guard on health endpoint)
