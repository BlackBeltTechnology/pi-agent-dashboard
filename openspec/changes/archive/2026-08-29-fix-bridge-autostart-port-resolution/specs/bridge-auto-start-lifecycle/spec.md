# bridge-auto-start-lifecycle Specification (delta)

## ADDED Requirements

### Requirement: Auto-start resolves ports with environment precedence

The bridge's auto-start path SHALL resolve the dashboard HTTP port and the pi
gateway port through ONE shared resolver, consumed by both the auto-start
path and the slash-command path, in this precedence order:

1. Environment — HTTP: `PI_DASHBOARD_PORT`, then `DASHBOARD_PORT`; gateway:
   `PI_DASHBOARD_PI_PORT`, then `PI_GATEWAY_PORT`. The first variable of a
   role set to a usable value wins; later variables of that role are ignored.
2. `~/.pi/dashboard/config.json` `port` / `piPort`, when present.
3. The shared defaults (`DEFAULT_DASHBOARD_PORT` 8000 /
   `DEFAULT_GATEWAY_PORT` 9999).

A value is usable when `Number(v)` is finite and > 0 — the parsing of the
existing slash-command resolver, pinned here so the two paths cannot drift.
The resolver SHALL be a separate export in `packages/shared/src/config.ts`;
`loadConfig()` SHALL NOT adopt env precedence — the server's own bind
resolution (`buildConfig` in `packages/server/src/cli.ts`) already reads the
env and MUST keep its current behaviour.

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

#### Scenario: First environment variable of a role wins
- **GIVEN** `PI_DASHBOARD_PORT=8001` and `DASHBOARD_PORT=8002` are both set
- **WHEN** the bridge resolves its ports
- **THEN** it SHALL resolve `8001` (`PI_DASHBOARD_PORT` precedes
  `DASHBOARD_PORT`), never `8002`

### Requirement: A session with a pinned endpoint never starts a competing dashboard

A session whose environment carries `PI_DASHBOARD_URL` or
`PI_DASHBOARD_SOCKET` — the endpoint pins the dashboard server itself
injects into sessions it spawns (`process-manager.ts`) — SHALL NOT execute
the auto-start launch step. Discovery and the health check still run, so the
session attaches to (or rediscovers) its pinned parent.

Accepted trade-off, documented: when the pinned parent later dies, the
session retries the pinned endpoint and never relaunches a replacement;
recovery is restarting the dashboard (or the session). This is deliberate —
a pinned session must never become a competitor-launching session.

#### Scenario: Session spawned by a known parent joins it
- **GIVEN** a session whose environment carries `PI_DASHBOARD_URL` (or
  `PI_DASHBOARD_SOCKET`)
- **WHEN** the bridge's auto-start runs
- **THEN** discovery and the health check still run
- **AND** the launch step SHALL NOT be invoked

#### Scenario: Pinned session whose parent has died does not relaunch
- **GIVEN** a pinned session whose parent gateway no longer answers
- **WHEN** the bridge's auto-start runs
- **THEN** the launch step is still not invoked
- **AND** the skip is recorded in the durable auto-start log, naming the
  pinned endpoint

### Requirement: Auto-start skips and refusals are loud and greppable

Whenever the auto-start path does NOT launch — because a dashboard already
answers on the resolved port, the endpoint is pinned, the worktree refusal
fires, or the resolved port is occupied by another service — the durable
auto-start log (`appendAutoStartLog`) SHALL gain a line naming the ports
involved. When discovery finds a dashboard at a port different from the
resolved port while the resolved port answers nothing, the bridge SHALL emit
a warning naming both ports. Every such line SHALL be greppable in the
server log.

#### Scenario: Attaching to an already-serving dashboard logs the port
- **GIVEN** a dashboard already serving on the resolved port
- **WHEN** auto-start attaches without launching
- **THEN** the auto-start log names the port it attached to
- **AND** records that no launch happened

#### Scenario: Discovery elsewhere while the resolved port is silent warns both ports
- **GIVEN** discovery finds a dashboard serving at port 18697
- **AND** the resolved port 8000 answers nothing
- **WHEN** auto-start decides what to do
- **THEN** a warning names both 8000 and 18697
- **AND** no launch happens

#### Scenario: Two servers in one container is detectable end to end
- **GIVEN** the e2e harness container
- **WHEN** its startup completes and a spec spawns a session
- **THEN** exactly one dashboard SHALL answer `/api/health` inside the
  container
- **AND** `tests/e2e/faux-text.spec.ts` SHALL pass, as the canary any other
  E2E verdict depends on
