## ADDED Requirements

### Requirement: Shutdown REST endpoint
The dashboard server SHALL expose a `POST /api/shutdown` endpoint that gracefully stops the server process. When called, it SHALL invoke the server's `stop()` method and then exit the process with code 0.

#### Scenario: Shutdown request
- **WHEN** a `POST /api/shutdown` request is received
- **THEN** the server SHALL respond with `{ ok: true }`, call `server.stop()`, and exit with `process.exit(0)`

#### Scenario: Shutdown during active sessions
- **WHEN** `POST /api/shutdown` is received while pi sessions are connected
- **THEN** the server SHALL still shut down gracefully — connected extensions will reconnect when a new server starts

### Requirement: Health endpoint
The dashboard server SHALL expose a `GET /api/health` endpoint that returns server liveness information including process ID and uptime.

#### Scenario: Health check response
- **WHEN** a `GET /api/health` request is received
- **THEN** the server SHALL respond with `{ ok: true, pid: <number>, uptime: <seconds> }`

#### Scenario: Health check from localhost
- **WHEN** a `GET /api/health` request is received from any origin
- **THEN** the server SHALL respond successfully (no localhost guard on health endpoint)

### Requirement: Conditional auth plugin registration
The server SHALL register the auth module as a Fastify plugin only when `auth` is present in the loaded config and has at least one provider configured. When auth is not configured, no auth hooks or routes SHALL be registered.

#### Scenario: Auth configured with providers
- **WHEN** the server starts and config contains `auth` with at least one provider
- **THEN** the server SHALL register the auth plugin, adding auth routes and the `onRequest` hook

#### Scenario: Auth not configured
- **WHEN** the server starts and config has no `auth` key
- **THEN** the server SHALL not register any auth plugin, hooks, or routes

### Requirement: WebSocket upgrade auth check
The server's `upgrade` handler SHALL validate authentication for non-localhost WebSocket upgrade requests when auth is enabled. The check SHALL parse the `cookie` header from the upgrade request and validate the JWT.

#### Scenario: External WebSocket upgrade with valid cookie
- **WHEN** a non-localhost WebSocket upgrade request includes a valid `pi_dash_token` cookie
- **THEN** the upgrade SHALL proceed normally

#### Scenario: External WebSocket upgrade without valid cookie
- **WHEN** a non-localhost WebSocket upgrade request has no valid `pi_dash_token` cookie and auth is enabled
- **THEN** the server SHALL destroy the socket with HTTP 401

#### Scenario: Localhost WebSocket upgrade — no check
- **WHEN** a localhost WebSocket upgrade request arrives (regardless of auth config)
- **THEN** the upgrade SHALL proceed without cookie validation

### Requirement: Auth routes excluded from localhost guard
The auth routes (`/auth/*`) SHALL NOT be subject to the localhost guard. They MUST be accessible from external IPs so that OAuth callbacks and login flows work through the tunnel.

#### Scenario: External access to /auth/callback
- **WHEN** a non-localhost request hits `/auth/callback/github`
- **THEN** the request SHALL be processed (not blocked by localhost guard)

#### Scenario: External access to /auth/login
- **WHEN** a non-localhost request hits `/auth/login`
- **THEN** the request SHALL return the login page or redirect to the provider

### Requirement: Config REST endpoints
The server SHALL expose `GET /api/config` and `PUT /api/config` endpoints, both protected by `localhostGuard`.

#### Scenario: Config endpoints registered
- **WHEN** the server starts
- **THEN** `GET /api/config` and `PUT /api/config` SHALL be available with `localhostGuard` preHandler

### Requirement: Runtime config reload
The server SHALL support runtime config reloading when `PUT /api/config` is called. A `reloadConfig(partial)` function SHALL merge, persist, and apply changes to the running server instance.

#### Scenario: Config reload applies runtime changes
- **WHEN** `PUT /api/config` writes new config
- **THEN** the server SHALL call `reloadConfig()` to apply hot-swappable settings

### Requirement: Session prompt REST endpoint
The dashboard server SHALL expose a `POST /api/session/:id/prompt` endpoint that sends a text prompt to the specified session. The endpoint SHALL accept a JSON body with `text` (required) and optional `images` array.

