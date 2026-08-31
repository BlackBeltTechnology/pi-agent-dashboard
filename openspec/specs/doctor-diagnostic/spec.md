# doctor-diagnostic Specification

## Purpose

Diagnostic surface that inspects pi-dashboard runtime health (binaries, server, setup, managed install) and renders structured, remediation-bearing reports across the Electron Doctor window, the web Settings → Diagnostics section, and an authenticated REST endpoint.

## Requirements

### Requirement: Section taxonomy on every check
Every `DoctorCheck` SHALL carry a `section` field whose value is one of `runtime`, `pi-tooling`, `server`, `tunnel`, `setup`, or `diagnostics`. The mapping from check name to section SHALL be defined in a single shared table consumed by every renderer.

#### Scenario: Runtime checks are tagged runtime
- **WHEN** the doctor produces checks named `Electron`, `System Node.js`, `Bundled Node.js`, or `Bundled npm`
- **THEN** each of those checks SHALL have `section: "runtime"`

#### Scenario: pi-tooling checks are tagged pi-tooling
- **WHEN** the doctor produces checks named `pi CLI` or `openspec CLI`
- **THEN** each of those checks SHALL have `section: "pi-tooling"`

#### Scenario: Server-related checks are tagged server
- **WHEN** the doctor produces checks named `Dashboard server code`, `Offline packages bundle`, `TypeScript loader (tsx)`, `Dashboard server`, `Server log (~/.pi-dashboard/server.log)`, or `Server launch test`
- **THEN** each of those checks SHALL have `section: "server"`

#### Scenario: Tunnel checks are tagged tunnel
- **WHEN** the doctor produces checks named `zrok binary`, `zrok environment`, `zrok API reachable`, or `tunnel runtime`
- **THEN** each of those checks SHALL have `section: "tunnel"`

#### Scenario: Setup checks are tagged setup
- **WHEN** the doctor produces checks named `Setup wizard` or `API key`
- **THEN** each of those checks SHALL have `section: "setup"`

#### Scenario: Legacy-install-directory advisory is tagged diagnostics
- **WHEN** the doctor produces the `Legacy install directory` row
- **THEN** that check SHALL have `section: "diagnostics"`

### Requirement: Remediation suggestion on non-ok checks
Every `DoctorCheck` whose `status` is `warning` or `error` SHALL carry a non-empty `suggestion` string with an actionable next step. Checks with `status: "ok"` SHALL omit the `suggestion` field (or set it to `undefined`).

#### Scenario: Failing pi CLI check has a suggestion
- **WHEN** the `pi CLI` check resolves with `status: "error"`
- **THEN** the resulting check SHALL include a `suggestion` field whose text guides the user to install or configure pi (e.g., references `pi-dashboard upgrade-pi` or the setup wizard)

#### Scenario: Failing server check has a suggestion
- **WHEN** the `Dashboard server` check resolves with `status: "error"`
- **THEN** the resulting check SHALL include a `suggestion` field that points at `pi-dashboard start` or the equivalent Electron menu action

#### Scenario: OK checks omit suggestion
- **WHEN** any check resolves with `status: "ok"`
- **THEN** the resulting check's `suggestion` field SHALL be `undefined` or absent

### Requirement: Markdown export of the doctor report
The doctor SHALL expose a pure formatter that converts a `DoctorReport` into GitHub-issue-paste-friendly Markdown. The output SHALL contain one Markdown table per non-empty section, a summary header line, and a "Remediation" bullet list enumerating the suggestion of each non-ok check.

#### Scenario: All-ok report renders without remediation list
- **WHEN** every check in the report has `status: "ok"`
- **THEN** the Markdown output SHALL include the per-section tables and summary header
- **AND** the Markdown output SHALL NOT include a "Remediation" section

#### Scenario: Mixed report includes remediation list
- **WHEN** the report contains at least one check with `status: "warning"` or `status: "error"`
- **THEN** the Markdown output SHALL include a "Remediation" bullet list
- **AND** each bullet SHALL pair a check name with its `suggestion` text

#### Scenario: Section ordering is stable
- **WHEN** the formatter renders any report
- **THEN** the section tables SHALL appear in the fixed order: runtime, pi-tooling, server, tunnel, setup, diagnostics
- **AND** within each section, rows SHALL appear in the order the checks were produced by the doctor

### Requirement: Server exposes the doctor report via authenticated REST
The dashboard server SHALL expose `GET /api/doctor` returning JSON `{ checks: DoctorCheck[], summary: { ok: number, warnings: number, errors: number }, generatedAt: number }`. The route SHALL be subject to the same authentication gate as `/api/config`.

