## MODIFIED Requirements

### Requirement: Content-window header surfaces attached-proposal artifact summary

The content-window header (rendered by `SessionHeader.tsx`, both the desktop branch and the `MobileHeader` sub-component) SHALL surface a glanceable summary of the attached OpenSpec change's lifecycle whenever `session.attachedProposal` is set AND a matching entry exists in the polled `openspecChanges` list.

The summary SHALL consist of:

1. The existing paperclip + change-name chip (unchanged).
2. An artifact-letters pill (the existing `ArtifactLettersButton` from `openspec-helpers.tsx`) rendering one letter per artifact (`P`, `D`, `T`, `S`) colored by the artifact's `status` field (`--accent-green-text` = `done`, `--accent-yellow-text` = `ready`, `--text-secondary` = `missing` or unknown; `--text-muted` fails AA as readable text). The whole pill SHALL be a single button that opens the `proposal` artifact for the attached change.
3. A task counter `(completedTasks/totalTasks)` rendered immediately after the pill, only when `totalTasks > 0`.

When `session.attachedProposal` is set but no matching entry exists in `openspecChanges` (e.g. polling lag, just-attached state), the header SHALL render only the chip text and SHALL NOT render the pill or counter — preserving the pre-change behavior as the graceful degraded state.

The auto-detected `session.openspecChange` field SHALL NOT trigger this summary; the surface is reserved for the explicit user attach.

#### Scenario: Desktop header renders pill and counter for an attached change with task progress

- **GIVEN** a desktop session with `attachedProposal: "foo"`
- **AND** `openspecChanges` includes `{ name: "foo", artifacts: [{id:"proposal",status:"done"}, {id:"design",status:"ready"}, {id:"tasks",status:"missing"}, {id:"specs",status:"missing"}], completedTasks: 3, totalTasks: 12 }`
- **WHEN** `SessionHeader` is rendered
- **THEN** the desktop branch SHALL contain the chip text `"foo"`, the `artifact-letters-btn` pill, and a `(3/12)` counter

#### Scenario: Mobile header co-locates the pill inside the existing attached chip span

- **GIVEN** a mobile session with `attachedProposal: "foo"` and the same `openspecChanges` fixture as above
- **WHEN** `SessionHeader` is rendered
- **THEN** the `mobile-header-attached-chip` span SHALL contain both the change-name text and the `artifact-letters-btn` pill as descendants
- **AND** the counter `(3/12)` SHALL also appear inside or immediately adjacent to the chip

#### Scenario: Pill click opens the proposal artifact

- **GIVEN** a header with the artifact-letters pill rendered
- **WHEN** the user clicks the pill
- **THEN** `onReadArtifact` SHALL be invoked with `(changeName, "proposal")`

#### Scenario: Missing change in polled list — chip renders without pill

- **GIVEN** a session with `attachedProposal: "foo"` but `openspecChanges = []`
- **WHEN** `SessionHeader` is rendered
- **THEN** the chip text `"foo"` SHALL render
- **AND** no `artifact-letters-btn` element SHALL appear in the document
- **AND** no counter element SHALL appear in the document

#### Scenario: Counter is hidden when totalTasks is zero

- **GIVEN** a session with `attachedProposal: "foo"` and a matching change whose `totalTasks` is `0`
- **WHEN** `SessionHeader` is rendered
- **THEN** the artifact-letters pill SHALL render (subject to `artifacts.length > 0`)
- **AND** no counter text SHALL appear

#### Scenario: Auto-detected openspecChange does not trigger the summary

- **GIVEN** a session with `attachedProposal: null` and `openspecChange: "foo"` (auto-detected activity)
- **AND** `openspecChanges` contains a matching `"foo"` entry with artifacts and tasks
- **WHEN** `SessionHeader` is rendered
- **THEN** no `artifact-letters-btn` element SHALL appear in the header
- **AND** no counter element SHALL appear in the header
- **AND** the existing chip MUST NOT appear (since `attachedProposal` is null)
