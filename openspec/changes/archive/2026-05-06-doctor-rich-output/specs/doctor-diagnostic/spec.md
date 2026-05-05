## ADDED Requirements

### Requirement: Section taxonomy on every check
Every `DoctorCheck` SHALL carry a `section` field whose value is one of `runtime`, `pi-tooling`, `server`, `setup`, or `diagnostics`. The mapping from check name to section SHALL be defined in a single shared table consumed by every renderer.

#### Scenario: Runtime checks are tagged runtime
- **WHEN** the doctor produces checks named `Electron`, `System Node.js`, `Bundled Node.js`, or `Bundled npm`
- **THEN** each of those checks SHALL have `section: "runtime"`

#### Scenario: pi-tooling checks are tagged pi-tooling
- **WHEN** the doctor produces checks named `pi CLI` or `openspec CLI`
- **THEN** each of those checks SHALL have `section: "pi-tooling"`

#### Scenario: Server-related checks are tagged server
- **WHEN** the doctor produces checks named `Dashboard server code`, `Offline packages bundle`, `TypeScript loader (tsx)`, `Dashboard server`, `Server log (~/.pi-dashboard/server.log)`, or `Server launch test`
- **THEN** each of those checks SHALL have `section: "server"`

#### Scenario: Setup checks are tagged setup
- **WHEN** the doctor produces checks named `Setup wizard` or `API key`
- **THEN** each of those checks SHALL have `section: "setup"`

#### Scenario: Managed-install check is tagged diagnostics
- **WHEN** the doctor produces the `Managed install (~/.pi-dashboard)` check
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
- **THEN** the section tables SHALL appear in the fixed order: runtime, pi-tooling, server, setup, diagnostics
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
- **THEN** the section SHALL display tables in the order: runtime, pi-tooling, server, setup, diagnostics
- **AND** sections that have zero checks in the response SHALL not be rendered

#### Scenario: Re-run refreshes the report
- **WHEN** the user clicks `[Re-run]`
- **THEN** the client SHALL re-issue `GET /api/doctor` and re-render the result with the new `generatedAt`

#### Scenario: Copy as Markdown writes to clipboard
- **WHEN** the user clicks `[Copy as Markdown]` on the Diagnostics section
- **THEN** the client SHALL write the Markdown rendering of the current report to the system clipboard
