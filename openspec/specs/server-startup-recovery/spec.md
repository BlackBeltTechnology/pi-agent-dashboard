# server-startup-recovery

## Purpose

Requirements governing how the PI Dashboard server degrades into a recovery HTTP server when a top-level dependency fails to resolve at startup. The recovery server binds the configured port, serves a status UI, exposes diagnostics, and offers in-band retry / reinstall so the user can recover without dropping to a shell.

## Requirements

### Requirement: Dashboard server SHALL degrade to a recovery HTTP server when a top-level dependency fails to resolve at startup

When the main server module (`packages/server/src/server.ts`) fails to load because of an `ERR_MODULE_NOT_FOUND` / `MODULE_NOT_FOUND` / "Cannot find module|package" error during the dynamic import inside `runForeground()`, the CLI SHALL NOT crash. It SHALL instead bind the configured HTTP port to a recovery server that informs the user, captures diagnostics, and offers in-band reinstall/retry.

#### Scenario: Module-not-found at server import is caught

- **GIVEN** `packages/server/src/cli.ts` is executing `runForeground(config)`
- **AND** the dynamic `import("./server.js")` throws an error whose `code` is `ERR_MODULE_NOT_FOUND` or `MODULE_NOT_FOUND`, OR whose message matches `Cannot find (module|package) '…'`
- **WHEN** `runForeground` evaluates the catch arm
- **THEN** it SHALL call `startRecoveryServer({ port: config.port, error: err, missingModule: parseModuleNotFoundError(err) })`
- **AND** SHALL NOT propagate the error to the top-level crash path
- **AND** SHALL return a never-resolving Promise so the event loop stays alive while the recovery server runs

#### Scenario: Non-module errors propagate unchanged

- **GIVEN** the dynamic import of `./server.js` succeeds but `createServer(config)` throws for a non-module reason (e.g. config invalid, port bind failure)
- **WHEN** the catch arm in `runForeground` evaluates `isModuleNotFoundError(err)`
- **THEN** the predicate returns `false`
- **AND** the error SHALL be re-thrown for the top-level CLI `main()` catch to handle

### Requirement: Recovery server module SHALL import only node built-ins

The module `packages/server/src/recovery-server.ts` SHALL import only `node:*`-prefixed standard library modules. It SHALL NOT import any third-party package, any `@blackbelt-technology/*` workspace package, or any other repo source file that transitively imports a third-party package.

#### Scenario: Static analysis of imports

- **GIVEN** the source of `packages/server/src/recovery-server.ts`
- **WHEN** all top-level `import` statements are inspected
- **THEN** every import specifier SHALL begin with `node:` (e.g. `node:http`, `node:child_process`, `node:url`, `node:path`, `node:os`, `node:fs`)
- **AND** no specifier SHALL reference a bare npm package name, a relative repo path, or a workspace-scoped name

### Requirement: Recovery server SHALL bind the configured port and serve a status UI at `/`

When invoked, `startRecoveryServer(info)` SHALL bind `info.port` via `http.createServer` and serve an HTML status page at `/` and `/index.html`. The page SHALL identify the missing module, suggest a reinstall command for the detected install layout, and expose retry / reinstall controls.

#### Scenario: GET / returns recovery HTML

- **GIVEN** the recovery server is bound to port P
- **WHEN** a client issues `GET http://localhost:P/`
- **THEN** the response SHALL be `200`, `content-type: text/html; charset=utf-8`
- **AND** the body SHALL include the strings `Recovery Mode`, the missing-module identifier (or `(unknown)`), and the suggested reinstall command
- **AND** the body SHALL include `<button id="retry">` and `<button id="reinstall">` controls bound to `POST /api/recovery/retry` and `POST /api/recovery/reinstall`

#### Scenario: HTML escapes user-influenced fields

- **GIVEN** an error whose message contains `<script>alert('xss')</script>` and a missing-module identifier containing `<img onerror=1>`
- **WHEN** `buildRecoveryHtml({ error, missingModule, port })` is called
- **THEN** the returned HTML SHALL NOT contain the literal substrings `<script>alert` or `<img onerror`
- **AND** SHALL contain `&lt;script&gt;` and `&lt;img` in their place

#### Scenario: Unknown routes fall through to recovery HTML

