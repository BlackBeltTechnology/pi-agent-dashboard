# server-launch — delta

## ADDED Requirements

### Requirement: A server that never reaches serving state does not survive

The dashboard server opens its pi-gateway listener early in startup, before the dashboard HTTP listener is attempted. A process that has opened the gateway listener but never reaches serving state SHALL NOT remain resident, because while it holds the gateway port it captures bridge registrations away from the dashboard that is actually serving.

This SHALL hold for a startup that **fails** and for a startup that **never completes**. Startup SHALL be bounded: if the server has not reached serving state within a startup deadline, it SHALL tear down its listeners and exit non-zero, rather than remaining resident with a live event loop.

When a startup step fails after a listener has been opened, the server SHALL tear down every listener it has already opened before the failure propagates. Teardown alone SHALL NOT be relied on to end the process: any timer or handle that would keep the event loop alive SHALL also be released, or the process SHALL exit explicitly.

Teardown SHALL NOT swallow, replace, or obscure the error that triggered it; the original startup failure SHALL still propagate and still cause a non-zero exit.

#### Scenario: Dashboard listener fails after the gateway is up

- **WHEN** the pi-gateway listener has bound successfully
- **AND** a later startup step fails
- **THEN** the gateway listener SHALL be torn down
- **AND** no process SHALL remain alive holding the gateway port
- **AND** the process SHALL exit non-zero

#### Scenario: Startup hangs after the gateway is up

- **WHEN** the pi-gateway listener has bound successfully
- **AND** a later startup step neither resolves nor rejects
- **THEN** the startup deadline SHALL elapse
- **AND** the process SHALL tear down its listeners and exit non-zero
- **AND** it SHALL NOT remain resident holding the gateway port

#### Scenario: Gateway timers do not keep a failed process alive

- **WHEN** startup fails after the gateway's ping timer has been installed
- **THEN** the process SHALL NOT remain alive on that timer alone
- **AND** the gateway port SHALL be released

#### Scenario: A resident server always holds its own dashboard port

- **WHEN** a server process is resident and holding the gateway port
- **THEN** it SHALL also be serving its configured dashboard port
- **AND** a process holding the gateway port while never having bound its dashboard port SHALL NOT exist

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
