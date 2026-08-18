# pi-runtime-selection Specification

## Purpose
TBD - created by archiving change select-pi-runtime-install. Update Purpose after archive.
## Requirements
### Requirement: Candidate pi install discovery
The server SHALL enumerate every discoverable pi install location and report each
one's resolved path and version without spawning the binary.

#### Scenario: Enumerate all locations
- **WHEN** `GET /api/pi/installs` is called
- **THEN** the response SHALL contain one entry per candidate location — the
  `bare-import` anchor, the dashboard-managed install, npm-global / `PATH`, the
  repo-root `node_modules` in a dev checkout, and any active override
- **AND** each entry SHALL carry a stable key, a human label, the package
  directory, and the version read from that location's `package.json`

#### Scenario: Each candidate carries per-consumer entry paths
- **WHEN** a candidate is returned
- **THEN** it SHALL carry a spawn entry path and a module entry path in addition
  to its package directory
- **AND** each entry path SHALL be a file, never a directory

#### Scenario: Managed install is located inside node_modules
- **WHEN** the dashboard-managed candidate is enumerated
- **THEN** its version SHALL be read from the pi package inside the managed
  `node_modules` directory, not from the managed root directory itself

#### Scenario: Resolved install outside every known location is still representable
- **WHEN** the strategy chain resolves pi from a location matching no enumerated
  candidate
- **THEN** that resolution SHALL be returned as an additional read-only candidate
  carrying its own version, so the active selection is never versionless

#### Scenario: Version read without spawning pi
- **WHEN** a candidate's version is determined
- **THEN** it SHALL be read from the location's `package.json`
- **AND** no `pi --version` subprocess SHALL be spawned

#### Scenario: Candidate location not present
- **WHEN** a candidate location does not exist on disk
- **THEN** its entry SHALL report a null path and null version rather than being
  omitted from the response

#### Scenario: Floor evaluation per candidate
- **WHEN** a candidate's version is below `piCompatibility.minimum`
- **THEN** its entry SHALL be flagged as not meeting the floor, naming the
  required minimum version

#### Scenario: Candidate whose version cannot be read
- **WHEN** a candidate resolves to an executable with no readable package version
- **THEN** it SHALL be reported with an unknown version rather than omitted
- **AND** it SHALL NOT be flagged as failing the floor
- **AND** it SHALL remain selectable
- **AND** its row SHALL carry an explicit warning that the version is unknown and
  has not been checked against the compatibility floor

### Requirement: Independent selection per consumer
The dashboard SHALL let the user select the pi install for each of its two
consumers independently: the `pi` executor spawned for sessions, and the
`pi-coding-agent` module imported by the server.

#### Scenario: Linked selection sets both consumers
- **WHEN** "Keep both in sync" is enabled and the user selects a candidate
- **THEN** both the spawn consumer and the import consumer SHALL be set to that
  candidate

#### Scenario: Sync is enabled by default
- **WHEN** the Pi runtime section is opened, no prior selection exists, and both
  consumers resolve to the same install
- **THEN** "Keep both in sync" SHALL be enabled

#### Scenario: Unconfigured install whose two chains disagree
- **WHEN** no override exists but the two consumers resolve to different installs
- **THEN** the section SHALL open with sync disabled and the divergence surfaced
- **AND** it SHALL NOT report the consumers as agreeing

#### Scenario: Unlinked selection permits a mismatch
- **WHEN** "Keep both in sync" is disabled and the user selects a candidate in
  one consumer column
- **THEN** only that consumer SHALL change and the other SHALL retain its
  selection

#### Scenario: Automatic is a selectable choice
- **WHEN** the candidate list is rendered
- **THEN** it SHALL include an `Automatic` entry that displays the version and
  location the strategy chain currently resolves to
- **AND** selecting it SHALL clear that consumer's override rather than pinning
  a path

#### Scenario: Selection persists through the tool-override store
- **WHEN** a selection is applied
- **THEN** the spawn choice SHALL be written as the `pi` tool override using the
  candidate's spawn entry path, and the import choice as the `pi-coding-agent`
  tool override using the candidate's module entry path
