## MODIFIED Requirements

### Requirement: Per-session UDS socket / Windows named pipe
On Unix (macOS, Linux), the keeper SHALL listen on
`<base>/.pi/dashboard/sessions/<sessionId>.rpc.sock` (Unix domain socket), where
`<base>` is the `PI_DASHBOARD_HOME` environment variable when it is set and
non-empty, and `os.homedir()` otherwise (the default — unchanged). On Windows,
the keeper SHALL listen on `\\.\pipe\pi-rpc-<sessionId>` (named pipe). The socket
/ pipe path SHALL be derived deterministically from the base and the sessionId so
the dashboard server can locate it without consulting any registry. The dashboard
server SHALL derive the same base for both spawning keepers and the startup
socket-scan reconnect, and SHALL forward `PI_DASHBOARD_HOME` into the keeper
subprocess environment so the server and the keeper agree on the directory.

The keeper SHALL also write its own PID to a sidecar file at `<sockPath>.pid`
(Unix) or `<base>/.pi/dashboard/sessions/pi-rpc-<sessionId>.pid` (Windows) so the
dashboard server's startup orphan-cleanup pass can detect dead-keeper-with-stale-socket
and remove the socket.

#### Scenario: Unix socket path derivation (default base)
- **WHEN** keeper for session `019e0dac-d7a9-745e-b1ac-4306aa7594e2` starts on macOS or Linux with `PI_DASHBOARD_HOME` unset
- **THEN** the keeper SHALL listen on `<homedir>/.pi/dashboard/sessions/019e0dac-d7a9-745e-b1ac-4306aa7594e2.rpc.sock`
- **AND** the keeper SHALL write its PID to `<sockPath>.pid`

#### Scenario: Unix socket path derivation (PI_DASHBOARD_HOME override)
- **WHEN** keeper for session `019e0dac-d7a9-745e-b1ac-4306aa7594e2` starts on macOS or Linux and `PI_DASHBOARD_HOME` is `/home/u/.ibdev`
- **THEN** the keeper SHALL listen on `/home/u/.ibdev/.pi/dashboard/sessions/019e0dac-d7a9-745e-b1ac-4306aa7594e2.rpc.sock`
- **AND** the dashboard server's startup reconnect scan SHALL scan `/home/u/.ibdev/.pi/dashboard/sessions`

#### Scenario: Windows named-pipe path derivation
- **WHEN** keeper for session `019e0dac-d7a9-745e-b1ac-4306aa7594e2` starts on Windows
- **THEN** the keeper SHALL listen on `\\.\pipe\pi-rpc-019e0dac-d7a9-745e-b1ac-4306aa7594e2`
- **AND** the keeper SHALL write its PID to `<base>\.pi\dashboard\sessions\pi-rpc-019e0dac-d7a9-745e-b1ac-4306aa7594e2.pid`
