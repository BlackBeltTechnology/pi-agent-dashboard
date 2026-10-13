## MODIFIED Requirements

### Requirement: Auto-start resolves ports with environment precedence

The bridge's auto-start path SHALL resolve the dashboard HTTP port and the pi
gateway port through ONE shared resolver, consumed by both the auto-start
path and the slash-command path, in this precedence order:

1. Environment — HTTP: `PI_DASHBOARD_PORT`, then `DASHBOARD_PORT`; gateway:
   `PI_DASHBOARD_PI_PORT`, then `PI_GATEWAY_PORT`. The first variable of a
   role set to a usable value wins; later variables of that role are ignored.
2. `~/.pi/dashboard/config.json` `port` / `piPort`, when present and usable.
3. The shared defaults (`DEFAULT_DASHBOARD_PORT` 8000 /
   `DEFAULT_GATEWAY_PORT` 9999).

A value is usable when `Number(v)` is an integer in the range 1–65535. The
same rule applies to config values. It is pinned here so the two paths cannot
drift. The resolver SHALL be a separate export in `packages/shared/src/config.ts`;
`loadConfig()` SHALL NOT adopt env precedence. The server CLI's own bind
resolution (`buildConfig` in `packages/server/src/cli.ts`) MUST keep its current
behaviour, which differs from this resolver: it reads `--port` / `--pi-port`,
then `PI_DASHBOARD_PORT` / `PI_DASHBOARD_PI_PORT`, then config. It does NOT read
`DASHBOARD_PORT` or `PI_GATEWAY_PORT`. A bridge that resolves a port from
`DASHBOARD_PORT` and launches the server SHALL pass that port explicitly.

#### Scenario: Non-default port from the environment wins over the config default
- **GIVEN** the dashboard runs with `--port 18697 --pi-port 19697`
- **AND** `config.json` carries no `port` and no `piPort`
- **AND** the session's environment carries `DASHBOARD_PORT=18697` and a
  gateway env (`PI_DASHBOARD_PI_PORT` or `PI_GATEWAY_PORT`)=`19697`
- **WHEN** the bridge resolves its ports for auto-start
- **THEN** it SHALL resolve `18697` / `19697`
- **AND** its health check SHALL find the running dashboard
- **AND** it SHALL NOT launch a second dashboard

#### Scenario: Config value wins when the environment is absent
- **GIVEN** no port env of either role in the environment
- **AND** `config.json` carries `port: 8001`
- **WHEN** the bridge resolves its ports
- **THEN** it SHALL resolve `8001`

#### Scenario: Defaults apply when neither source supplies a port
- **GIVEN** no port in the environment and none in `config.json`
- **WHEN** the bridge resolves its ports
- **THEN** it SHALL resolve `8000` / `9999`

#### Scenario: A non-numeric environment value does not shadow the config
- **GIVEN** `DASHBOARD_PORT` is set to `""`, `"abc"`, or `"0"` (and
  `PI_DASHBOARD_PORT` is unset)
- **AND** `config.json` carries `port: 8001`
- **WHEN** the bridge resolves its ports
- **THEN** it SHALL ignore the unusable environment value
- **AND** SHALL resolve `8001`

#### Scenario: Fractional or out-of-range environment values are unusable
- **GIVEN** `DASHBOARD_PORT` is set to `"8000.5"`, `"-1"`, or `"70000"` (and
  `PI_DASHBOARD_PORT` is unset)
- **AND** `config.json` carries `port: 8001`
- **WHEN** the bridge resolves its ports
- **THEN** it SHALL ignore the unusable environment value
- **AND** SHALL resolve `8001`

#### Scenario: First environment variable of a role wins
- **GIVEN** `PI_DASHBOARD_PORT=8001` and `DASHBOARD_PORT=8002` are both set
- **WHEN** the bridge resolves its ports
- **THEN** it SHALL resolve `8001` (`PI_DASHBOARD_PORT` precedes
  `DASHBOARD_PORT`), never `8002`
