# bridge-auto-start-lifecycle Specification (delta)

## ADDED Requirements

### Requirement: Auto-start resolves ports with environment precedence

The bridge's auto-start path SHALL resolve the dashboard HTTP port and the pi
gateway port in this precedence order:

1. `PI_DASHBOARD_PORT` / `DASHBOARD_PORT` (HTTP) and the gateway equivalent
   (`PI_GATEWAY_PORT`), when set to a finite positive number.
2. `~/.pi/dashboard/config.json` `port` / `piPort`, when present.
3. The `DEFAULT_CONFIG` values (`8000` / `9999`).

This SHALL be a single shared resolver used by BOTH the auto-start path and the
slash-command path, so the two cannot diverge. The dashboard server exports
these variables into every session it spawns, so a session inherits the port of
the server that owns it — which `config.json` cannot express when the server was
started with `--port` / `--pi-port`.

#### Scenario: Non-default port from the environment wins over the config default
- **GIVEN** the dashboard runs with `--port 18697 --pi-port 19697`
- **AND** `config.json` carries no `port` and no `piPort`
- **AND** the session's environment carries `DASHBOARD_PORT=18697` and `PI_GATEWAY_PORT=19697`
- **WHEN** the bridge resolves its ports for auto-start
- **THEN** it SHALL resolve `18697` / `19697`
- **AND** its health check SHALL find the running dashboard
- **AND** it SHALL NOT launch a second dashboard

#### Scenario: Config value wins when the environment is absent
- **GIVEN** no `PI_DASHBOARD_PORT` / `DASHBOARD_PORT` in the environment
- **AND** `config.json` carries `port: 8001`
- **WHEN** the bridge resolves its ports
- **THEN** it SHALL resolve `8001`

#### Scenario: Defaults apply when neither source supplies a port
- **GIVEN** no port in the environment and none in `config.json`
- **WHEN** the bridge resolves its ports
- **THEN** it SHALL resolve `8000` / `9999`

#### Scenario: A non-numeric environment value does not shadow the config
- **GIVEN** `DASHBOARD_PORT` is set to `""`, `"abc"`, or `"0"`
- **AND** `config.json` carries `port: 8001`
- **WHEN** the bridge resolves its ports
- **THEN** it SHALL ignore the unusable environment value
- **AND** SHALL resolve `8001`

### Requirement: A spawned session never starts a competing dashboard

A pi session spawned BY a dashboard server SHALL join that server. It SHALL NOT
probe-and-launch a second dashboard, because the parent's identity is already
known to it.

Rationale: two dashboards in one host answer `/api/health` on different ports
while owning different gateways. The browser and the session then attach to
different servers, and every prompt appears to be accepted while no response
ever arrives — a failure that names neither cause nor culprit.

#### Scenario: Session spawned by a known parent joins it
- **GIVEN** a session whose environment identifies the dashboard that spawned it
- **WHEN** the bridge starts
- **THEN** it SHALL connect to that dashboard's gateway
- **AND** SHALL NOT call the auto-start launch step

#### Scenario: A second dashboard on a different port is reported, not silent
- **GIVEN** a dashboard is already serving on the resolved port
- **WHEN** anything would start another dashboard on a DIFFERENT port in the same host
- **THEN** the bridge SHALL emit a warning naming both ports
- **AND** the condition SHALL be greppable in the server log

#### Scenario: Two servers in one container is detectable end to end
- **GIVEN** the e2e harness container
- **WHEN** its startup completes and a spec spawns a session
- **THEN** exactly one dashboard SHALL answer `/api/health` inside the container
- **AND** `tests/e2e/faux-text.spec.ts` SHALL pass, as the canary that any other
  E2E verdict depends on