#### Scenario: Send prompt to active session
- **WHEN** a `POST /api/session/:id/prompt` request is received with `{ "text": "hello" }`
- **THEN** the server SHALL forward the prompt to the pi session via the pi-gateway and respond with `{ success: true }`

#### Scenario: Send prompt to unknown session
- **WHEN** a `POST /api/session/:id/prompt` request is received for a non-existent session
- **THEN** the server SHALL respond with `{ success: false, error: "session not found" }`

### Requirement: Session abort REST endpoint
The dashboard server SHALL expose a `POST /api/session/:id/abort` endpoint that aborts the current operation in the specified session.

#### Scenario: Abort active session
- **WHEN** a `POST /api/session/:id/abort` request is received for a connected session
- **THEN** the server SHALL send an abort message to the pi session and respond with `{ success: true }`

### Requirement: Session shutdown REST endpoint
The dashboard server SHALL expose a `POST /api/session/:id/shutdown` endpoint that shuts down the specified pi session (not the server).

#### Scenario: Shutdown connected session
- **WHEN** a `POST /api/session/:id/shutdown` request is received for a connected session
- **THEN** the server SHALL send a shutdown message to the pi session and respond with `{ success: true }`

### Requirement: Session rename REST endpoint
The dashboard server SHALL expose a `POST /api/session/:id/rename` endpoint that renames the specified session. The endpoint SHALL accept a JSON body with `name` (required string).

#### Scenario: Rename session
- **WHEN** a `POST /api/session/:id/rename` request is received with `{ "name": "my-session" }`
- **THEN** the server SHALL update the session name in the session manager, forward to the pi session, and respond with `{ success: true }`

### Requirement: Session hide/unhide REST endpoints
The dashboard server SHALL expose `POST /api/session/:id/hide` and `POST /api/session/:id/unhide` endpoints.

#### Scenario: Hide session
- **WHEN** a `POST /api/session/:id/hide` request is received
- **THEN** the server SHALL set `hidden: true` on the session and respond with `{ success: true }`

#### Scenario: Unhide session
- **WHEN** a `POST /api/session/:id/unhide` request is received
- **THEN** the server SHALL set `hidden: false` on the session and respond with `{ success: true }`

### Requirement: Session spawn REST endpoint
The dashboard server SHALL expose a `POST /api/session/spawn` endpoint that spawns a new pi session. The endpoint SHALL accept a JSON body with `cwd` (required string).

#### Scenario: Spawn session
- **WHEN** a `POST /api/session/spawn` request is received with `{ "cwd": "/path/to/project" }`
- **THEN** the server SHALL spawn a new pi session in the specified directory and respond with `{ success: true }`

### Requirement: Session resume REST endpoint
The dashboard server SHALL expose a `POST /api/session/:id/resume` endpoint that resumes or forks an ended session. The endpoint SHALL accept a JSON body with `mode` ("continue" or "fork").

#### Scenario: Resume ended session
- **WHEN** a `POST /api/session/:id/resume` request is received with `{ "mode": "continue" }`
- **THEN** the server SHALL resume the session and respond with `{ success: true }`

### Requirement: Flow control REST endpoint
The dashboard server SHALL expose a `POST /api/session/:id/flow-control` endpoint. The endpoint SHALL accept a JSON body with `action` ("abort" or "toggle_autonomous").

#### Scenario: Abort flow
- **WHEN** a `POST /api/session/:id/flow-control` request is received with `{ "action": "abort" }`
- **THEN** the server SHALL forward the flow control message to the pi session and respond with `{ success: true }`

### Requirement: Set model REST endpoint
The dashboard server SHALL expose a `POST /api/session/:id/model` endpoint. The endpoint SHALL accept a JSON body with `provider` and `modelId` (both required strings).

#### Scenario: Set model on session
- **WHEN** a `POST /api/session/:id/model` request is received with `{ "provider": "anthropic", "modelId": "claude-sonnet-4-20250514" }`
- **THEN** the server SHALL forward the set-model message to the pi session and respond with `{ success: true }`

### Requirement: Set thinking level REST endpoint
The dashboard server SHALL expose a `POST /api/session/:id/thinking-level` endpoint. The endpoint SHALL accept a JSON body with `level` (required string).