#### Scenario: Authenticated request returns the report
- **WHEN** an authenticated client issues `GET /api/doctor`
- **THEN** the server SHALL respond with HTTP 200
- **AND** the response body SHALL contain `checks`, `summary`, and `generatedAt`
- **AND** every check in the body SHALL include a `section` field
- **AND** every non-ok check in the body SHALL include a `suggestion` field

#### Scenario: Unauthenticated request is rejected
- **WHEN** an unauthenticated client issues `GET /api/doctor` from a non-bypass network
- **THEN** the server SHALL respond with the same status code it returns for an unauthenticated `GET /api/config`

### Requirement: Per-check fault isolation
A throw or rejection from any single check SHALL NOT prevent other checks from being produced. Every check SHALL be wrapped in a fault-isolating helper that converts uncaught failures into an `error` row with non-empty `message`, `detail`, and `suggestion` fields.

#### Scenario: One check throws, the rest still run
- **WHEN** a single check function throws an uncaught exception during the doctor run
- **THEN** the resulting report SHALL contain an `error` row for that check whose `message` is a human-readable summary, whose `detail` includes the captured error message, and whose `suggestion` directs the user to file an issue with the Markdown export
- **AND** all other checks SHALL appear in the report with their normal computed status

#### Scenario: Doctor never produces an empty report
- **WHEN** the doctor encounters a top-level failure (e.g., the entry point itself throws)
- **THEN** the renderer SHALL display a single fallback row labelled "Doctor failed to produce a report" with the captured error and a link to the doctor log
- **AND** the renderer SHALL NOT show a blank or perpetually-loading view

### Requirement: Bounded and classified external invocations
Every external command invocation performed by the doctor (binary version probes, server health probes, file existence checks, the bundled-Node sanity test) SHALL run with a hard timeout and SHALL classify failures into distinct categories that drive distinct suggestion text. The default timeout SHALL be 5000 ms; probes that exercise cold-start paths (the bundled-Node version probe and the server-launch sanity test) SHALL use 15000 ms. The actual deadline SHALL appear in the suggestion text on a timeout failure.

#### Scenario: Spawned command not found
- **WHEN** a probe fails because the target binary is missing (ENOENT)
- **THEN** the resulting check SHALL have `status: "error"`, a `message` stating the binary was not found, a `detail` listing the path that was searched, and a `suggestion` pointing at the setup wizard or the appropriate install command

#### Scenario: Spawned command not executable
- **WHEN** a probe fails because the target binary cannot be executed (EACCES / EPERM)
- **THEN** the resulting check SHALL have `status: "error"`, a `message` stating the binary is not executable, a `detail` showing the file mode or permission error, and a `suggestion` describing how to restore execute permissions on the current OS

#### Scenario: Spawned command times out
- **WHEN** a probe does not complete within the configured timeout
- **THEN** the resulting check SHALL have `status: "error"`, a `message` stating the command did not respond within the timeout window, and a `suggestion` mentioning antivirus / credential prompt / endpoint security as likely causes

#### Scenario: Spawned command exits non-zero
- **WHEN** a probe completes but exits with a non-zero status
- **THEN** the resulting check SHALL have `status: "error"`, a `message` stating the command reported failure, and a `detail` capturing the exit code and the tail of stderr (capped at 500 characters, with ANSI escape sequences stripped)

#### Scenario: Cold-start probes use the longer timeout
- **WHEN** the doctor runs the bundled-Node version probe or the server-launch sanity test
- **THEN** the probe SHALL be bounded by a 15000 ms timeout, not the 5000 ms default

### Requirement: Mandatory operations log to a doctor log file
Doctor operations that the codebase otherwise considers safe (resource-path access, version reads, manifest reads, the bundled-Node sanity test) SHALL be wrapped so that any uncaught failure is appended to `<managedDir>/doctor.log` as a single timestamped JSON-per-line entry AND surfaced as a high-visibility row in the report's `diagnostics` section.

#### Scenario: Internal failure logs and surfaces
- **WHEN** a mandatory operation throws during the doctor run
- **THEN** a JSON entry containing the timestamp, the operation label, and the captured error SHALL be appended to `<managedDir>/doctor.log`
- **AND** a row labelled "Doctor internal: <label>" SHALL appear in the `diagnostics` section of the report with the captured error in `detail` and a suggestion to share the log file when reporting the issue

#### Scenario: Doctor log is unwriteable
- **WHEN** appending to `<managedDir>/doctor.log` fails (permission denied, disk full, missing directory)
- **THEN** the doctor run SHALL still complete successfully
- **AND** the originating internal failure SHALL still be surfaced in the report's `diagnostics` section
- **AND** the logging failure SHALL NOT be raised to the renderer

#### Scenario: Doctor window exposes the log
- **WHEN** the Electron Doctor window is open
- **THEN** the toolbar SHALL include an `[Open doctor log]` action

