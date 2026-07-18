# zrok-tunnel Specification

## Purpose
Create zrok public tunnels (ephemeral + v2 reserved-name persistence) and manage the reserved-name lifecycle, binary detection, and status.
## Requirements
### Requirement: Zrok enrollment detection
The tunnel module SHALL detect whether zrok is enrolled on the current machine by checking for the existence and validity of `~/.zrok2/environment.json` (v2) or `~/.zrok/environment.json` (v1), preferring v2. If the file exists and contains valid JSON with `api_endpoint`, `ziti_identity`, and `zrok_token` fields, zrok is considered enrolled.

#### Scenario: Zrok is enrolled
- **WHEN** `~/.zrok2/environment.json` or `~/.zrok/environment.json` exists with valid `api_endpoint`, `ziti_identity`, and `zrok_token`
- **THEN** the module SHALL report zrok as enrolled and return the parsed config

#### Scenario: Zrok is not enrolled
- **WHEN** neither `~/.zrok2/environment.json` nor `~/.zrok/environment.json` exists
- **THEN** the module SHALL report zrok as not enrolled

#### Scenario: Zrok config is malformed
- **WHEN** the environment file exists but contains invalid JSON
- **THEN** the module SHALL report zrok as not enrolled and not throw

### Requirement: Public share creation
The tunnel module SHALL create a public proxy share by spawning the resolved zrok binary
(`zrok2` preferred, `zrok` fallback) as a child process. For an **ephemeral** share it SHALL
spawn `zrok2 share public --headless localhost:{port}`. For a **reserved/persistent** share
(`tunnel.zrok.persistent === true` with a `tunnel.zrok.reservedName`) it SHALL spawn, flags
first, `zrok2 share public --headless -n public:{name} localhost:{port}`. The module SHALL parse the
public host from process output — which under zrok v2 is a **bare hostname**
`{token-or-name}.shares.zrok.io` with no scheme — normalize it to an `https://` URL, and
store the child process reference for cleanup.

#### Scenario: Successful ephemeral share creation
- **WHEN** the `zrok share public` process starts and prints a bare host `abc.shares.zrok.io`
- **THEN** the module SHALL normalize it to `https://abc.shares.zrok.io`, return that URL, and store the process reference

#### Scenario: Successful reserved share creation
- **WHEN** a `tunnel.zrok.reservedName` `myname` is set and the process is spawned with `-n public:myname`
- **THEN** the module SHALL return the stable URL `https://myname.shares.zrok.io`

#### Scenario: Successful share creation
- **WHEN** the `zrok share public` process starts and prints a public URL (v2 bare host, or a v1 schemed URL) to stdout
- **THEN** the module SHALL return the public URL and store the process reference for cleanup

#### Scenario: v1 URL still parsed (back-compat)
- **WHEN** a v1 client prints `https://abc.share.zrok.io` (singular, schemed)
- **THEN** the module SHALL parse and return it unchanged

#### Scenario: Share creation fails
- **WHEN** the `zrok share public` process fails to start or exits with an error
- **THEN** the module SHALL log a warning and return null (server continues without tunnel)

#### Scenario: Subprocess crashes during operation
- **WHEN** the `zrok share public` process exits unexpectedly after an initial URL was obtained
- **THEN** the module SHALL log a warning and update tunnel status to inactive

### Requirement: Share cleanup
The tunnel module SHALL kill the `zrok share public` child process on server shutdown and remove the PID file.

#### Scenario: Clean shutdown
- **WHEN** the server stops and a zrok subprocess is running
- **THEN** the module SHALL kill the subprocess and remove the PID file

#### Scenario: Cleanup fails
- **WHEN** killing the subprocess fails
- **THEN** the module SHALL log a warning and continue shutdown

#### Scenario: No share to clean up
- **WHEN** the server stops but no zrok subprocess is running
- **THEN** the module SHALL skip cleanup without errors

### Requirement: Tunnel lifecycle integration
The server SHALL create the tunnel after `fastify.listen()` completes and delete it during `server.stop()`. The public URL SHALL be printed to the console.

#### Scenario: Server starts with zrok enrolled and tunnel enabled
- **WHEN** the server starts, zrok is enrolled, zrok binary is available, and `tunnel.enabled` is true
- **THEN** the server SHALL spawn the zrok subprocess and print `🌐 Tunnel: <url>`

#### Scenario: Server starts with zrok not enrolled
- **WHEN** the server starts but zrok is not enrolled
- **THEN** the server SHALL skip tunnel creation silently and start normally

