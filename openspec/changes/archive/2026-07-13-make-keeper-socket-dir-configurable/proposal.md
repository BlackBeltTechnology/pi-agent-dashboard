## Why

The per-session RPC keeper binds a Unix-domain socket at
`<base>/.pi/dashboard/sessions/<sessionId>.rpc.sock`, where `<base>` is the home
directory (`os.homedir()`). When the home directory is deep, the socket path
exceeds the platform `sockaddr_un.sun_path` limit (108 bytes on Linux, 104 on
macOS) and `bind()` fails with a cryptic `EINVAL`, crashing the keeper inside its
crash window and failing every session spawn. The base directory is not
overridable, so there is no way to relocate the sockets to a shorter path.

## What Changes

- Honor a single environment variable **`PI_DASHBOARD_HOME`** as the base
  directory for the keeper's session meta descriptors (socket, `.pid` sidecar,
  keeper log): they live under `<PI_DASHBOARD_HOME>/.pi/dashboard/sessions`.
  When unset or empty, the base is `os.homedir()` — **unchanged** from today
  (production default `~/.pi/dashboard/sessions`).
- Apply it in both places that derive the directory so they agree: the server's
  `defaultSessionsDir()` (used for spawn and the startup reconnect scan) and the
  keeper child `keeper.cjs` (which computes its own socket path). The server
  forwards `PI_DASHBOARD_HOME` into the keeper subprocess environment.

## Capabilities

### Modified Capabilities
- `rpc-keeper-sidecar`: the keeper session/socket directory base is overridable
  via `PI_DASHBOARD_HOME` (default `os.homedir()`, unchanged).

## Impact

- `packages/server/src/rpc-keeper/keeper-manager.ts` — `defaultSessionsDir()`
  honors `PI_DASHBOARD_HOME`; `spawnKeeperFor` forwards it to the keeper env.
- `packages/server/src/rpc-keeper/keeper.cjs` — `SESSIONS_DIR` honors `PI_DASHBOARD_HOME`.
- **Backward compatible**: with the var unset, the resolved directory is
  byte-identical to today (`os.homedir()/.pi/dashboard/sessions`); existing
  keepers, sockets, and reconnect behavior are unchanged.
- **Windows** named pipes are unaffected (not filesystem-length-bound); only the
  PID-sidecar directory follows the base.
