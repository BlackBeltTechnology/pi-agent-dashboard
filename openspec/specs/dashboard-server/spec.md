# dashboard-server Specification

## Purpose
HTTP / WebSocket surface exposed by the dashboard server process: REST routes, WebSocket gateways, lifecycle (startup, shutdown, restart), spawn / launch contracts for child processes, and the loader / TypeScript-runtime resolution that backs the entry-script invocation.

## Requirements

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
The server's `upgrade` handler SHALL validate authentication for non-localhost WebSocket upgrade requests when auth is enabled. The check SHALL parse the `cookie` header from the upgrade request and validate the JWT. Independently of auth configuration, the handler SHALL first apply the cross-site Origin gate (see `cross-site-request-gate`): an upgrade carrying an untrusted `Origin` header is rejected with HTTP 403 even when the peer is localhost.

#### Scenario: External WebSocket upgrade with valid cookie
- **WHEN** a non-localhost WebSocket upgrade request includes a valid `pi_dash_token` cookie
- **THEN** the upgrade SHALL proceed normally

#### Scenario: External WebSocket upgrade without valid cookie
- **WHEN** a non-localhost WebSocket upgrade request has no valid `pi_dash_token` cookie and auth is enabled
- **THEN** the server SHALL destroy the socket with HTTP 401

#### Scenario: Localhost WebSocket upgrade — no check
- **WHEN** a localhost WebSocket upgrade request arrives with no `Origin` header or with a trusted `Origin` (regardless of auth config)
- **THEN** the upgrade SHALL proceed without cookie validation

#### Scenario: Localhost WebSocket upgrade with untrusted Origin is rejected
- **WHEN** a localhost WebSocket upgrade request arrives with an `Origin` header the dashboard does not trust (regardless of auth config)
- **THEN** the server SHALL destroy the socket with HTTP 403 before any cookie, ticket, or local-token check

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

### Requirement: CI detects raw paths passed to Node ESM loader
The test suite SHALL include a lint-style check (`packages/shared/src/__tests__/no-raw-node-import.test.ts`) that scans the `packages/` source tree for argv literals in which `"--import"` or `"--loader"` is followed by a loader or entry position that is neither a `file:` string literal nor a `toFileUrl(...)` / `pathToFileURL(...).href` call. The scan covers each package's `src/` tree and skips `__tests__` directories. Violations SHALL fail CI with a message identifying file and line number. Exemptions inside the scanned tree SHALL be limited to:
- a file allowlist containing only `packages/shared/src/platform/node-spawn.ts` and `packages/shared/src/server-launcher.ts`, the files that own argv construction;
- a per-line `ban:raw-node-import-ok` opt-out marker.

No function name SHALL be allowlisted. New spawn sites SHALL build argv through `buildNodeImportArgvParts` / `spawnNodeScript`, which apply the entry-wrap rule owned by the `server-launch` capability.

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

### Requirement: CLI bin entry resolves jiti at runtime (no tsx fallback)
The `pi-dashboard` CLI entry point SHALL be a plain JavaScript file (`packages/server/bin/pi-dashboard.mjs`) that resolves jiti at runtime and re-execs Node with `--import <jiti-url> packages/server/src/cli.ts <args>`. Resolution SHALL use `createRequire` anchored at the wrapper's own real path and try the jiti packages listed in `ToolResolver`'s `JITI_PACKAGES`, in order. The wrapper SHALL apply the entry-wrap rule owned by the `server-launch` capability, so a jiti loader gets a raw entry path. There SHALL be no tsx fallback path. Metadata invocations (`--version`, `-v`, `version`) are answered from `package.json` before jiti resolution. For every other invocation, jiti is a direct dependency of the server package, so a miss SHALL be treated as a corrupted install: the wrapper SHALL exit 1 with a stderr message that says so and suggests reinstalling the dashboard.

#### Scenario: Direct CLI invocation with pi available
- **WHEN** a user runs `pi-dashboard status` from a shell with pi reachable on the module graph
- **THEN** the wrapper SHALL resolve jiti and exec `node --import <jiti-url> packages/server/src/cli.ts status`, forwarding stdio and the child's exit code

#### Scenario: Direct CLI invocation without pi
- **WHEN** a user runs `pi-dashboard status` and no listed jiti package resolves from the wrapper's install
- **THEN** the wrapper SHALL print a stderr message beginning `pi-dashboard: cannot find jiti.`, stating the install may be corrupted and suggesting `npm install -g @blackbelt-technology/pi-agent-dashboard`, then exit 1
- **AND** SHALL NOT attempt to resolve `tsx` or any other TypeScript loader