- **AND** an `Automatic` choice SHALL delete that tool's override
- **AND** no new persistence file or format SHALL be introduced

#### Scenario: Both consumers are written in one transaction
- **WHEN** a selection covering both consumers is applied
- **THEN** both overrides SHALL be persisted in a single transaction
- **AND** a failure during the write SHALL leave neither consumer changed

#### Scenario: Sync state is derived, not stored
- **WHEN** the Pi runtime section is rendered
- **THEN** "Keep both in sync" SHALL be shown as enabled exactly when both
  consumers resolve to the same package directory, compared after resolving
  symlinks
- **AND** no persisted field SHALL record the sync state

#### Scenario: Consumers resolving to different entries of one install are in sync
- **WHEN** the spawn consumer resolves to an install's executable entry and the
  import consumer resolves to the same install's module entry
- **THEN** the two SHALL be treated as in sync, because the entry paths differ by
  design and only the package directory identifies the install

#### Scenario: Pre-existing single-consumer override opens diverged
- **WHEN** an override exists for one consumer only, set before this feature
  existed
- **THEN** the section SHALL open with "Keep both in sync" disabled and the
  divergence surfaced
- **AND** no selection SHALL be silently overwritten on open

### Requirement: Divergence is surfaced and never accidental
The dashboard SHALL make a spawn/import version mismatch visible whenever one
exists, and SHALL require a deliberate action to create one.

#### Scenario: Existing divergence is reported
- **WHEN** the spawn consumer and the import consumer resolve to different
  versions
- **THEN** the Pi runtime section SHALL display a divergence banner naming both
  versions and stating that package installs and model lists derive from the
  import side

#### Scenario: Divergence is computed over the two consumers only
- **WHEN** an enumerated install other than the two selected consumers holds a
  different version
- **THEN** that SHALL NOT be reported as consumer divergence
- **AND** any broader install-set divergence reported by the doctor SHALL be
  labelled distinctly from consumer divergence

#### Scenario: Different installs holding the same version still diverge
- **WHEN** the two consumers resolve to different installs that happen to carry
  the same version
- **THEN** they SHALL be reported as diverged
- **AND** the sync state and the divergence surfaces SHALL agree with each other

#### Scenario: Divergence cannot be created while linked
- **WHEN** "Keep both in sync" is enabled and a selection is applied through the
  runtime picker
- **THEN** no selection SHALL produce a spawn/import mismatch
- **AND** a failure during the write SHALL leave both consumers unchanged rather
  than applying one of them

#### Scenario: Mismatch created outside the picker is detected, not prevented
- **WHEN** a mismatch is introduced by editing the override file directly or by
  the single-tool override route
- **THEN** the picker SHALL surface it as divergence on next read rather than
  claiming the consumers agree

#### Scenario: Mismatch is restated before it is written
- **WHEN** the user applies a selection that would leave the two consumers on
  different versions
- **THEN** the confirmation SHALL state the resulting mismatch before the write
  proceeds

#### Scenario: Divergence is observable outside the UI
- **WHEN** the two consumers resolve to different versions
- **THEN** the divergence SHALL be reported by `/api/health` and by the doctor
  `pi-resolution` module

### Requirement: Below-floor candidates are shown but not selectable
The dashboard SHALL render candidates that fail the compatibility floor, with
the reason, and SHALL refuse to select them.

#### Scenario: Below-floor candidate is disabled with a reason
- **WHEN** a candidate's version is below `piCompatibility.minimum`
- **THEN** its row SHALL render in a disabled state naming the required minimum
  and stating that the bridge extension will not load
- **AND** selecting it SHALL have no effect on either consumer

### Requirement: Apply semantics are stated and honoured
The dashboard SHALL state when a runtime change takes effect, separately for
each consumer.

#### Scenario: Spawn change does not affect running sessions
- **WHEN** the spawn selection is applied
- **THEN** sessions started afterwards SHALL use the new binary
- **AND** sessions already running SHALL continue on the binary they were
  spawned with

