# boot-parent-liveness — delta

## ADDED Requirements

### Requirement: An ephemeral server exits when its boot parent dies

A server started in ephemeral mode SHALL terminate once its boot parent is
determined dead. Ephemeral mode SHALL be explicit opt-in via a flag; it SHALL
NOT be enabled by an environment variable, nor inferred from the home
directory, the bind address, or the port. A server not in ephemeral mode SHALL
be unaffected, regardless of its boot parent's state. The liveness check driving
the exit SHALL evaluate on a bounded cadence so exit latency after parent death
has a stated upper bound. Termination SHALL go through the server's normal
graceful-stop path (draining spawned sessions and recording an exit intent), not
a raw process exit, and that exit intent SHALL suppress crash recovery.

For the kill decision, "dead" SHALL mean the boot parent PID could not be
signalled because it does not exist (`ESRCH`, or the Windows Tier-2
signalled-exit). A signal failure that is NOT proof of absence — notably
`EPERM` (parent alive but owned by another user / hardened) — SHALL be treated
as ALIVE, so the server never exits while its parent lives. Where the
reuse-immune Tier-2 handle exists (Windows), it SHALL be authoritative over the
Tier-1 signal-0 probe.

#### Scenario: Ephemeral server terminates after its parent exits
- **GIVEN** a server started in ephemeral mode
- **WHEN** its boot parent exits
- **AND** the next bounded liveness evaluation reports the boot parent absent (`ESRCH`)
- **THEN** the server SHALL shut down
- **AND** the shutdown reason SHALL name the dead boot parent

#### Scenario: Standalone server with a dead boot parent keeps running
- **GIVEN** a server NOT started in ephemeral mode
- **AND** `/api/health` reports `bootParentAlive: false`
- **THEN** the server SHALL keep running
- **AND** SHALL NOT shut down on that basis

#### Scenario: Ephemeral mode is not inferred
- **GIVEN** a server whose `HOME` is a temporary directory and which is bound to loopback
- **AND** ephemeral mode was not requested explicitly
- **THEN** the server SHALL NOT be treated as ephemeral

#### Scenario: A permission error is not treated as parent death
- **GIVEN** an ephemeral server whose boot-parent liveness probe fails with `EPERM`
- **THEN** the boot parent SHALL be treated as alive
- **AND** the server SHALL keep running
- **AND** SHALL NOT shut down on that basis

#### Scenario: POSIX PID reuse defers the exit rather than causing a false one
- **GIVEN** an ephemeral server on POSIX whose boot parent has exited
- **AND** the boot parent's PID has been recycled by another live process
- **AND** only the Tier-1 signal-0 probe is available
- **THEN** the Tier-1 probe SHALL read the parent as alive
- **AND** the server SHALL keep running

#### Scenario: Windows PID reuse resolves via the reuse-immune tier
- **GIVEN** an ephemeral server on Windows whose boot parent has exited
- **AND** the boot parent's PID has been recycled by another live process
- **WHEN** the reuse-immune Tier-2 handle reports the original parent exited
- **THEN** the Tier-2 verdict SHALL be authoritative
- **AND** the server SHALL shut down

#### Scenario: Ephemeral mode is not enabled by an environment variable
- **GIVEN** `PI_DASHBOARD_EPHEMERAL` is set in the environment
- **AND** the ephemeral flag was not passed explicitly
- **THEN** the server SHALL NOT be treated as ephemeral

#### Scenario: Ephemeral state is visible in health
- **WHEN** `/api/health` is requested on an ephemeral server
- **THEN** the response SHALL indicate that the server is ephemeral