### Requirement: CLI shebang is loader-agnostic
The `packages/server/src/cli.ts` shebang SHALL be `#!/usr/bin/env node` (no `--import` flag). The file SHALL no longer be invoked directly as the bin entry — the loader is supplied by the `bin/pi-dashboard.mjs` wrapper.

#### Scenario: Shebang inspection
- **WHEN** inspecting line 1 of `packages/server/src/cli.ts`
- **THEN** it SHALL read `#!/usr/bin/env node` with no loader flag

### Requirement: Doctor does not probe for tsx
Electron Doctor (`packages/electron/src/lib/doctor.ts`) SHALL NOT execute `where tsx` / `which tsx` and SHALL NOT report a "No tsx binary" detail string. Doctor's "Server launch test" reduces to checking `node` + pi.

#### Scenario: Doctor output omits tsx
- **WHEN** Doctor runs against a clean install
- **THEN** no diagnostic row mentions tsx
- **AND** the server-launch-test row passes when `node` + pi are present

### Requirement: Process-level crash safety net SHALL prevent plugin faults from killing the host

The dashboard server process MUST install handlers for both `unhandledRejection` and `uncaughtException` events at startup, before any plugin or route is loaded. The handlers MUST log the offending error (stack preferred, message fallback) with a stable `[crash-safety]` prefix and MUST NOT call `process.exit()`.

The handler is the host's last line of defence against single-point-of-failure plugin code. It does not silence well-handled errors — every well-formed `try/catch` and route handler still surfaces errors normally; only otherwise-fatal async faults are suppressed.

#### Scenario: Plugin throws an unhandled promise rejection

- **WHEN** a loaded plugin (e.g. `flows`) makes an async call whose rejection is not awaited / `.catch()`-ed
- **THEN** the dashboard server process logs `[crash-safety] unhandledRejection (suppressed): <stack>` to `~/.pi/dashboard/server.log`
- **AND** the process keeps running; `/api/health` continues to return 200
- **AND** open WebSocket connections remain open

#### Scenario: Plugin throws a synchronous uncaught exception

- **WHEN** a plugin's listener / timer callback throws synchronously outside any `try/catch`
- **THEN** the dashboard server process logs `[crash-safety] uncaughtException (suppressed): <stack>`
- **AND** the process keeps running

#### Scenario: Suppressed errors are diagnosable

- **WHEN** an operator inspects `~/.pi/dashboard/server.log` after a "stuck" or unexpected behaviour report
- **THEN** they can `grep crash-safety` to see every suppressed fault with full stack
- **AND** the prefix is stable across releases so log filters keep working

### Requirement: Spawn environment guarantees Windows System paths on PATH
On Windows, every child process spawned via `ToolResolver.buildSpawnEnv()` SHALL receive an environment whose `PATH` contains, at minimum, the following canonical Windows system directories — regardless of what was present in the inherited PATH from the parent process:

- `%SYSTEMROOT%\System32` (where.exe, tasklist.exe, taskkill.exe, cmd.exe)
- `%SYSTEMROOT%` (notepad.exe, regedit.exe)
- `%SYSTEMROOT%\System32\Wbem` (wmic.exe on systems where it is installed)
- `%SYSTEMROOT%\System32\WindowsPowerShell\v1.0` (powershell.exe)
- `%SYSTEMROOT%\System32\OpenSSH` (ssh.exe — when present)
- `%LOCALAPPDATA%\Microsoft\WindowsApps` (winget-installed shims)

Each directory SHALL be added to PATH only if it physically exists on disk AND is not already present in PATH (case-insensitive substring match per Windows PATH semantics). The helper SHALL be idempotent — calling it twice on the same env returns an env identical to a single call.

#### Scenario: Naked inherited PATH gets System32 restored
- **WHEN** Electron inherits a PATH that lacks `C:\Windows\System32` (e.g. launched from a corporate-policy-restricted environment, a stripped-env shortcut, or a portable .exe extraction)
- **THEN** the child process spawned via `buildSpawnEnv` SHALL receive a PATH that includes `C:\Windows\System32` as one of its leading entries
- **AND** `spawnSync("where", ["powershell"])` from that child SHALL succeed