#### Scenario: Set thinking level
- **WHEN** a `POST /api/session/:id/thinking-level` request is received with `{ "level": "high" }`
- **THEN** the server SHALL forward the thinking-level message to the pi session and respond with `{ success: true }`

### Requirement: Attach/detach proposal REST endpoints
The dashboard server SHALL expose `POST /api/session/:id/attach-proposal` and `POST /api/session/:id/detach-proposal` endpoints. Attach accepts `{ "changeName": "..." }`.

#### Scenario: Attach proposal
- **WHEN** a `POST /api/session/:id/attach-proposal` request is received with `{ "changeName": "add-feature" }`
- **THEN** the server SHALL update the session's attached proposal and respond with `{ success: true }`

#### Scenario: Detach proposal
- **WHEN** a `POST /api/session/:id/detach-proposal` request is received
- **THEN** the server SHALL clear the session's attached proposal and respond with `{ success: true }`

### Requirement: TypeScript loader passed as file:// URL
All call sites that spawn the dashboard server with `node --import <loader> <entry-script>` SHALL pass the loader argument as a `file://` URL, and SHALL pass the entry-script argument as a `file://` URL EXCEPT when the loader is tsx, in which case the entry SHALL be passed as a raw filesystem path. This covers the jiti register hook, the tsx fallback, and the entry-script path resolved via `fileURLToPath(import.meta.url)`.

The asymmetry exists because tsx's ESM hook treats the entry-script argument as a user-typed specifier and rejects `file://` URLs (resolving them as `<cwd>/file:/...` and throwing `ERR_MODULE_NOT_FOUND`). Node's default resolver and jiti's ESM hook both accept `file://` URL entries. URL-wrapping the entry is required on Windows for drive letters whose single-letter prefix collides with URL-scheme parsing (e.g. `B:\...` parses with scheme `b:`).

#### Scenario: resolveJitiImport returns file URL
- **WHEN** `resolveJitiImport()` resolves jiti successfully on any platform
- **THEN** the returned string SHALL start with `file://` and SHALL be accepted by `new URL(...)` without throwing

#### Scenario: Electron jiti resolver returns file URL
- **WHEN** `resolveJitiFromAnchor()` in `server-lifecycle.ts` resolves jiti successfully
- **THEN** the returned string SHALL be a `file://` URL

#### Scenario: tsx fallback returns file URL
- **WHEN** `cmdStart` falls back to the tsx loader (jiti resolution failed)
- **THEN** the loader path passed to `--import` SHALL be a `file://` URL

#### Scenario: Entry-script is a file:// URL when loader is jiti or Node default
- **WHEN** a server-spawn call site constructs argv of the form `node --import <loader> <entry> <args...>` AND the loader is NOT tsx
- **THEN** the `<entry>` argument SHALL be a `file://` URL

