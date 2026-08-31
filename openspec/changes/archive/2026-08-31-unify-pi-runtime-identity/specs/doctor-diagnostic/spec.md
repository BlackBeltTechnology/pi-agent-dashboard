# doctor-diagnostic Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