#### Scenario: Existing System32 not duplicated
- **WHEN** the inherited PATH already contains `C:\Windows\System32` (the common case for terminal-launched apps)
- **THEN** the child's PATH SHALL contain exactly one occurrence of `C:\Windows\System32`
- **AND** the original PATH ordering SHALL be preserved for non-prepended entries

#### Scenario: Non-Windows hosts unaffected
- **WHEN** the helper runs on `darwin` or `linux`
- **THEN** the returned environment SHALL be identical to the input
- **AND** SHALL NOT add any Windows-specific paths

#### Scenario: Missing-on-disk paths skipped
- **WHEN** a candidate directory like `C:\Windows\System32\OpenSSH` does not exist on the host (older Windows builds)
- **THEN** the helper SHALL NOT add that path to PATH
- **AND** the absence SHALL NOT block adding the other present candidates

#### Scenario: Settings → Tools resolves system tools
- **WHEN** the user opens Settings → Tools on a Windows install whose inherited PATH lacked System32
- **THEN** the rows for `powershell`, `tasklist`, `taskkill` SHALL show ✓ with absolute paths under `C:\Windows\System32\`
- **AND** the rows for `wmic` SHALL show ✓ on Win 10 / pre-22H2 (where wmic exists on disk), or be absent on Win 11 22H2+ (where the binary is removed)

#### Scenario: Bridge process-scanner functions
- **WHEN** the bridge extension (running inside a pi session spawned by the dashboard) calls `scanWindowsProcesses(parentPid)`
- **THEN** the call SHALL successfully invoke either `wmic` (where present) or its `Get-CimInstance` PowerShell fallback
- **AND** SHALL return a non-empty `ChildProcessInfo[]` for any pi process with child processes
- **AND** SHALL NOT silently return `[]` due to PATH-lookup failure

### Requirement: Login-shell tool-detection fallback MUST NOT spawn an interactive shell

When `ToolResolver.resolveSystemTool()` falls back to `whichViaLoginShell()` (step 4 of the managed-bin → extraBinDirs → PATH → login-shell chain), the spawned shell command MUST use `-lc` (login, non-interactive) and MUST NOT include `-i` (interactive).

**Rationale**: an interactive shell calls `tcsetpgrp(stdin_fd, shell_pgid)` on startup to claim the terminal's foreground process group. When that shell exits, the parent pi process is no longer in the foreground group; the tty driver delivers `SIGTSTP` and pi is suspended immediately after startup. This manifests as `[1]+ Stopped pi` in iTerm2 / macOS Terminal whenever the registry resolves a binary not on PATH (e.g. `zrok` when not installed) and the login-shell fallback fires.

**Rule generalizes across shells** — `bash`, `zsh`, and `fish` all implement `tcsetpgrp` on interactive startup. The fallback uses `process.env.SHELL || "/bin/zsh"`; the no-`-i` rule applies regardless of which shell is selected.

#### Scenario: Login-shell fallback resolves a binary

- **WHEN** `useLoginShell: true` and a binary is not on PATH
- **THEN** `whichViaLoginShell()` invokes `execSync(\`${shell} -lc "which ${cmd}"\`, …)`
- **AND** the spawned command MUST NOT contain `-i`, `-il`, or `-ilc`
- **AND** the parent pi process MUST NOT receive `SIGTSTP` as a side effect

#### Scenario: Test enforces the invariant

- **WHEN** the `binary-lookup` test suite runs the `"tries login shell when enabled and PATH fails"` case
- **THEN** the captured shell command string is asserted with `expect(cmd).not.toMatch(/-i\b|-il|-ilc/)`
- **AND** the existing positive assertion that the resolved path equals the stubbed `/nvm/bin/pi` continues to pass

#### Scenario: Documentation reflects the invariant

- **WHEN** an agent greps `docs/faq.md` or `docs/service-bootstrap.md` for the login-shell fallback
- **THEN** every example uses `$SHELL -lc "which <cmd>"` (no `-i`)
- **AND** each section carries a one-line note explaining the SIGTSTP rationale
- **AND** the canonical code reference is `packages/shared/src/platform/binary-lookup.ts whichViaLoginShell()`

### Requirement: Windows process introspection uses PowerShell Get-CimInstance, not wmic
On Windows, all process and system introspection inside the dashboard codebase SHALL be performed via PowerShell's `Get-CimInstance` cmdlet, not via `wmic.exe`. The `wmic` binary SHALL NOT be invoked from any code path that ships in a release artefact.

This covers, at minimum:
- Virtual-machine detection (`isVirtualMachine` in `packages/shared/src/platform/commands.ts`).
- Editor process command-line resolution (`defaultGetCmdline` in `packages/server/src/editor-pid-registry.ts`).
- Bridge process-scanner descendant lookup (`getWindowsDescendants` in `packages/extension/src/process-scanner.ts`).

Rationale: Windows 11 22H2+ ships without wmic by default. Continued use produces (a) `'wmic' is not recognized as an internal or external command, operable program or batch file.` stderr noise from cmd.exe when wmic is invoked via `execSync` with default stdio, (b) silent feature regression when stderr is suppressed (the call returns null/empty), and (c) red "not found" rows in the Settings → Tools UI for the registered `wmic` tool.

`Get-CimInstance` ships with PowerShell 3.0+ (Windows 8 / Server 2012 onward) and is present on every supported Windows host.

#### Scenario: VM detection works on Win 11 22H2
- **WHEN** `isVirtualMachine()` runs on a Windows 11 22H2 host that is a VMware VM AND `wmic.exe` is absent
- **THEN** the function SHALL return `true`
- **AND** SHALL NOT write any "not recognized" message to the parent process's stderr

#### Scenario: Editor cmdline resolution works on Win 11 22H2
- **WHEN** `defaultGetCmdline(pid)` runs on a Windows 11 22H2 host AND `wmic.exe` is absent
- **THEN** the function SHALL return the actual command line string of the running process
- **AND** SHALL NOT return `null` solely because wmic is missing

#### Scenario: No wmic invocation anywhere in shipped code
- **WHEN** a release artefact's source / dist tree is scanned for any shipped child-process invocation (`exec`, `execSync`, `execFile`, `execFileSync`, `spawn`, `spawnSync`) referencing `wmic`
- **THEN** zero matches SHALL be found outside `__tests__` directories

#### Scenario: Settings → Tools row absent
- **WHEN** the user opens Settings → Tools on a Win 11 22H2 install
- **THEN** there SHALL NOT be a row labelled `wmic` with status "Not found"
- **AND** the tool registry SHALL NOT include a `wmic` entry

### Requirement: Process introspection is spawnSync-based, not execSync-based
All Windows process / system introspection calls SHALL use `spawnSync` (argv form, no shell) rather than `execSync` (string command, default shell). When the invoked binary is absent or the cmdlet fails, the failure SHALL be observable via the return value's `status` / `error` fields, NOT leaked to the parent process's inherited stderr.

#### Scenario: Missing binary does not leak to parent stderr
- **WHEN** an introspection call's target binary (e.g. `powershell.exe`) is somehow absent or returns non-zero
- **THEN** the parent process's stderr SHALL NOT receive any output from the failed invocation
- **AND** the function SHALL return its documented "missing / unknown" value (typically `null` or `false`)

#### Scenario: windowsHide honoured end-to-end
- **WHEN** any Windows introspection call runs on a packaged Electron app
- **THEN** no console window flash SHALL be visible to the user
- **AND** the `windowsHide: true` option SHALL be set on every `spawnSync` call performing introspection

### Requirement: GET /api/sessions/:sessionId/tool-result/:toolCallId

The dashboard server SHALL expose `GET /api/sessions/:sessionId/tool-result/:toolCallId` returning the full final result string for a completed tool call, looked up from `MemoryEventStore`. This endpoint exists so the UI can fetch the complete output on demand when the truncated rendered text was capped to its last N lines.

The route SHALL be guarded by the same network guard used by other session routes.

#### Scenario: Completed tool call returns full result
- **WHEN** a session has emitted a `tool_execution_end` event for `toolCallId = "abc"` with a 1000-line `result`
- **AND** the client requests `GET /api/sessions/:sessionId/tool-result/abc`
- **THEN** the response SHALL be `200` with `{ result: "<full 1000-line string>", isError: false }`

#### Scenario: Tool call still in flight
- **WHEN** the session has emitted `tool_execution_start` for `toolCallId = "abc"` but no `tool_execution_end`
- **THEN** the response SHALL be `404` with `{ error: "tool call still in flight or unknown" }`

#### Scenario: Tool call evicted from memory buffer
- **WHEN** the per-session ring buffer has evicted the `tool_execution_end` event under memory pressure
- **THEN** the response SHALL be `404` (same body as in-flight case)

### Requirement: Session archive/unarchive REST endpoints
The dashboard server SHALL expose `POST /api/session/:id/archive` and `POST /api/session/:id/unarchive` endpoints.

#### Scenario: Archive session
- **WHEN** a `POST /api/session/:id/archive` request is received for an ended session
- **THEN** the server SHALL mark the session archived, remove it from the live set, and respond with `{ success: true }`

#### Scenario: Archive an idle alive session
- **WHEN** a `POST /api/session/:id/archive` request is received for an alive idle session
- **THEN** the server SHALL end the session, respond `{ success: true, pending: true }`, and archive it once ended

#### Scenario: Archive a running session
- **WHEN** a `POST /api/session/:id/archive` request is received for a session running a turn
- **THEN** the server SHALL respond with `{ success: false, error }` and a 409 status

#### Scenario: Archive an interrupted session
- **WHEN** a `POST /api/session/:id/archive` request is received for a session with `live === true`
- **THEN** the server SHALL respond with `{ success: false, error }` and a 409 status

#### Scenario: Unarchive session
- **WHEN** a `POST /api/session/:id/unarchive` request is received for an archived session
- **THEN** the server SHALL restore the session into the live set as ended and respond with `{ success: true }`

### Requirement: Archived session delete endpoint
The dashboard server SHALL expose `DELETE /api/sessions/archived/:id`. For an archived session it SHALL remove the `.jsonl` and `.meta.json`, remove the index row, broadcast `archived_count_updated`, and respond `{ success: true }`. For a resident or unknown id it SHALL respond 404.

#### Scenario: Delete archived
- **WHEN** `DELETE /api/sessions/archived/:id` is received for an archived session
- **THEN** both files SHALL be gone and the response SHALL be `{ success: true }`

#### Scenario: Delete resident is refused
- **WHEN** `DELETE /api/sessions/archived/:id` is received for a resident session
- **THEN** the server SHALL respond 404 and delete nothing

### Requirement: Session list excludes archived sessions
`GET /api/sessions` SHALL return resident sessions only; archived sessions are available through `GET /api/sessions/archived`.

#### Scenario: Archived not in list
- **WHEN** `GET /api/sessions` is requested while a session is archived
- **THEN** that session SHALL NOT be in `data`

### Requirement: GET /api/sessions/:sessionId/entry/:entryId

The dashboard server SHALL expose `GET /api/sessions/:sessionId/entry/:entryId` returning the
full structured payload of a persisted custom entry for that session. This endpoint exists so
the UI can fetch the complete payload on demand when the rendered body was capped to its last N
lines.

The payload SHALL be read from the session's on-disk JSONL, resolved through the session manager
(never constructed from the `sessionId` string), mirroring the existing `session-change`
endpoint. The endpoint SHALL NOT source the payload from the in-memory event store, because that
store truncates string fields and collapses long arrays at INGEST and therefore cannot return an
untruncated payload — failing precisely for the large payloads this endpoint exists to serve.

The entry SHALL be addressed by session identifier, never by filesystem path, so the endpoint
cannot be used to read a file outside the addressed session. The route SHALL be guarded by the
same network guard used by other session routes.

#### Scenario: Custom entry returns full payload

- **WHEN** a session has persisted a custom entry with `entryId = "abc"` whose payload exceeds
  the chat display ceiling
- **AND** the client requests `GET /api/sessions/:sessionId/entry/abc`
- **THEN** the response SHALL be `200` with the entry's `customType` and its complete,
  untruncated structured payload

#### Scenario: Unknown or evicted entry

- **WHEN** the requested `entryId` is unknown to the session, or is absent from the session file
- **THEN** the response SHALL be `404`

#### Scenario: Entry not yet flushed to disk

- **GIVEN** the agent runtime buffers appended custom entries in memory and creates or extends
  the session file only once a subsequent assistant message is appended
- **WHEN** the client requests an entry that has not yet been flushed
- **THEN** the response SHALL be `404`, and the client SHALL degrade to the row's stored body
- **AND** this SHALL NOT be treated as an error condition, since a later request for the same
  entry succeeds once the flush occurs

#### Scenario: Entry on an abandoned branch

- **GIVEN** the session file records a branch structure and the requested entry lies outside the
  active leaf-to-root branch (for example before a rewind)
- **WHEN** the client requests it
- **THEN** the response SHALL be `404` and the client SHALL degrade to the row's stored body,
  since the on-disk reader resolves only the active branch

#### Scenario: Entry belongs to a different session

- **GIVEN** `entryId` identifies an entry persisted under a different session
- **WHEN** the client requests it under this `sessionId`
- **THEN** the response SHALL be `404`
- **AND** the other session's payload SHALL NOT be returned

#### Scenario: Traversal-shaped identifier is rejected

- **WHEN** the request supplies an `entryId` containing path separators or parent-directory
  segments
- **THEN** the response SHALL be `404` and no filesystem read outside the addressed session
  SHALL occur

### Requirement: Canonical Node ESM-loader argv helpers
`packages/shared/src/platform/node-spawn.ts` SHALL expose the canonical helpers for `node --import <loader> <entry>` spawns:
- `toFileUrl(pathOrUrl)` SHALL perform no I/O and SHALL be idempotent. It SHALL wrap Windows drive-letter paths correctly on any host OS, so the Windows contract can be unit-tested on Linux and macOS. Relative inputs are resolved against the process cwd.
- `isTsxLoader(loader)` SHALL return `true` when the loader path or URL contains a `tsx/` directory segment.
- `isJitiLoader(loader)` SHALL return `true` when the loader path or URL contains a `jiti/` directory segment.
- `buildNodeImportArgvParts({ loader, entry, args?, platform? })` SHALL be the single pure builder of the `--import` argv shape. It SHALL always URL-wrap the loader. It SHALL wrap the entry exactly when `shouldUrlWrapEntry(loader, platform)` says so. The `server-launch` capability owns that entry-wrap rule; this requirement does not restate it.
- `spawnNodeScript(opts)` SHALL build its argv through `buildNodeImportArgvParts` when a loader is given.

#### Scenario: toFileUrl is idempotent on file:// URLs
- **WHEN** `toFileUrl("file:///C:/foo.ts")` is called
- **THEN** the helper SHALL return `"file:///C:/foo.ts"` unchanged

#### Scenario: toFileUrl wraps Windows drive-letter paths on any host
- **WHEN** `toFileUrl("B:\\Dev\\cli.ts")` or `toFileUrl("B:/Dev/cli.ts")` is called on Linux, macOS, or Windows
- **THEN** the helper SHALL return `"file:///B:/Dev/cli.ts"`

#### Scenario: toFileUrl wraps POSIX absolute paths
- **WHEN** `toFileUrl("/usr/local/bin/cli.js")` is called on any host
- **THEN** the helper SHALL return `"file:///usr/local/bin/cli.js"`

#### Scenario: Loader identity helpers
- **WHEN** `isTsxLoader` / `isJitiLoader` are called with a path or URL containing a `tsx/` or a `jiti/` segment respectively (e.g. `C:\x\node_modules\tsx\dist\esm\index.mjs`, `file:///.../node_modules/jiti/lib/jiti-register.mjs`)
- **THEN** the matching helper SHALL return `true` and the other SHALL return `false`

#### Scenario: Loader position is always a file:// URL
- **WHEN** `buildNodeImportArgvParts` is called with a raw loader path on any `platform`, including a Windows drive letter that collides with URL-scheme parsing (e.g. `B:\...\jiti-register.mjs`)
- **THEN** argv position 1 SHALL equal `toFileUrl(loader)`
- **AND** the spawned Node process SHALL NOT fail with `ERR_UNSUPPORTED_ESM_URL_SCHEME`

#### Scenario: Entry position follows shouldUrlWrapEntry
- **WHEN** `buildNodeImportArgvParts({ loader, entry, args, platform })` is called
- **THEN** the result SHALL equal `["--import", toFileUrl(loader), shouldUrlWrapEntry(loader, platform) ? toFileUrl(entry) : entry, ...args]`

### Requirement: Startup fails hard when pi cannot be resolved
pi, openspec and tsx are regular dependencies of the server package. During foreground startup the server SHALL therefore resolve `pi` through the tool registry. When the resolve fails, the server SHALL throw a hard error. The error SHALL name a corrupted `node_modules/` tree, list the resolution strategies tried, and suggest reinstalling the dashboard or the Electron app. There SHALL be no degraded mode and no runtime install.

#### Scenario: pi resolves at startup
- **WHEN** the server starts and the tool registry resolves `pi`
- **THEN** the server SHALL log `[bootstrap] ready (pi resolved via <source>)` and continue startup

#### Scenario: pi unresolvable at startup
- **WHEN** the server starts and the tool registry cannot resolve `pi`
- **THEN** startup SHALL throw an error whose message contains `corrupted node_modules/ tree` and the tried strategies
- **AND** the server SHALL NOT attempt any package install