#### Scenario: Open log when log does not exist yet
- **WHEN** the user clicks `[Open doctor log]` and `<managedDir>/doctor.log` does not exist
- **THEN** the surface SHALL display a non-modal status message "No doctor log yet — the doctor has not encountered internal failures."
- **AND** the surface SHALL NOT create an empty log file
- **AND** the toolbar button SHALL remain visible and enabled

#### Scenario: Doctor log rotates at 1 MB
- **WHEN** an `assumedMandatory` log append is about to occur and the existing `<managedDir>/doctor.log` exceeds 1 MB
- **THEN** the existing file SHALL be renamed to `<managedDir>/doctor.log.1` (replacing any prior `.1`)
- **AND** a fresh `<managedDir>/doctor.log` SHALL be created with the new entry
- **AND** rotation failure SHALL NOT propagate to the doctor run

### Requirement: Error message shape contract
Every `DoctorCheck` whose `status` is `warning` or `error` SHALL have non-empty `message`, `detail`, and `suggestion` fields. `message` SHALL state what is wrong, `detail` SHALL state why or where, and `suggestion` SHALL state a concrete next step (a command, menu path, or documentation pointer).

#### Scenario: Non-ok rows have all three fields
- **WHEN** any check resolves with `status: "warning"` or `status: "error"`
- **THEN** the resulting check SHALL have `message`, `detail`, and `suggestion` all set to non-empty strings

#### Scenario: Bundled Node spawn failures produce distinct messages
- **WHEN** the bundled-Node probe fails
- **THEN** an ENOENT failure, an EACCES failure, a timeout, and a non-zero exit SHALL each produce a distinct `message` string and a distinct `suggestion` string tailored to that failure mode

### Requirement: Renderer fault tolerance
Both the Electron Doctor window and the web Diagnostics section SHALL render a visible, actionable fallback when the underlying report cannot be produced or fetched. Neither surface SHALL leave the user looking at a blank page or an indefinite loading state.

#### Scenario: Electron renderer survives an IPC rejection
- **WHEN** the Doctor window's `doctor:run` IPC call rejects
- **THEN** the window SHALL display a fallback row stating the doctor failed, including the captured error message
- **AND** the window SHALL keep the `[Re-run]` and `[Open doctor log]` toolbar actions enabled

#### Scenario: Web renderer survives a non-200 response
- **WHEN** `GET /api/doctor` returns a non-200 response or a body that does not match the expected shape
- **THEN** the Diagnostics section SHALL render an inline error block containing the HTTP status and a 500-character excerpt of the response body
- **AND** the section SHALL keep the `[Re-run]` action enabled

#### Scenario: Clipboard rejection falls back to a textarea modal
- **WHEN** the user clicks `[Copy as Markdown]` (or `[Copy as Plain]`) on the web Diagnostics section and `navigator.clipboard.writeText` rejects
- **THEN** the section SHALL open a modal containing a textarea pre-filled with the report and an instruction to copy manually with the OS keyboard shortcut
- **AND** the textarea contents SHALL be pre-selected so the user can copy without further interaction
- **AND** the modal SHALL be dismissable with Escape or backdrop click

#### Scenario: Re-run is disabled while a run is in flight
- **WHEN** a doctor run is in flight (Electron IPC pending or web fetch pending)
- **THEN** the `[Re-run]` button SHALL be disabled with a visible "Running…" label or spinner
- **AND** the button SHALL re-enable when the promise settles regardless of outcome

### Requirement: Web UI renders the doctor report in Settings → Diagnostics
The dashboard web client SHALL render a Diagnostics section inside the Settings panel that fetches `/api/doctor` and displays one grouped table per section, with a status pill per row, the row's `message`, and the row's `suggestion` when present. The section SHALL include a `Copy as Markdown` action that copies the formatter's Markdown output to the clipboard.

#### Scenario: Diagnostics section renders sections in order
- **WHEN** the user opens Settings → Diagnostics
- **THEN** the section SHALL display tables in the order: runtime, pi-tooling, server, tunnel, setup, diagnostics
- **AND** sections that have zero checks in the response SHALL not be rendered

#### Scenario: Re-run refreshes the report
- **WHEN** the user clicks `[Re-run]`
- **THEN** the client SHALL re-issue `GET /api/doctor` and re-render the result with the new `generatedAt`

#### Scenario: Copy as Markdown writes to clipboard
- **WHEN** the user clicks `[Copy as Markdown]` on the Diagnostics section
- **THEN** the client SHALL write the Markdown rendering of the current report to the system clipboard