- **GIVEN** the recovery server is bound to port P
- **WHEN** a client issues `GET http://localhost:P/some/unknown/path`
- **THEN** the response SHALL be `200` with the recovery HTML body (so SPA-style deep links produce a meaningful page, not a 404)

### Requirement: Recovery server SHALL expose `/api/health` reporting recovery mode

The recovery server SHALL serve `GET /api/health` returning a JSON object with `ok: false`, `mode: "recovery"`, and the captured diagnostic fields. Health probes (mDNS verifier, bridge, monitoring tools) can rely on this shape to distinguish a recovering dashboard from a refused-connection failure.

#### Scenario: GET /api/health returns recovery-mode JSON

- **GIVEN** the recovery server is bound to port P with `missingModule: "fastify"`
- **WHEN** a client issues `GET http://localhost:P/api/health`
- **THEN** the response SHALL be `200`, `content-type: application/json`
- **AND** the body parsed as JSON SHALL satisfy `{ ok: false, mode: "recovery", missingModule: "fastify", error: <string>, suggestedFix: <string>, layout: <string> }`

### Requirement: Recovery server SHALL offer in-band retry and reinstall actions

The recovery server SHALL expose two POST endpoints that let the user resolve the underlying failure without dropping to a shell.

#### Scenario: POST /api/recovery/retry respawns the CLI

- **GIVEN** the recovery server is bound to port P
- **WHEN** a client issues `POST http://localhost:P/api/recovery/retry`
- **THEN** the server SHALL spawn a detached child running `process.execPath <scriptPath> <…original argv from process.argv.slice(2)>` with `stdio: "ignore"` and the inherited `process.env`
- **AND** SHALL `unref()` the child so the parent can exit independently
- **AND** SHALL respond `200 text/plain` with a human-readable retry message
- **AND** SHALL call `process.exit(0)` after a short delay to allow the response to flush

#### Scenario: POST /api/recovery/reinstall runs the per-layout reinstall command

- **GIVEN** the recovery server detected `layout: "npm-global"`
- **WHEN** a client issues `POST http://localhost:P/api/recovery/reinstall`
- **THEN** the server SHALL spawn `npm install -g @blackbelt-technology/pi-agent-dashboard` (or `npm install` when layout is `"monorepo"`)
- **AND** SHALL stream stdout and stderr to `console.log` with the `[recovery-install]` prefix
- **AND** SHALL respond `200` on exit code `0` with body `Reinstall complete. Click Retry start.`
- **AND** SHALL respond `500` on non-zero exit with the last 30 output lines in the body

### Requirement: Recovery server SHALL persist a diagnostic snapshot

On entry, `startRecoveryServer` SHALL write a JSON snapshot of the failure to `~/.pi/dashboard/last-recovery.json` so external tooling (doctor, bug-report capture, support flows) can inspect the most recent recovery event without parsing the log.

#### Scenario: Snapshot file is written

- **GIVEN** `startRecoveryServer({ port: 8000, error, missingModule })` is called with `~/.pi/dashboard` either existing or creatable
- **WHEN** the function executes its pre-listen steps
- **THEN** `~/.pi/dashboard/last-recovery.json` SHALL contain a JSON object with keys `at` (ISO timestamp), `port`, `missingModule`, `error` (message), `stack`, `layout`, `scriptPath`

#### Scenario: Snapshot failure is non-fatal

- **GIVEN** `~/.pi/dashboard/` is read-only or `last-recovery.json` cannot be written
- **WHEN** the snapshot step runs
- **THEN** the failure SHALL be swallowed
- **AND** the HTTP recovery server SHALL still be bound and serving

### Requirement: Recovery server SHALL refuse to loop on port contention

If the configured port is already bound when the recovery server attempts to listen, the process SHALL log a clear instruction and exit with a non-zero code rather than retry forever or silently fail.

#### Scenario: EADDRINUSE at recovery-bind time

- **GIVEN** another process is holding `info.port`
- **WHEN** `startRecoveryServer(info)` calls `server.listen(info.port)`
- **THEN** the `error` event SHALL fire with `code === "EADDRINUSE"`
- **AND** the recovery server SHALL log a message advising `pi-dashboard stop` and the holder PID lookup path
- **AND** SHALL call `process.exit(2)`