#### Scenario: Server starts with tunnel disabled
- **WHEN** the server starts with `tunnel.enabled` set to false (via config or `--no-tunnel`)
- **THEN** the server SHALL skip tunnel creation

### Requirement: Tunnel URL availability for auth
The tunnel module SHALL expose the active tunnel URL so that the auth module can use it to construct OAuth redirect URIs. The `createTunnel()` function SHALL store the tunnel URL and provide a `getTunnelUrl()` function to retrieve it.

#### Scenario: Tunnel created — URL available
- **WHEN** `createTunnel()` succeeds and returns a URL
- **THEN** `getTunnelUrl()` SHALL return that URL

#### Scenario: No tunnel — URL is null
- **WHEN** no tunnel has been created (zrok not enrolled, disabled, or creation failed)
- **THEN** `getTunnelUrl()` SHALL return null

#### Scenario: Tunnel deleted — URL cleared
- **WHEN** `deleteTunnel()` is called
- **THEN** `getTunnelUrl()` SHALL return null

### Requirement: Zrok binary detection
The tunnel module SHALL detect whether a zrok binary is available on the system PATH by
resolving the first of `zrok2` (v2, tarball/Windows/Linux packages) then `zrok` (v1, or the
Homebrew v2 bottle) via the login-shell tool resolver. Detection SHALL succeed if either
name resolves.

#### Scenario: Only zrok2 present (tarball/Windows/Linux package install)
- **WHEN** `zrok2` resolves on PATH and `zrok` does not
- **THEN** the module SHALL report zrok as available and use `zrok2` for all invocations

#### Scenario: Only zrok present (Homebrew, or a v1 install)
- **WHEN** `zrok` resolves on PATH and `zrok2` does not
- **THEN** the module SHALL report zrok as available and use `zrok`

#### Scenario: Zrok binary is available
- **WHEN** either `zrok2` or `zrok` resolves on PATH
- **THEN** the module SHALL report zrok as available

#### Scenario: Zrok binary is not available
- **WHEN** neither name resolves on PATH
- **THEN** the module SHALL report zrok as unavailable

#### Scenario: Neither present
- **WHEN** neither `zrok2` nor `zrok` resolves
- **THEN** the module SHALL report zrok as unavailable

### Requirement: Stale process cleanup
The tunnel module SHALL write the zrok subprocess PID to `~/.pi/dashboard/zrok.pid` when creating a tunnel. On server start, the module SHALL check for a stale PID file and kill the associated process if it is still running and is a zrok process.

#### Scenario: Stale PID file exists with running zrok process
- **WHEN** the server starts and `~/.pi/dashboard/zrok.pid` exists with a PID that is still running
- **THEN** the module SHALL kill the stale process and remove the PID file

#### Scenario: Stale PID file exists but process is not running
- **WHEN** the server starts and `~/.pi/dashboard/zrok.pid` exists but the PID is not running
- **THEN** the module SHALL remove the stale PID file

#### Scenario: No stale PID file
- **WHEN** the server starts and no `~/.pi/dashboard/zrok.pid` exists
- **THEN** the module SHALL proceed without cleanup

### Requirement: Tunnel status endpoint
The server SHALL expose `GET /api/tunnel-status` returning the current tunnel state as a discriminated union on `status` with values `"active"`, `"inactive"`, or `"unavailable"`. When active, the response SHALL include `url` (string) and `serverOs` (string). When inactive or unavailable, only `serverOs` SHALL be present.

#### Scenario: Tunnel is active
- **WHEN** a zrok tunnel is running
- **THEN** the endpoint SHALL return `{ status: "active", url: "<public-url>", serverOs: "<os>" }`

#### Scenario: Tunnel is inactive but zrok is available
- **WHEN** no tunnel is running but zrok binary is installed
- **THEN** the endpoint SHALL return `{ status: "inactive", serverOs: "<os>" }`

#### Scenario: Zrok is not installed
- **WHEN** the zrok binary is not found on PATH
- **THEN** the endpoint SHALL return `{ status: "unavailable", serverOs: "<os>" }`

#### Scenario: Tunnel status after tunnel creation
- **WHEN** the server starts with zrok enrolled and tunnel enabled, and the tunnel is successfully created
- **THEN** subsequent calls to `GET /api/tunnel-status` SHALL return status `"active"` with the tunnel URL

### Requirement: Tunnel connect endpoint
The server SHALL expose `POST /api/tunnel-connect` to start the tunnel on demand. If the tunnel is already active, it SHALL return the existing URL. If zrok is unavailable, it SHALL return an error.