### Requirement: API key check inspects both settings.json and auth.json
The Doctor's `API key` check SHALL report `status: "ok"` whenever at least one provider credential is configured in either `~/.pi/agent/settings.json` (legacy API-key fields: `anthropicApiKey`, `openaiApiKey`, `apiKey`, or any `providers[*].apiKey`) OR in `~/.pi/agent/auth.json` (any top-level provider entry with a non-empty trimmed `key`, `access`, or `refresh` field). The check SHALL report `status: "warning"` only when neither file yields a non-empty credential. Empty strings, whitespace-only strings, `null`, and `undefined` SHALL NOT count as configured.

The detector SHALL be implemented in a single shared helper (`packages/shared/src/credential-detect.ts`) and consumed by both the server's `/api/doctor` route and the Electron first-run wizard, so the two surfaces cannot drift.

The check's `detail` field SHALL name the inspected file paths but SHALL NOT echo, log, hash, or otherwise leak any credential value, provider key name, or token shape.

#### Scenario: OAuth-only install reports configured
- **WHEN** `~/.pi/agent/auth.json` contains at least one provider entry whose `access` or `refresh` field is a non-empty string AND `~/.pi/agent/settings.json` contains no API-key field
- **THEN** the `API key` check SHALL have `status: "ok"`
- **AND** the check's `suggestion` field SHALL be omitted

#### Scenario: API-key-only install still reports configured
- **WHEN** `~/.pi/agent/settings.json` has `anthropicApiKey` set to a non-empty string AND `~/.pi/agent/auth.json` is absent
- **THEN** the `API key` check SHALL have `status: "ok"` (no regression vs. pre-change behaviour)

#### Scenario: Neither file yields a credential
- **WHEN** both `~/.pi/agent/settings.json` and `~/.pi/agent/auth.json` are absent, OR both are present but neither contains a non-empty credential field
- **THEN** the `API key` check SHALL have `status: "warning"`
- **AND** the check's `suggestion` SHALL direct the user to **Settings → Providers** and mention BOTH OAuth sign-in AND API-key configuration as valid resolutions
- **AND** the check's `detail` SHALL list both inspected file paths

#### Scenario: Empty credential strings do not count
- **WHEN** `~/.pi/agent/auth.json` contains a provider entry like `{ "anthropic": { "type": "oauth", "access": "", "refresh": "   " } }` AND no other credential exists anywhere
- **THEN** the `API key` check SHALL have `status: "warning"`

#### Scenario: Malformed auth.json falls back to settings.json
- **WHEN** `~/.pi/agent/auth.json` is present but not valid JSON AND `~/.pi/agent/settings.json` contains a valid `anthropicApiKey`
- **THEN** the `API key` check SHALL have `status: "ok"` (the detector treats per-file parse failure as "no credential from that file" without throwing)

#### Scenario: Detail does not leak credentials
- **WHEN** the `API key` check is rendered in any state (ok or warning)
- **THEN** the `detail` field text SHALL NOT contain any substring of any credential value present in either inspected file
- **AND** the `detail` SHALL NOT name which specific provider entry matched (only that the file was inspected)

### Requirement: Legacy `~/.pi-dashboard/` advisory only when the directory exists

`~/.pi-dashboard/` is legacy only for the pre-R3 Electron runtime-install path; live consumers
still own content under it (Electron wizard state, doctor/server logs, the managed Node runtime,
managed `node_modules/`). The Doctor SHALL emit a single `Legacy install directory` advisory row in
the `diagnostics` section if and only if the directory is detected on disk AND is genuinely
orphaned: no `node/` managed runtime, no Electron wizard state files, no non-empty
`node_modules/`, and no `doctor.log`/`server.log` files (logs are live content — the Doctor
itself appends and tails them). When the directory exists but holds live content, the row SHALL identify which
consumers still own it and SHALL NOT suggest deletion. Clean installs SHALL NOT see any row
referring to `~/.pi-dashboard/`. The row SHALL be emitted by the shared `runSharedChecks(...)`
implementation so the Electron Doctor window and the server-side `GET /api/doctor` endpoint render
identical output, and the server startup log SHALL apply the same orphan test before printing any
safe-to-delete advisory.

#### Scenario: Clean install emits no `~/.pi-dashboard/` row

- **WHEN** `~/.pi-dashboard/` is absent on the user's filesystem
- **AND** the Doctor runs to completion
- **THEN** the resulting `DoctorReport` SHALL contain no check named `Legacy install directory`
- **AND** the report SHALL contain no check named `Managed install (~/.pi-dashboard)` (the obsolete
  row name SHALL NOT reappear)

#### Scenario: Pre-R3 upgrade emits exactly one advisory row

- **WHEN** `~/.pi-dashboard/` exists as a genuinely orphaned tree: no `node/` runtime, no wizard
  state files, no non-empty `node_modules/`, and no log files
- **AND** the Doctor runs to completion
- **THEN** the resulting `DoctorReport` SHALL contain exactly one check named `Legacy install
  directory`
