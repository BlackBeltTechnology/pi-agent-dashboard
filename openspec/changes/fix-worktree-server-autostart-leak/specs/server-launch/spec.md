# server-launch — delta

## ADDED Requirements

### Requirement: A failed startup leaves no port held

The dashboard server opens its pi-gateway listener early in startup, before the dashboard HTTP listener is attempted. When any startup step fails after a listener has been opened, the server SHALL tear down every listener it has already opened before the failure propagates, so the process cannot remain resident holding a port it is not serving.

Teardown SHALL NOT swallow, replace, or obscure the error that triggered it; the original startup failure SHALL still propagate and still cause a non-zero exit.

#### Scenario: Dashboard listener fails after the gateway is up

- **WHEN** the pi-gateway listener has bound successfully
- **AND** a later startup step fails
- **THEN** the gateway listener SHALL be torn down
- **AND** no process SHALL remain alive holding the gateway port
- **AND** the process SHALL exit non-zero

#### Scenario: Original error survives teardown

- **WHEN** a startup failure triggers listener teardown
- **THEN** the error reported to the operator SHALL be the original startup failure
- **AND** it SHALL NOT be replaced by an error raised during teardown

#### Scenario: Successful startup is unaffected

- **WHEN** every startup step succeeds
- **THEN** all listeners SHALL remain open and serving
- **AND** the teardown path SHALL NOT run

### Requirement: A port conflict is distinguishable to the spawning parent

When a spawned server exits because a port it needs is already in use, the spawning parent SHALL be able to distinguish that exit from a generic early exit, and SHALL identify the failure to the user as a port conflict.

The startup recovery server already exits with its own distinct status on `EADDRINUSE`. The parent SHALL treat every port-conflict status as a port conflict, not only the status produced by the normal startup path.

#### Scenario: Normal-path port conflict

- **WHEN** a spawned server exits because its port was already in use during normal startup
- **THEN** the parent SHALL classify the exit as a port conflict
- **AND** the failure surfaced to the user SHALL identify it as a port conflict

#### Scenario: Recovery-path port conflict

- **WHEN** a spawned server exits from the startup recovery path because the port was already in use
- **THEN** the parent SHALL also classify that exit as a port conflict
- **AND** it SHALL NOT be reported as a generic early exit

#### Scenario: Generic early exit stays generic

- **WHEN** a spawned server exits early for a reason unrelated to port availability
- **THEN** the parent SHALL NOT classify the exit as a port conflict