#### Scenario: Connect when inactive
- **WHEN** `POST /api/tunnel-connect` is called and zrok is available but no tunnel is running
- **THEN** the server SHALL call `createTunnel()` and return `{ ok: true, url: "<url>" }`

#### Scenario: Connect when already active
- **WHEN** `POST /api/tunnel-connect` is called and a tunnel is already running
- **THEN** the server SHALL return `{ ok: true, url: "<existing-url>" }` without creating a new tunnel

#### Scenario: Connect when zrok unavailable
- **WHEN** `POST /api/tunnel-connect` is called and zrok is not installed
- **THEN** the server SHALL return `{ ok: false, error: "zrok not installed" }`

### Requirement: Tunnel disconnect endpoint
The server SHALL expose `POST /api/tunnel-disconnect` to stop the active tunnel.

#### Scenario: Disconnect when active
- **WHEN** `POST /api/tunnel-disconnect` is called and a tunnel is running
- **THEN** the server SHALL call `deleteTunnel()` and return `{ ok: true }`

#### Scenario: Disconnect when not active
- **WHEN** `POST /api/tunnel-disconnect` is called and no tunnel is running
- **THEN** the server SHALL return `{ ok: true }` (idempotent)

### Requirement: Reserved-name lifecycle
The tunnel module SHALL manage zrok v2 reserved **names** (which replace v1 reserved
tokens). "A persistent tunnel is requested" means `tunnel.zrok.persistent === true`. When a
persistent tunnel is requested and no name is stored, the module SHALL generate a DNS-safe name
(`pi-dash-<random>`), reserve it with `zrok2 create name -n public <name>` (treating an already-exists-for-this-account result as success), and persist it as
`tunnel.zrok.reservedName`. A reserved name SHALL **survive** disconnect and server restart
(that is the purpose of reservation); the module SHALL release the name with
`zrok2 delete name <name>` ONLY on an explicit user "forget reserved URL" action, never on a
normal `deleteTunnel`/disconnect. The v1 verbs `reserve`/`share reserved`/`release` SHALL NOT
be used.

#### Scenario: Reserve a new name
- **WHEN** a persistent tunnel is requested and no `reservedName` is stored
- **THEN** the module SHALL run `zrok2 create name -n public <generated>`, persist the name, and serve it → `https://<generated>.shares.zrok.io`

#### Scenario: Reuse an existing name across restart
- **WHEN** a `reservedName` is already stored (e.g. after a server restart)
- **THEN** the module SHALL skip generation and serve the stored name (stable URL); if `create name` reports it already exists for this account, the module SHALL proceed to serve without error

#### Scenario: Name taken by another account
- **WHEN** `create name` fails because the name is owned by a different account
- **THEN** the module SHALL log a warning and fall back to an ephemeral share (NOT silently rotate a persisted name)

#### Scenario: Disconnect preserves the reserved name
- **WHEN** a reserved tunnel is disconnected via `deleteTunnel`
- **THEN** the module SHALL kill the share process but SHALL NOT delete the name; a later reconnect serves the same URL

#### Scenario: Explicit forget releases the name
- **WHEN** the user explicitly forgets the reserved URL via `POST /api/tunnel-disconnect` with body `{ forget: true }`
- **THEN** the module SHALL run `zrok2 delete name <name>`, clear `tunnel.zrok.reservedName`, and set `tunnel.zrok.persistent` to false

### Requirement: Tunnel disconnect preserves reserved names by default
The `POST /api/tunnel-disconnect` endpoint SHALL accept an optional `{ forget?: boolean }` body.
Without `forget: true` it SHALL stop the share process but PRESERVE any reserved name (so a
later reconnect yields the same URL). With `forget: true` it SHALL additionally release the
reserved name and clear the persisted name.

#### Scenario: Plain disconnect preserves the name
- **WHEN** `POST /api/tunnel-disconnect` is called with no body (or `{ forget: false }`) while a reserved tunnel is active
- **THEN** the server SHALL stop the tunnel, keep `tunnel.zrok.reservedName`, and return `{ ok: true }`

#### Scenario: Forget disconnect releases the name
- **WHEN** `POST /api/tunnel-disconnect` is called with `{ forget: true }`
- **THEN** the server SHALL stop the tunnel, run `zrok2 delete name <name>`, clear the persisted name, and return `{ ok: true }`

#### Scenario: Transient serve failure does not recycle the name
- **WHEN** `share public` for a reserved name fails transiently and the core retries
- **THEN** the module SHALL retry the SAME name and SHALL NOT `delete name` + regenerate (URL stays stable)

