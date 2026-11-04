## ADDED Requirements

### Requirement: Bridge auto-start resolves a qualifying server Node or refuses and explains

When the bridge's auto-start flow has decided to launch a server (no dashboard answered the
resolved port), it SHALL resolve the server's Node through the shared server-spawn runtime
resolution, inside the existing single-flight auto-start lock, and pass the result as the launch's
Node binary. Resolution SHALL NOT run when a dashboard already answers, so a normal session start
pays nothing for it.

When resolution succeeds, the durable auto-start log (`appendAutoStartLog`) SHALL gain one line
naming the selected Node path, its version and the ladder step that selected it, before spawning.

When resolution is unresolved, the bridge SHALL NOT spawn a server. It SHALL re-probe the
resolved port first; if a dashboard now answers (started concurrently), it SHALL connect and SHALL
NOT notify. Otherwise it SHALL record the refusal in
the durable auto-start log (see `bridge-auto-start-lifecycle`) and call `ui.notify` at most once
per pi session with a warning that names the required Node range, pi's own Node version, the
remediation (install Node 26 via a version manager, or install the desktop app) and the absolute
path to `~/.pi/dashboard/server.log`. A pi session whose bridge cannot auto-start the server SHALL
continue to run normally and SHALL connect when a server later becomes reachable. When the
single-flight lock is unavailable (the existing degraded path proceeds without it), resolution
runs without the lock exactly as the launch does today.

#### Scenario: Notice on pi running Node 22 with no Node 26 anywhere

- **WHEN** pi runs on `v22.19.0` and no candidate passes the server gate
- **AND** no dashboard server answers the port probe
- **THEN** `ui.notify` SHALL be called with a warning containing `Node >=26.0.0 <27`, `v22.19.0`,
  a hint to install Node 26 or the desktop app, and the absolute `server.log` path
- **AND** no server process SHALL be spawned

#### Scenario: Notice shown once per session

- **WHEN** the auto-start path runs repeatedly in one pi session and resolution stays unresolved
- **THEN** `ui.notify` SHALL be called at most once for that session

#### Scenario: pi session keeps working without a server

- **WHEN** auto-start is refused for lack of a qualifying Node
- **THEN** the pi session SHALL remain usable
- **AND** the bridge SHALL connect when a dashboard server later becomes reachable (e.g. started
  from the desktop app)

#### Scenario: Selected runtime is logged and used

- **WHEN** resolution selects `/Users/x/.nvm/versions/node/v26.0.0/bin/node` at the
  version-manager step
- **THEN** the durable auto-start log SHALL gain one line naming that path, `v26.0.0` and the
  version-manager step
- **AND** the server SHALL be spawned with that binary, not with pi's `process.execPath`

#### Scenario: Resolution skipped when a server is reachable

- **WHEN** a pi session starts and the dashboard server already answers the port probe
- **THEN** server-spawn runtime resolution SHALL NOT run

#### Scenario: Server started during resolution suppresses the notice

- **WHEN** resolution returns unresolved
- **AND** a dashboard began answering on the resolved port while resolution ran
- **THEN** the bridge SHALL connect to it
- **AND** SHALL NOT call `ui.notify` with the refusal warning

#### Scenario: Concurrent sessions resolve once

- **WHEN** two pi sessions start at the same time with no server running
- **THEN** resolution and its log line SHALL happen only in the session holding the single-flight
  auto-start lock
