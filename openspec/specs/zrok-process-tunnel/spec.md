# zrok-process-tunnel Specification

## Purpose
Spawn the zrok share subprocess, parse its public URL, own the PID file, and scavenge orphaned zrok processes.
## Requirements
### Requirement: Subprocess tunnel management
The tunnel module SHALL manage the zrok share process lifecycle including spawning,
monitoring, and termination. The subprocess SHALL be spawned with the resolved binary
(`zrok2` preferred, `zrok` fallback) and, in flags-first order, `share public --headless
[-n public:{name}] localhost:{port}`. The `-n public:{name}` selector is present only when a
reserved name is configured.

#### Scenario: Spawn tunnel subprocess
- **WHEN** `createTunnel(port)` is called and zrok is enrolled and a binary is available
- **THEN** the module SHALL spawn `zrok2 share public --headless localhost:{port}` (inserting `-n public:{name}` before the target when a reserved name is set) and parse the public host from output

#### Scenario: URL parsing from stdout
- **WHEN** the zrok subprocess outputs its share URL to stdout
- **THEN** the module SHALL extract the URL and resolve the createTunnel promise with it

#### Scenario: URL parsing from bare host output
- **WHEN** the zrok v2 subprocess outputs a bare share host (no scheme) such as `abc.shares.zrok.io`
- **THEN** the module SHALL normalize it to `https://abc.shares.zrok.io` and resolve the createTunnel promise with the normalized URL

#### Scenario: Subprocess exits unexpectedly
- **WHEN** the zrok subprocess exits after successfully starting
- **THEN** the module SHALL set tunnel status to inactive and log the exit code

#### Scenario: Subprocess spawn timeout
- **WHEN** the zrok subprocess does not output a URL within a reasonable timeout (30 seconds)
- **THEN** the module SHALL kill the process, log a warning, and return null

#### Scenario: Orphan scavenge matches the zrok2 process name
- **WHEN** an orphaned share process from a prior run appears in the process list as `<abs>/zrok2 share public --headless localhost:{port}` (v2 binary name, flags-first)
- **THEN** the process marker SHALL match it (the marker recognizes both `zrok share` and `zrok2 share`) so the orphan is scavenged; an unrelated process merely containing `localhost:{port}` SHALL NOT be matched

### Requirement: PID file management
The tunnel module SHALL persist the zrok subprocess PID to `~/.pi/dashboard/zrok.pid` for stale process detection across server restarts.

#### Scenario: PID file written on tunnel creation
- **WHEN** the zrok subprocess starts successfully
- **THEN** the module SHALL write the process PID to `~/.pi/dashboard/zrok.pid`

#### Scenario: PID file removed on clean shutdown
- **WHEN** the tunnel is destroyed via `deleteTunnel()`
- **THEN** the module SHALL remove the PID file

#### Scenario: PID file removed on subprocess crash
- **WHEN** the zrok subprocess exits unexpectedly
- **THEN** the module SHALL remove the PID file