#### Scenario: Running sessions on the previous version are counted
- **WHEN** the spawn selection is applied and sessions whose version is known are
  still running on the previous version
- **THEN** the section SHALL report how many sessions are still on it

#### Scenario: Sessions with an unrecorded runtime are reported separately
- **WHEN** running sessions exist whose pi version was never recorded
- **THEN** they SHALL NOT be counted as running the previous version
- **AND** they SHALL be reported separately as sessions with an unknown runtime

#### Scenario: Import change requires a restart
- **WHEN** the import selection is applied
- **THEN** the dashboard SHALL state that a server restart is required and offer
  to perform it

### Requirement: Every spawn mechanism honours the selected runtime
The selected spawn runtime SHALL be used regardless of which spawn mechanism
starts the session.

#### Scenario: tmux sessions use the resolved invocation
- **WHEN** a session is started through the tmux mechanism
- **THEN** the command SHALL invoke the registry-resolved pi argument vector
- **AND** it SHALL NOT rely on the shell's `PATH` to choose the binary

#### Scenario: Resolved invocation is passed without shell interpretation
- **WHEN** the resolved pi invocation or the workspace path contains shell
  metacharacters or spaces
- **THEN** each value SHALL be passed as a single literal argument
- **AND** no additional command SHALL execute

#### Scenario: Node-wrapped invocations keep their interpreter
- **WHEN** the resolved invocation names an interpreter and a script rather than
  a single executable
- **THEN** both SHALL be carried into the spawn
- **AND** the spawn SHALL NOT depend on the script's shebang resolving an
  interpreter from the session's own environment

#### Scenario: Headless and terminal mechanisms are unchanged
- **WHEN** a session is started through the headless or Windows Terminal
  mechanism
- **THEN** it SHALL continue to resolve pi through the tool registry as it does
  today

#### Scenario: WSL sessions resolve pi inside WSL
- **WHEN** a session is started through the WSL-tmux mechanism
- **THEN** pi SHALL be resolved inside the WSL environment rather than from a
  host-resolved path
- **AND** the runtime selection UI SHALL state that WSL sessions use the
  WSL-side pi

### Requirement: Runtime endpoints are network-guarded
The runtime selection endpoints SHALL be guarded exactly as the existing tool
endpoints are.

#### Scenario: Guard applied to runtime routes
- **WHEN** the runtime discovery or selection endpoint is called
- **THEN** it SHALL pass through the same network guard applied to the existing
  tool routes

### Requirement: A persisted selection takes effect without a rescan
A selection written through the runtime endpoint SHALL be reflected by the next
resolution.

#### Scenario: Resolution reflects the new selection immediately
- **WHEN** a selection is persisted through the runtime endpoint
- **THEN** the next resolution of each affected consumer SHALL return the newly
  selected install
- **AND** it SHALL NOT return a previously cached resolution

### Requirement: Overrides are validated before they are written
The server SHALL reject a runtime override path that does not resolve to a
usable pi install.

#### Scenario: Non-existent path rejected
- **WHEN** an override path that does not exist on disk is submitted
- **THEN** the server SHALL reject the write and report the reason
- **AND** the previously active selection SHALL remain in effect

#### Scenario: Directory path rejected
- **WHEN** an override path pointing at a directory is submitted for either pi
  consumer
- **THEN** the server SHALL reject the write and report the reason

#### Scenario: Path without a readable package version rejected
- **WHEN** an override path exists but no pi `package.json` version can be read
  from it
- **THEN** the server SHALL reject the write and report the reason

### Requirement: Electron hosts are warned before leaving the bundle
The dashboard SHALL warn when a selection points outside the Electron app
bundle, without forbidding it.

#### Scenario: Non-bundled selection on an Electron host
- **WHEN** the dashboard runs as the Electron desktop app and the user selects a
  candidate outside the app bundle
- **THEN** a warning SHALL state that app updates will no longer update pi
- **AND** the selection SHALL remain permitted

