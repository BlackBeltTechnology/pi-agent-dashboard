## ADDED Requirements

### Requirement: TypeScript loader passed as file:// URL
All call sites that spawn the dashboard server with `node --import <loader>` SHALL pass the loader as a `file://` URL (via `url.pathToFileURL(p).href`), not a raw filesystem path. This requirement covers the jiti register hook, the tsx fallback, and any future loader added to `packages/server/src/cli.ts`, `packages/shared/src/resolve-jiti.ts`, and `packages/electron/src/lib/server-lifecycle.ts`.

#### Scenario: resolveJitiImport returns file URL
- **WHEN** `resolveJitiImport()` resolves jiti successfully on any platform
- **THEN** the returned string SHALL start with `file://` and SHALL be accepted by `new URL(...)` without throwing

#### Scenario: Electron jiti resolver returns file URL
- **WHEN** `resolveJitiFromAnchor()` in `server-lifecycle.ts` resolves jiti successfully
- **THEN** the returned string SHALL be a `file://` URL

#### Scenario: tsx fallback returns file URL
- **WHEN** `cmdStart` falls back to the tsx loader (jiti resolution failed)
- **THEN** the loader path passed to `--import` SHALL be a `file://` URL

#### Scenario: Windows drive-letter loader path no longer crashes
- **WHEN** the loader file lives on a non-`C:` drive (e.g. `B:\...\jiti-register.mjs`) on Windows
- **THEN** `node --import <loader> <cli.ts>` SHALL start the server successfully
- **AND** SHALL NOT produce `ERR_UNSUPPORTED_ESM_URL_SCHEME`

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
