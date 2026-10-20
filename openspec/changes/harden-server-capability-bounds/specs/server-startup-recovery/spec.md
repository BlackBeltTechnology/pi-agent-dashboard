## MODIFIED Requirements

### Requirement: Recovery server SHALL bind the configured port and serve a status UI at `/`

When invoked, `startRecoveryServer(info)` SHALL bind `info.port` on `info.host` (default `127.0.0.1`; `cli.ts` passes the configured `bindHost`) via `http.createServer`, never on all interfaces unless that host was configured, and serve an HTML status page at `/` and `/index.html`. The page SHALL identify the missing module, suggest a reinstall command for the detected install layout, and expose retry / reinstall controls.

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

#### Scenario: Recovery binds loopback by default

- **GIVEN** `startRecoveryServer(info)` is called without `info.host`
- **WHEN** the server is listening
- **THEN** `server.address().address` SHALL be `127.0.0.1`, not `0.0.0.0` or `::`

### Requirement: Recovery server SHALL offer in-band retry and reinstall actions

The recovery server SHALL expose two POST endpoints that let the user resolve the underlying failure without dropping to a shell. Both SHALL be admitted only for a local, same-origin caller as defined by the `server-capability-bounds` capability; a refused request SHALL receive HTTP 403 with remedy text, SHALL NOT spawn any process, and the recovery page SHALL render that text in a `role="alert"` callout with the buttons left enabled.

#### Scenario: POST /api/recovery/retry respawns the CLI

- **GIVEN** the recovery server is bound to port P
- **WHEN** a local same-origin client issues `POST http://localhost:P/api/recovery/retry`
- **THEN** the server SHALL spawn a detached child running `process.execPath <scriptPath> <…original argv from process.argv.slice(2)>` with `stdio: "ignore"` and the inherited `process.env`
- **AND** SHALL `unref()` the child so the parent can exit independently
- **AND** SHALL respond `200 text/plain` with a human-readable retry message
- **AND** SHALL call `process.exit(0)` after a short delay to allow the response to flush

#### Scenario: POST /api/recovery/reinstall runs the per-layout reinstall command

- **GIVEN** the recovery server detected `layout: "npm-global"`
- **WHEN** a local same-origin client issues `POST http://localhost:P/api/recovery/reinstall`
- **THEN** the server SHALL spawn `npm install -g @blackbelt-technology/pi-agent-dashboard` (or `npm install` when layout is `"monorepo"`)
- **AND** SHALL stream stdout and stderr to `console.log` with the `[recovery-install]` prefix
- **AND** SHALL respond `200` on exit code `0` with body `Reinstall complete. Click Retry start.`
- **AND** SHALL respond `500` on non-zero exit with the last 30 output lines in the body

#### Scenario: Refused action renders remedy on the page

- **GIVEN** the recovery page was loaded through a non-loopback `Host`
- **WHEN** the user clicks Retry start
- **THEN** the POST SHALL be answered 403
- **AND** the page SHALL show the refusal text in a `role="alert"` element and keep both buttons enabled

### Requirement: Recovery server module SHALL import only node built-ins

The module `packages/server/src/lifecycle/recovery-server.ts` SHALL import only `node:*`-prefixed standard library modules. It SHALL NOT import any third-party package, any `@blackbelt-technology/*` workspace package, or any other repo source file that transitively imports a third-party package.

#### Scenario: Static analysis of imports

- **GIVEN** the source of `packages/server/src/lifecycle/recovery-server.ts`
- **WHEN** all top-level `import` statements are inspected
- **THEN** every import specifier SHALL begin with `node:` (e.g. `node:http`, `node:child_process`, `node:url`, `node:path`, `node:os`, `node:fs`)
- **AND** no specifier SHALL reference a bare npm package name, a relative repo path, or a workspace-scoped name