#### Scenario: Entry-script is a raw OS path when loader is tsx
- **WHEN** a server-spawn call site constructs argv of the form `node --import <tsx-loader> <entry> <args...>`
- **THEN** the `<entry>` argument SHALL be a raw filesystem path
- **AND** SHALL NOT be a `file://` URL (tsx's ESM hook rejects URL entries as user-typed specifiers)

#### Scenario: Windows drive-letter loader path no longer crashes
- **WHEN** the loader file lives on a drive whose single-letter prefix collides with URL-scheme parsing (e.g. `B:\...\jiti-register.mjs`) on Windows
- **THEN** `node --import <loader> <entry>` SHALL start the server successfully
- **AND** SHALL NOT produce `ERR_UNSUPPORTED_ESM_URL_SCHEME`

#### Scenario: Windows drive-letter entry-script path no longer crashes under jiti
- **WHEN** the dashboard source lives on a drive whose single-letter prefix collides with URL-scheme parsing (e.g. `B:\Dev\...\cli.ts`) on Windows AND the loader is jiti
- **AND** the user invokes `pi-dashboard start`, the bridge auto-starts the server, the Electron app spawns the server, or `POST /api/restart` is called
- **THEN** the spawned Node process SHALL load the entry script successfully
- **AND** SHALL NOT produce `ERR_UNSUPPORTED_ESM_URL_SCHEME`

#### Scenario: Linux tsx-fallback server start succeeds
- **WHEN** `pi-dashboard start` runs on Linux in a repo where pi is not installed and tsx is the resolved loader
- **THEN** the spawned Node process SHALL load the entry script successfully
- **AND** SHALL NOT produce `ERR_MODULE_NOT_FOUND` with a `<cwd>/file:/...` resolution error

### Requirement: Centralized helper for Node ESM-loader argv construction
The repository SHALL expose helpers in `packages/shared/src/platform/node-spawn.ts` that are the canonical way to build argv for `node --import <loader> <entry>` spawns:

- `toFileUrl(pathOrUrl)` SHALL be pure, idempotent, and correctly wrap Windows drive-letter paths regardless of host OS so the Windows contract can be unit-tested on Linux and macOS.
- `isTsxLoader(loader)` SHALL return `true` when the loader path or URL contains a `tsx/` directory segment (the canonical location of every tsx install's hook), allowing callers to branch between URL-entry and raw-entry based on loader identity.
- `spawnNodeScript(opts)` SHALL URL-wrap the loader unconditionally, and SHALL URL-wrap the entry EXCEPT when `isTsxLoader(opts.loader)` returns `true`.

#### Scenario: toFileUrl is idempotent on file:// URLs
- **WHEN** `toFileUrl("file:///C:/foo.ts")` is called
- **THEN** the helper SHALL return `"file:///C:/foo.ts"` unchanged

#### Scenario: toFileUrl wraps Windows drive-letter paths on any host
- **WHEN** `toFileUrl("B:\\Dev\\cli.ts")` or `toFileUrl("B:/Dev/cli.ts")` is called on Linux, macOS, or Windows
- **THEN** the helper SHALL return `"file:///B:/Dev/cli.ts"`

#### Scenario: toFileUrl wraps POSIX absolute paths
- **WHEN** `toFileUrl("/usr/local/bin/cli.js")` is called on any host
- **THEN** the helper SHALL return `"file:///usr/local/bin/cli.js"`

#### Scenario: isTsxLoader detects tsx hook paths
- **WHEN** `isTsxLoader` is called with a URL or path containing a `tsx/` directory segment (e.g. `file:///home/u/node_modules/tsx/dist/esm/index.mjs` or `C:\x\node_modules\tsx\dist\esm\index.mjs`)
- **THEN** the helper SHALL return `true`

#### Scenario: isTsxLoader returns false for jiti and other loaders
- **WHEN** `isTsxLoader` is called with a jiti hook path (e.g. `file:///.../@mariozechner/jiti/lib/jiti-register.mjs`) or any path without a `tsx/` segment
- **THEN** the helper SHALL return `false`

#### Scenario: spawnNodeScript URL-wraps entry when loader is not tsx
- **WHEN** `spawnNodeScript({ loader, entry, args })` is invoked with a non-tsx loader and raw OS paths
- **THEN** the resulting argv SHALL equal `["--import", toFileUrl(loader), toFileUrl(entry), ...args]`

#### Scenario: spawnNodeScript passes entry as raw path when loader is tsx
- **WHEN** `spawnNodeScript({ loader, entry, args })` is invoked with a tsx loader (detected via `isTsxLoader`) and raw OS paths
- **THEN** the resulting argv SHALL equal `["--import", toFileUrl(loader), entry, ...args]` (entry unchanged)

### Requirement: CI detects raw paths passed to Node ESM loader
The test suite SHALL include a lint-style check that scans the source tree for `spawn(...)` calls whose argv passes `"--import"` or `"--loader"` followed by a bare identifier that is neither URL-wrapped (`toFileUrl` / `pathToFileURL`) nor an allowlisted function that returns URLs (`resolveJitiImport`, `resolveJitiFromAnchor`). Violations SHALL fail CI with a message identifying file and line number. This guard mirrors the existing `no-direct-child-process.test.ts` and `no-direct-process-kill.test.ts` patterns and prevents regression when future contributors add a new spawn site.

Note: the lint intentionally does not flag raw entry-script arguments when the loader is tsx, because raw is correct for that case. The lint's scope is "unintended raw argv next to URL-requiring positions", not "URL-wrap everything mechanically".

#### Scenario: Lint passes on the current codebase
- **WHEN** `npm test` is run after the migration
- **THEN** the lint test SHALL report zero violations

#### Scenario: Lint detects a staged violation fixture
- **GIVEN** a test fixture containing `spawn(process.execPath, ["--import", loader, rawPath])` where `rawPath` is not wrapped and the loader is not tsx
- **WHEN** the lint scanner runs against the fixture
- **THEN** the scanner SHALL report the fixture's file and line number as a violation

### Requirement: Cross-platform /api/restart
The `POST /api/restart` endpoint SHALL restart the server without depending on `sh`, `lsof`, or `curl`. Implementation SHALL use Node built-ins (`child_process.spawn(process.execPath, ...)`, `net` for port probing, `http` for health polling) so it works identically on Windows, macOS, and Linux.

#### Scenario: Restart on Windows
- **WHEN** `POST /api/restart` is called on Windows
- **THEN** the server SHALL shut down, spawn a new server process via `process.execPath`, wait for the new server's `/api/health` to return `{ ok: true }`, and the endpoint SHALL have returned `{ ok: true }` before exit
- **AND** no `sh`, `lsof`, or `curl` invocation SHALL be performed

#### Scenario: Restart on Unix unchanged
- **WHEN** `POST /api/restart` is called on macOS or Linux
- **THEN** the restart SHALL complete successfully with the same externally-observable behavior as before this change

#### Scenario: Restart preserves dev/prod mode
- **WHEN** `POST /api/restart` is called with body `{ dev: true }` or `{ dev: false }`
- **THEN** the new server SHALL be spawned in the requested mode

#### Scenario: Restart health check failure is logged
- **WHEN** the new server does not become healthy within the poll deadline
- **THEN** the failure SHALL be appended to `~/.pi/dashboard/restart.log` with a timestamp

### Requirement: Cross-platform stale-port cleanup
The CLI's port-holder detection (used by `pi-dashboard start` when the configured port is already bound) SHALL work on Windows, macOS, and Linux. On Unix, `lsof -t -i :<port>` SHALL be used. On Windows, `netstat -ano` output SHALL be parsed for the listening PID and `taskkill /F /PID <pid>` SHALL be used to free the port.

#### Scenario: Stale PID freed on Windows
- **WHEN** `pi-dashboard start` runs on Windows and a stale server process is holding the configured port
- **THEN** the CLI SHALL identify the PID via `netstat -ano` and terminate it via `taskkill`
- **AND** the new server SHALL then start successfully

#### Scenario: Best-effort cleanup on parse failure
- **WHEN** `netstat` output cannot be parsed (unexpected format, permission denied, etc.)
- **THEN** the CLI SHALL proceed to the normal "port in use" error path without throwing

#### Scenario: Unix behavior unchanged
- **WHEN** `pi-dashboard start` runs on macOS or Linux
- **THEN** the existing `lsof`-based cleanup SHALL continue to work unchanged

### Requirement: server.log is appended across restarts
The daemon `server.log` at `~/.pi/dashboard/server.log` SHALL be opened in append mode so crash output from prior start attempts is preserved. Each start attempt SHALL emit a timestamped header line so successive runs can be distinguished.

#### Scenario: Append mode preserves history
- **WHEN** `pi-dashboard start` is run twice in succession and the first run wrote error output
- **THEN** `~/.pi/dashboard/server.log` SHALL contain both runs' output after the second run completes

#### Scenario: Timestamped headers
- **WHEN** a new daemon start attempt opens the log file
- **THEN** the first line of that attempt SHALL be a timestamp line distinguishing it from prior runs

### Requirement: Untracked-file synthetic diff uses Node fs
The session-diff synthetic-diff path for untracked files SHALL read file content using `fs.readFileSync`, not `execSync("cat ...")`. This SHALL work identically on Windows, macOS, and Linux.

#### Scenario: Untracked file diff on Windows
- **WHEN** the session diff API encounters an untracked file on Windows
- **THEN** the synthetic diff SHALL be generated from file content read via `fs.readFileSync`
- **AND** no `cat` invocation SHALL be attempted

### Requirement: Pi-process safety check is platform-guarded
The `isPiProcess(pid)` safety check (used before SIGKILL) SHALL return `true` on Windows without attempting `ps` or `/proc` lookups. Its Unix implementation SHALL remain unchanged. The check SHALL never throw on any supported platform.

#### Scenario: Windows returns true without throwing
- **WHEN** `isPiProcess(pid)` is called on Windows
- **THEN** it SHALL return a boolean without invoking Unix-only commands
- **AND** SHALL NOT throw

#### Scenario: Unix behavior unchanged
- **WHEN** `isPiProcess(pid)` is called on macOS or Linux
- **THEN** it SHALL use `ps` (darwin) or `/proc/<pid>/cmdline` (linux) as before

### Requirement: GET /api/spawn-failures returns recent failed-spawn entries
The dashboard server SHALL expose `GET /api/spawn-failures` returning the last N entries from `~/.pi/dashboard/sessions/spawn-failures.log` (and its rotated `.log.1` predecessor) as JSON `{ entries: SpawnFailureEntry[] }`. The route SHALL accept an optional `limit` query parameter, default `50`, max `500`. The route SHALL be registered in `packages/server/src/routes/system-routes.ts` and SHALL be subject to the existing Fastify auth plugin (no auth-bypass entry added).

#### Scenario: default limit returns last 50
- **WHEN** `GET /api/spawn-failures` is called and the log contains 200 entries
- **THEN** the response body SHALL be `{ entries: [...] }` with `entries.length === 50`
- **AND** the entries SHALL be the most recent 50 in file order (oldest of the 50 first)

#### Scenario: custom limit honored
- **WHEN** `GET /api/spawn-failures?limit=10` is called
- **THEN** the response SHALL contain at most 10 entries

#### Scenario: limit clamped to maximum
- **WHEN** `GET /api/spawn-failures?limit=10000` is called
- **THEN** the response SHALL contain at most 500 entries

#### Scenario: invalid limit falls back to default
- **WHEN** `GET /api/spawn-failures?limit=abc` is called
- **THEN** the response SHALL contain at most 50 entries (default applied)

#### Scenario: no log file
- **WHEN** `GET /api/spawn-failures` is called and no log file exists yet
- **THEN** the response SHALL be `{ entries: [] }` with HTTP 200

#### Scenario: auth required
- **WHEN** `GET /api/spawn-failures` is called without valid auth credentials in an auth-enabled deployment
- **THEN** the request SHALL be rejected by the existing auth plugin (HTTP 401), with no special bypass

### Requirement: Browser protocol carries spawn diagnostic fields
`packages/shared/src/browser-protocol.ts` SHALL extend the existing `spawn_error` message type with two optional fields: `code?: SpawnFailureCode` and `reasons?: PreflightReason[]`. It SHALL also add two new message types:
- `spawn_register_timeout` with shape `{ type: "spawn_register_timeout"; cwd: string; pid?: number; stderrTail?: string }` (`pid` optional because tmux/wt/wsl-tmux watches are cwd-keyed only).
- `spawn_register_recovered` with shape `{ type: "spawn_register_recovered"; cwd: string; pid?: number }`.

All additions SHALL be optional/additive — no protocol version bump and no removal of existing fields.

#### Scenario: spawn_error with code accepted by typed handler
- **WHEN** the browser receives a `spawn_error` carrying `code: "PI_NOT_FOUND"`
- **THEN** the typed message handler SHALL accept the field without runtime error

#### Scenario: spawn_register_timeout dispatched to handler
- **WHEN** the browser receives `{ type: "spawn_register_timeout", cwd, pid?, stderrTail? }`
- **THEN** the message router SHALL dispatch it to the spawn-error subsystem (no "unknown message type" warning)

#### Scenario: spawn_register_recovered dispatched to handler
- **WHEN** the browser receives `{ type: "spawn_register_recovered", cwd, pid? }`
- **THEN** the message router SHALL dispatch it to the spawn-error subsystem so it can clear any matching timeout banner

#### Scenario: legacy spawn_error without code still parses
- **WHEN** the browser receives a `spawn_error` lacking `code` and `reasons`
- **THEN** the message SHALL parse and dispatch identically to pre-change behavior
