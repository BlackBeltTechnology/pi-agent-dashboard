## MODIFIED Requirements

### Requirement: Process-liveness classification SHALL NOT overclaim

A SIGKILL, an out-of-memory kill, a process crash and a severed network link are
identical from the server's position: silence. Classification SHALL be limited to
what a probe of the session's recorded `pid` can establish, and SHALL NOT name a
specific signal or kill mechanism.

`pid` is self-reported by the bridge and is optional, and operating systems
recycle pids. The classification SHALL therefore admit an `unknown` outcome when
no pid is recorded, and its documentation SHALL state the pid-recycling caveat
rather than presenting the probe as authoritative.

A pid whose resolved target is not `host` belongs to another PID namespace, or
to one this host cannot verify, where a local probe is meaningless. That covers
remote origin, WSL, a container, and `unknown` (`force-kill-handler` *A recorded
pid is used only in its resolved pid target*). Such a pid SHALL yield `unknown`
without probing, rather than a false `process_gone` about a process this host
cannot see.

#### Scenario: No recorded pid yields unknown

- **GIVEN** a session ending with no `pid` recorded
- **WHEN** the server classifies the death
- **THEN** the reason SHALL be `unknown`
- **AND** the server SHALL NOT claim the process is gone

#### Scenario: A remote-origin pid is never probed locally

- **GIVEN** a session ending whose `originDeviceId` identifies another host
- **WHEN** the server classifies the death
- **THEN** the reason SHALL be `unknown`
- **AND** no local process probe SHALL be run against the foreign pid

#### Scenario: The probe never names a signal

- **GIVEN** any outcome of the pid probe
- **WHEN** the reason is presented in the UI or persisted
- **THEN** it SHALL NOT assert SIGKILL, OOM, or any specific termination cause

#### Scenario: A WSL pid on a Windows server is never probed locally
- **GIVEN** a session ending whose pid target is WSL on a Windows server
- **WHEN** the server classifies the death
- **THEN** the reason SHALL be `unknown` and no Windows process probe SHALL run