- **AND** that check SHALL have `status: "warning"` and `section: "diagnostics"`
- **AND** the check's `message` SHALL include the directory path and a "Safe to delete manually"
  phrase
- **AND** the check's `detail` SHALL report the directory's total size in megabytes
- **AND** the check's `suggestion` SHALL direct the user to delete the directory manually

#### Scenario: Live content suppresses the deletion advisory

- **WHEN** `~/.pi-dashboard/` contains a `node/` managed runtime, Electron wizard state files, a
  non-empty `node_modules/`, or a `doctor.log`/`server.log`
- **AND** the Doctor runs to completion
- **THEN** no check SHALL carry a suggestion to delete `~/.pi-dashboard/`
- **AND** any row describing the directory SHALL name the live consumers (e.g. managed runtime,
  wizard state, logs)
- **AND** the server startup log SHALL NOT print a "safe to delete" advisory for the directory

#### Scenario: Detector failure is non-fatal

- **WHEN** the legacy-directory detector itself throws
- **AND** the Doctor runs to completion
- **THEN** the `DoctorReport` SHALL still be produced
- **AND** the report SHALL contain no `Legacy install directory` row (best-effort: advisory absent
  on failure rather than report-blocking)

### Requirement: Tunnel diagnostic checks
The doctor SHALL produce four `tunnel`-section checks covering the failure modes of zrok-based public tunneling: `zrok binary`, `zrok environment`, `zrok API reachable`, and `tunnel runtime`. The first three SHALL run independently of any active tunnel; the fourth SHALL consume the existing tunnel-watchdog status and SHALL gracefully degrade to `ok` when watchdog data is unavailable. All four SHALL accept test-seam injection so tests do not perform real DNS lookups, filesystem reads, or binary lookups.

#### Scenario: zrok binary not found
- **WHEN** the resolver cannot locate a `zrok` binary on the system
- **THEN** the `zrok binary` check SHALL have `status: "warning"`
- **AND** the `suggestion` SHALL include an OS-appropriate install command (e.g. `brew install zrok` on macOS, the upstream download URL elsewhere)

#### Scenario: zrok binary found
- **WHEN** the resolver locates a `zrok` binary
- **THEN** the `zrok binary` check SHALL have `status: "ok"`
- **AND** the `detail` SHALL include the resolved absolute path

#### Scenario: zrok environment file present and valid
- **WHEN** `~/.zrok2/environment.json` or `~/.zrok/environment.json` exists and contains valid JSON with a non-empty `zrok_token`
- **THEN** the `zrok environment` check SHALL have `status: "ok"`

#### Scenario: zrok environment file missing
- **WHEN** neither `~/.zrok2/environment.json` nor `~/.zrok/environment.json` exists
- **THEN** the `zrok environment` check SHALL have `status: "warning"`
- **AND** the `suggestion` SHALL guide the user to run `zrok invite` followed by `zrok enable <token>`

#### Scenario: zrok environment file malformed
- **WHEN** the environment file exists but contains invalid JSON or is missing `zrok_token`
- **THEN** the `zrok environment` check SHALL have `status: "warning"` and SHALL NOT throw

#### Scenario: zrok API DNS lookup succeeds
- **WHEN** `dns.promises.lookup("api-v1.zrok.io")` resolves within the configured timeout
- **THEN** the `zrok API reachable` check SHALL have `status: "ok"`

#### Scenario: zrok API DNS lookup fails
- **WHEN** the DNS lookup fails with `ENOTFOUND`, `EAI_AGAIN`, or any other network error
- **THEN** the `zrok API reachable` check SHALL have `status: "warning"`
- **AND** the `detail` SHALL include the captured failure reason
- **AND** the `suggestion` SHALL mention checking network connectivity, DNS, and VPN as likely causes

#### Scenario: zrok API DNS lookup times out
- **WHEN** the DNS lookup does not complete within 3000 ms
- **THEN** the `zrok API reachable` check SHALL have `status: "warning"`
- **AND** the `detail` SHALL include the text `timeout 3000 ms`

#### Scenario: Tunnel runtime check with no watchdog data
- **WHEN** the doctor's `getTunnelWatchdogStatus` dependency is undefined OR returns `null`
- **THEN** the `tunnel runtime` check SHALL have `status: "ok"`
- **AND** the `detail` SHALL state that no tunnel is currently active

#### Scenario: Tunnel runtime check with healthy watchdog
- **WHEN** `getTunnelWatchdogStatus()` returns a status with `consecutiveFailures === 0` and `lastSuccessAt` within `intervalMs × 3` of now
- **THEN** the `tunnel runtime` check SHALL have `status: "ok"`
- **AND** the `detail` SHALL include the current tunnel URL and `recycleCount`

#### Scenario: Tunnel runtime check with degraded watchdog
- **WHEN** `getTunnelWatchdogStatus()` returns a status with `consecutiveFailures > 0` OR `lastSuccessAt` older than `intervalMs × 3`
- **THEN** the `tunnel runtime` check SHALL have `status: "warning"`
- **AND** the `detail` SHALL include `lastFailureReason` from the watchdog status
- **AND** the `suggestion` SHALL guide the user to click the 🌐 Tunnel button to re-create the tunnel

### Requirement: Probe argv uses URL form for dynamic imports of filesystem paths
Any Doctor probe that constructs a `node -e "<script>"` argv whose `<script>` contains a dynamic `import "<spec>"` SHALL pass `<spec>` as a `file://` URL, never as a raw filesystem path. The URL conversion SHALL use `pathToFileURL(absPath).href` (Node built-in, `node:url`).

Rationale: on Windows, raw absolute paths begin with a drive-letter (`C:\`). Node's ESM resolver parses the import specifier as a URL and treats the drive letter as a scheme, rejecting with `ERR_UNSUPPORTED_ESM_URL_SCHEME`. On POSIX the raw path `/Users/...` happens to work, but the URL form is universal and incurs zero behavioural change.

This requirement applies only to probe argv, not to runtime launch paths. The production server spawn (`packages/shared/src/server-launcher.ts` → `packages/shared/src/platform/node-spawn.ts`) already passes the entry as a positional argv (not a dynamic import in `-e`) and is therefore exempt.

#### Scenario: Windows probe builds file:// URL
- **WHEN** Doctor constructs a Server launch test on Windows with `testCli = "C:\\…\\cli.ts"`
- **THEN** the probe argv's `-e` script SHALL contain the substring `import "file:///C:/…/cli.ts"` (forward slashes, file scheme)
- **AND** SHALL NOT contain the substring `import "C:\\` (raw Windows path)

#### Scenario: POSIX probe builds file:// URL
- **WHEN** Doctor constructs a Server launch test on macOS/Linux with `testCli = "/Users/…/cli.ts"`
- **THEN** the probe argv's `-e` script SHALL contain the substring `import "file:///Users/…/cli.ts"` (file scheme prepended)
- **AND** SHALL NOT contain a raw absolute-path import

#### Scenario: Production launch path unaffected
- **WHEN** the Electron main process spawns the bundled server via `launchDashboardServer`
- **THEN** the entry SHALL be passed as a positional argv (e.g. `node --import <loader> /path/to/cli.ts`), not via `-e`
- **AND** this requirement SHALL NOT apply (the URL-vs-path distinction does not arise for positional argv)

### Requirement: System Node detection matches the server accept-set

`detectSystemNode()` SHALL report a Node binary as found/usable if and only if its `--version` passes the shared `isUsableNodeVersion(version)` gate — i.e. the version is within `package.json#engines.node` (`>=22.19.0 <27`) AND not in the nodejs/node#58515 Fastify-affected range (v22.0–v22.18, v24.1–v24.2). The same gate SHALL apply to both the PATH/registry-based detection and the on-disk scan fallback (`scanForUsableNodeOnDisk`). The doctor SHALL NOT report a system Node as usable that the dashboard server would refuse to start on.

The on-disk scan SHALL remain Unix-only; on `win32` it SHALL NOT execute.

#### Scenario: Node 22.18 reported not usable

- **WHEN** the resolved system Node reports `v22.18.0` AND no other usable Node is found on disk
- **THEN** `detectSystemNode()` SHALL return `{ found: false }`

#### Scenario: Node 22.19 reported usable

- **WHEN** the resolved system Node reports `v22.19.0`
- **THEN** `detectSystemNode()` SHALL return `{ found: true, path: <node path> }`

#### Scenario: Node 24 LTS reported usable

- **WHEN** the resolved system Node reports `v24.3.0` through any later `v24.x.x`
- **THEN** `detectSystemNode()` SHALL return `{ found: true, path: <node path> }`

#### Scenario: Node 24.1 / 24.2 reported not usable

- **WHEN** the resolved system Node reports `v24.1.0` or `v24.2.0` AND no other usable Node is found on disk
- **THEN** `detectSystemNode()` SHALL return `{ found: false }`

#### Scenario: Node 25 reported usable

- **WHEN** the resolved system Node reports any `v25.x.x`
- **THEN** `detectSystemNode()` SHALL return `{ found: true, path: <node path> }`

#### Scenario: Node 27 reported not usable

- **WHEN** the resolved system Node reports `v27.0.0` or newer AND no other usable Node is found on disk
- **THEN** `detectSystemNode()` SHALL return `{ found: false }`

#### Scenario: Node 21 reported not usable

- **WHEN** the resolved system Node reports any `v21.x.x` AND no other usable Node is found on disk
- **THEN** `detectSystemNode()` SHALL return `{ found: false }`

#### Scenario: On-disk scan applies the same gate

- **WHEN** PATH-based detection yields nothing AND `~/.nvm/versions/node/` contains both `v22.18.0` and `v24.15.0`
- **THEN** the scan SHALL skip the affected/below-floor `v22.18.0`
- **AND** SHALL return the `v24.15.0` path

### Requirement: Doctor reports attached-server version skew

The Doctor diagnostic SHALL include a check named "Attached server version" in the `setup` section that compares the running shell's application version against `/api/health.version` and emits a `warning` when they differ. The suggestion text SHALL be selected from `health.launchSource` to give the user a launch-source-appropriate fix path.

The check helper (`checkAttachedServerVersion`) lives in the shared doctor core (`packages/shared/src/doctor-core.ts`) but SHALL be wired into the Electron arm (`packages/electron/src/lib/doctor.ts`) ONLY. The server arm (`packages/server/src/routes/doctor-routes.ts`) SHALL NOT emit it: a server comparing its own package version to its own self-fetched `/api/health` is a loopback tautology (always `ok`, never detects skew). Version skew is only observable across the Electron-shell ↔ attached-server boundary.

- Status `ok` when `appVersion === health.version`.
- Status `warning` when the versions differ. Message format: `Dashboard server reports v<server>; this app bundle is v<app>`. Suggestion:
  - `launchSource === "standalone"` → `Run \`npm i -g @blackbelt-technology/pi-dashboard@<appVersion>\` and restart your terminal session.`
  - `launchSource === "bridge"` OR `launchSource === "bridge-orphaned"` → `Stop the pi session that started this server (or run \`pi-dashboard stop\`) and relaunch the app.`
  - `launchSource === "electron"` → `Quit the other Electron instance or use the zombie-adoption prompt to take ownership.`
- Status `error` when `/api/health` is unreachable or `health.version` is missing.

#### Scenario: Matching versions report OK

- **GIVEN** the Electron app version is `0.5.3` AND `/api/health.version` is `0.5.3`
- **WHEN** Doctor runs
- **THEN** the "Attached server version" row SHALL have status `ok`

#### Scenario: Mismatch with standalone server

- **GIVEN** the Electron app version is `0.5.3` AND `/api/health.version` is `0.5.1` AND `launchSource === "standalone"`
- **WHEN** Doctor runs
- **THEN** the row SHALL have status `warning`
- **AND** the suggestion SHALL contain `npm i -g @blackbelt-technology/pi-dashboard@0.5.3`

#### Scenario: Mismatch with bridge-started server

- **GIVEN** the Electron app version is `0.5.3` AND `/api/health.version` is `0.5.1` AND `launchSource === "bridge"`
- **WHEN** Doctor runs
- **THEN** the row SHALL have status `warning`
- **AND** the suggestion SHALL mention stopping the pi session OR running `pi-dashboard stop`

#### Scenario: Mismatch with other-Electron server

- **GIVEN** the Electron app version is `0.5.3` AND `/api/health.version` is `0.5.1` AND `launchSource === "electron"`
- **WHEN** Doctor runs
- **THEN** the row SHALL have status `warning`
- **AND** the suggestion SHALL mention quitting the other Electron instance or zombie-adoption

#### Scenario: Health unreachable produces error

- **GIVEN** the configured dashboard port responds with connection refused
- **WHEN** Doctor runs
- **THEN** the "Attached server version" row SHALL have status `error`
- **AND** the message SHALL indicate the server was unreachable

#### Scenario: Server-side Doctor omits the row

- **WHEN** the server-side Doctor route (`/api/doctor`) runs
- **THEN** the report SHALL NOT include an "Attached server version" row (the check is Electron-arm only; a server self-comparison is a loopback tautology)

### Requirement: Extension-tree ABI mismatch detection and offered reconciliation

The dashboard SHALL detect when compiled native modules in pi's shared extension tree
(`~/.pi/agent/npm/node_modules/`) were built for a different Node ABI than the resolved spawn
runtime, without loading the module into the dashboard process (file-level inspection or an
out-of-process probe; a probe failure SHALL NOT crash or destabilise the server). Modules whose
compiled binaries are N-API (ABI-stable) SHALL be skipped — identified by inspection of the
binary or module, never by distribution format: per-platform prebuilds do not imply ABI
stability. On mismatch, the Doctor SHALL surface one row per module naming: the module, its built
ABI, the resolved spawn runtime and its ABI, and the exact scoped reconciliation command (a
per-module rebuild using the resolved runtime's Node family).

Reconciliation SHALL be offered, never silent, via a Doctor action or CLI confirmation. A
`runtime.autoRebuild: true` config flag MAY authorize unattended reconciliation for headless
setups; the flag defaults to off, and it SHALL abstain (falling back to the offered flow) when
the resolved-runtime visibility check detects resolved-vs-terminal divergence. The pre-spawn
mismatch check SHALL be bounded via a manifest: a discovery walk (server start, manifest drift,
Doctor demand; depth-capped at 8 levels below the tree root) records the compiled-module files,
and the pre-spawn check re-validates only the manifest entries' stat signatures against the
resolved ABI — catching in-place rebuilds that change file mtimes without changing tree shape.
The pre-spawn addition SHALL stay within p95 50ms on the stat path and p95 250ms on the
shim-probe path, measured over a 100-entry manifest.

#### Scenario: Mismatched module produces a named row

- **WHEN** a V8-ABI native module in the shared tree records an ABI different from the resolved
  spawn runtime's ABI
- **AND** the Doctor runs to completion
- **THEN** the report SHALL contain a row naming the module, its built ABI, the resolved runtime
  and ABI, and a scoped rebuild command

#### Scenario: ABI-stable module is skipped

- **WHEN** a native module in the shared tree is identified as N-API by binary/module inspection
- **THEN** no ABI-mismatch row SHALL be emitted for it regardless of the resolved runtime

#### Scenario: Prebuild distribution alone does not exempt a module

- **WHEN** a V8-ABI-bound module ships per-platform prebuilds (e.g. better-sqlite3 v13 layout)
- **AND** its compiled binary's ABI differs from the resolved runtime's
- **THEN** an ABI-mismatch row SHALL be emitted for it

#### Scenario: Coherent tree emits no row

- **WHEN** every V8-ABI module in the shared tree matches the resolved runtime's ABI
- **THEN** the report SHALL contain no ABI-mismatch row

#### Scenario: Reconciliation requires consent by default

- **WHEN** an ABI mismatch is detected and `runtime.autoRebuild` is not set
- **THEN** no rebuild SHALL run without an explicit user action (Doctor one-click or CLI confirm)

#### Scenario: autoRebuild authorizes unattended reconciliation

- **WHEN** an ABI mismatch is detected and `runtime.autoRebuild` is `true`
- **AND** no resolved-vs-terminal divergence is detected
- **THEN** the scoped rebuild SHALL run unattended using the resolved runtime's family
- **AND** the outcome SHALL be recorded in the doctor log

#### Scenario: autoRebuild abstains under divergence

- **WHEN** an ABI mismatch is detected and `runtime.autoRebuild` is `true`
- **AND** the visibility check has detected a probe-discovered installation diverging from the
  resolved runtime
- **THEN** no unattended rebuild SHALL run
- **AND** the reconciliation SHALL be offered interactively instead

#### Scenario: Pre-spawn check is cached

- **WHEN** a pi session spawns and the stat signature of every manifest-listed compiled-module
  file and the resolved ABI are unchanged since the last check
- **THEN** the cached verdict SHALL be used without a discovery re-walk

#### Scenario: In-place rebuild invalidates the cache

- **WHEN** a manifest-listed compiled-module file's stat signature changes (e.g. an external
  `npm rebuild` rewrote it) without any tree-shape change
- **THEN** the next pre-spawn check SHALL detect the drift and re-evaluate the module against the
  resolved ABI

### Requirement: Resolved spawn runtime visibility

The Doctor SHALL display the ladder-resolved spawn runtime — binary path, version, ABI, and
classification source — beside every other Node installation the probes discover (`PATH`, login
shell, version-manager defaults), with a `node -v` compare remedy inviting the user to check
their interactive terminal (which is unobservable from a service context). When the resolved
runtime exceeds the dashboard's tested engines cap, the Doctor SHALL note the excess as
informational, not a failure. This spawn-runtime row is distinct from the system-Node detection
governed by "System Node detection matches the server accept-set" — that requirement continues to
govern server-usability reporting; this row reports the pi-spawn axis.

#### Scenario: Resolved runtime row is present

- **WHEN** the Doctor runs after a successful ladder resolution
- **THEN** the report SHALL contain a row naming the resolved binary path, Node version, ABI, and
  ladder source (override / user / managed / own runtime)

#### Scenario: Probe divergence is surfaced

- **WHEN** a probe-discovered Node installation (`PATH`, login shell, or version-manager default)
  differs from the resolved spawn runtime
- **THEN** the Doctor SHALL show both, include the `node -v` compare remedy, and point at the
  config override as the deterministic escape hatch

#### Scenario: Above-cap runtime is informational

- **WHEN** the resolved spawn runtime's major version is at or above the dashboard's engines cap
- **THEN** the Doctor SHALL note it exceeds the dashboard-tested range
- **AND** the row status SHALL NOT be an error
