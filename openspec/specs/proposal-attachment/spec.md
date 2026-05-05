## Purpose

Persistent per-session proposal focus with attach/detach, server-side auto-attach from activity detection, and auto-naming of sessions from the attached proposal.

## ADDED Requirements

### Requirement: AttachedProposal field on DashboardSession
The `DashboardSession` type SHALL include an optional `attachedProposal?: string | null` field representing the currently focused OpenSpec change name for this session.

#### Scenario: Session with attached proposal
- **WHEN** a session has `attachedProposal` set to `"add-auth"`
- **THEN** the OpenSpec section SHALL show only the `"add-auth"` change

#### Scenario: Session without attached proposal
- **WHEN** a session has `attachedProposal` undefined or null
- **THEN** the OpenSpec section SHALL show all changes

### Requirement: Manual attach via browser
The browser SHALL send an `attach_proposal` message to attach a proposal to a session. The server SHALL set `session.attachedProposal` to the given `changeName` and broadcast a `session_updated` message. Attach is triggered via a combo box dropdown on the session card instead of per-change "Attach" buttons.

#### Scenario: User selects change from combo box
- **WHEN** the user selects `"add-auth"` from the attach combo box on session `"s1"`
- **THEN** the browser SHALL send `{ type: "attach_proposal", sessionId: "s1", changeName: "add-auth" }`
- **AND** the server SHALL set `session.attachedProposal = "add-auth"` and broadcast the update

### Requirement: Manual detach via browser
The browser SHALL send a `detach_proposal` message to clear the attached proposal. The server SHALL set `session.attachedProposal` to null, clear `openspecPhase` and `openspecChange` to null, and broadcast a `session_updated` message. The session name SHALL NOT be reverted.

#### Scenario: User clicks Detach
- **WHEN** the user clicks the "Detach" button on session `"s1"`
- **THEN** the browser SHALL send `{ type: "detach_proposal", sessionId: "s1" }`
- **AND** the server SHALL set `session.attachedProposal = null`, `session.openspecPhase = null`, `session.openspecChange = null` and broadcast the update
- **AND** the session name SHALL remain unchanged

#### Scenario: Re-detection after detach
- **WHEN** a proposal is detached from a session
- **AND** the session later receives new `openspec_activity_update` messages with both phase and changeName
- **THEN** the server SHALL auto-attach the newly detected change

### Requirement: DetectedActivity includes active flag
The `DetectedActivity` interface SHALL include an `isActive` boolean field that indicates whether the detected activity represents an active operation (write, CLI command) or a passive operation (read). Read operations return `isActive: false`, write and bash/CLI operations return `isActive: true`. Phase-only detections (SKILL.md reads) omit `isActive`.

#### Scenario: Read operation returns isActive false
- **WHEN** `detectOpenSpecActivity` is called with tool "read" and a path matching `openspec/changes/<name>/`
- **THEN** the result SHALL include `isActive: false`

#### Scenario: Write operation returns isActive true
- **WHEN** `detectOpenSpecActivity` is called with tool "write" and a path matching `openspec/changes/<name>/`
- **THEN** the result SHALL include `isActive: true`

#### Scenario: Bash CLI command returns isActive true
- **WHEN** `detectOpenSpecActivity` is called with tool "bash" and a command containing an openspec CLI invocation with a change name
- **THEN** the result SHALL include `isActive: true`

#### Scenario: Phase-only detection omits isActive
- **WHEN** `detectOpenSpecActivity` is called with a SKILL.md read (phase detection only, no changeName)
- **THEN** the result SHALL NOT include `isActive`

### Requirement: Server-side auto-attach from activity detection
When the server receives `openspec_activity_update` messages, it SHALL update the session's `openspecPhase` and `openspecChange` fields independently. After each update, if the session has `openspecChange` set, no `attachedProposal`, and the detected activity has `isActive: true`, the server SHALL automatically set `attachedProposal` to the session's accumulated `openspecChange` value. Read-only operations (`isActive: false`) update tracking fields but SHALL NOT trigger auto-attach.

#### Scenario: Auto-attach on active write operation
- **WHEN** the server detects a write to `openspec/changes/add-auth/proposal.md` for a session with `attachedProposal = null`
- **THEN** the server SHALL set `session.attachedProposal = "add-auth"` and broadcast `session_updated`

#### Scenario: Auto-attach on bash CLI operation
- **WHEN** the server detects `openspec new change "add-auth"` for a session with `attachedProposal = null`
- **THEN** the server SHALL set `session.attachedProposal = "add-auth"` and broadcast `session_updated`

#### Scenario: No auto-attach on read operation
- **WHEN** the server detects a read of `openspec/changes/add-auth/proposal.md` for a session with `attachedProposal = null`
- **THEN** `openspecChange` SHALL update to "add-auth" but `attachedProposal` SHALL remain unset

#### Scenario: No auto-attach when proposal already attached
- **WHEN** the server receives `openspec_activity_update` with `changeName: "other-change"` for a session with `attachedProposal = "add-auth"`
- **THEN** the server SHALL NOT change `attachedProposal`

#### Scenario: No auto-attach when only phase detected
- **WHEN** the server receives `openspec_activity_update` with `phase: "explore"` but no `changeName` for a session with `openspecChange = null`
- **THEN** the server SHALL NOT set `attachedProposal`

### Requirement: Case-insensitive tool name matching in activity detector
The `detectOpenSpecActivity` function SHALL match tool names case-insensitively. Pi emits lowercase tool names (`"read"`, `"bash"`, `"write"`) and the detector SHALL handle any casing.

#### Scenario: Lowercase tool name from pi
- **WHEN** a `tool_execution_start` event arrives with `toolName: "read"` and a path matching an openspec skill file
- **THEN** the detector SHALL return the detected phase

#### Scenario: Capitalized tool name
- **WHEN** a `tool_execution_start` event arrives with `toolName: "Read"` and a path matching an openspec change file
- **THEN** the detector SHALL return the detected change name

#### Scenario: Lowercase bash with openspec CLI command
- **WHEN** a `tool_execution_start` event arrives with `toolName: "bash"` and a command containing `openspec status --change "add-auth"`
- **THEN** the detector SHALL return `{ changeName: "add-auth" }`

### Requirement: Detect change name from openspec new change command
The activity detector SHALL detect the change name from `openspec new change "name"` commands using positional arguments, not just the `--change` flag pattern.

#### Scenario: openspec new change with quoted name
- **WHEN** a bash tool call contains `openspec new change "add-auth"`
- **THEN** the detector SHALL return `{ changeName: "add-auth" }`

#### Scenario: openspec new change with unquoted name
- **WHEN** a bash tool call contains `openspec new change add-auth`
- **THEN** the detector SHALL return `{ changeName: "add-auth" }`

### Requirement: Auto-name session on attach
When a proposal is attached (manually or automatically) and the session's `name` field is empty/undefined, the server SHALL set `session.name` to the proposal name and send a `rename_session` message to the extension so pi's internal session name is updated.

#### Scenario: Auto-name on attach when name is empty
- **WHEN** a proposal `"add-auth"` is attached to a session with `name = undefined`
- **THEN** the server SHALL set `session.name = "add-auth"` and send `rename_session` to the extension

#### Scenario: No auto-name when name already set
- **WHEN** a proposal `"add-auth"` is attached to a session with `name = "my custom name"`
- **THEN** the server SHALL NOT change `session.name`

#### Scenario: Detach does not revert name
- **WHEN** a proposal is detached from a session that was auto-named
- **THEN** the session name SHALL remain as the proposal name (not reverted)

### Requirement: Activity detector rejects flag-shaped change names
`detectOpenSpecActivity` SHALL NOT return a `changeName` whose first character is `-`. This requirement is now implemented as a strict subset of the slug-shape rule (`^[a-z][a-z0-9-]{0,63}$`): a leading `-` fails the `[a-z]` first-character class. The implementation SHALL collapse both checks into a single call to `isValidOpenSpecChangeSlug`. The behavior described below remains binding for compatibility with prior fixtures.

#### Scenario: openspec archive --help is ignored
- **WHEN** `detectOpenSpecActivity` is called with tool `"bash"` and command `"openspec archive --help"`
- **THEN** the result SHALL be `null`

#### Scenario: openspec new change --help is ignored
- **WHEN** `detectOpenSpecActivity` is called with tool `"bash"` and command `"openspec new change --help"`
- **THEN** the result SHALL be `null`

#### Scenario: --change flag followed by another flag is ignored
- **WHEN** `detectOpenSpecActivity` is called with tool `"bash"` and command `"openspec foo --change --help"`
- **THEN** the result SHALL be `null`

#### Scenario: Real change names are still extracted
- **WHEN** `detectOpenSpecActivity` is called with tool `"bash"` and command `"openspec archive add-auth"`
- **THEN** the result SHALL be `{ changeName: "add-auth", isActive: true }`

#### Scenario: Quoted change names are still extracted
- **WHEN** `detectOpenSpecActivity` is called with tool `"bash"` and command `'openspec archive "add-auth"'`
- **THEN** the result SHALL be `{ changeName: "add-auth", isActive: true }`

### Requirement: Content-window header surfaces attached-proposal artifact summary

The content-window header (rendered by `SessionHeader.tsx`, both the desktop branch and the `MobileHeader` sub-component) SHALL surface a glanceable summary of the attached OpenSpec change's lifecycle whenever `session.attachedProposal` is set AND a matching entry exists in the polled `openspecChanges` list.

The summary SHALL consist of:

1. The existing paperclip + change-name chip (unchanged).
2. An artifact-letters pill (the existing `ArtifactLettersButton` from `openspec-helpers.tsx`) rendering one letter per artifact (`P`, `D`, `T`, `S`) colored by the artifact's `status` field (green=`done`, yellow=`ready`, muted=`missing` or unknown). The whole pill SHALL be a single button that opens the `proposal` artifact for the attached change.
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

### Requirement: SessionHeader accepts an artifact-reader callback

The `SessionHeader` component SHALL accept an optional `onReadArtifact?: (changeName: string, artifactId: string) => void` prop. When provided, it SHALL be wired into the artifact-letters pill rendered inside the attached-proposal summary on both desktop and mobile branches. The dashboard root (`App.tsx`) SHALL pass the existing `useContentViews` artifact-reader callback as this prop so the pill opens the same in-content artifact reader used by `FolderOpenSpecSection` and `SessionOpenSpecActions`.

#### Scenario: App threads the callback into SessionHeader

- **GIVEN** the dashboard renders `<SessionHeader>` for the currently selected session
- **WHEN** the user clicks the artifact-letters pill in the header
- **THEN** the same artifact-reader content view SHALL open as when the user clicks the pill in `FolderOpenSpecSection`

### Requirement: Activity detector rejects non-slug change names
`detectOpenSpecActivity` SHALL only return a `DetectedActivity` with a `changeName` when the captured token matches the OpenSpec change-slug shape: lowercase, must start with a letter, kebab-case allowed, max 64 characters (regex `^[a-z][a-z0-9-]{0,63}$`). When a path-based regex (`openspec/changes/<name>/...`) or a CLI regex (`openspec archive`, `openspec new change`, `--change`) captures a token failing this shape, the function SHALL return `null` (for path/CLI captures whose only useful output is `changeName`) or omit `changeName` from the result.

This subsumes the existing `-`-prefix guard: a leading `-` already fails the `[a-z]` first-character rule. The shape predicate SHALL be exposed as `isValidOpenSpecChangeSlug(name: string): boolean` from the same module so other server code can reuse it.

#### Scenario: UUID-shaped path is ignored
- **WHEN** `detectOpenSpecActivity` is called with tool `"write"` and `path: "openspec/changes/019df0aa-1234-5678-9abc-def012345678/proposal.md"`
- **THEN** the result SHALL be `null`

#### Scenario: UUID-shaped CLI argument is ignored
- **WHEN** `detectOpenSpecActivity` is called with tool `"bash"` and command `'openspec archive 019df0aa-1234-5678-9abc-def012345678'`
- **THEN** the result SHALL be `null`

#### Scenario: Uppercase change name is ignored
- **WHEN** `detectOpenSpecActivity` is called with tool `"read"` and `path: "openspec/changes/AddAuth/proposal.md"`
- **THEN** the result SHALL be `null`

#### Scenario: Underscore-containing token is ignored
- **WHEN** `detectOpenSpecActivity` is called with tool `"bash"` and command `'openspec archive add_auth'`
- **THEN** the result SHALL be `null`

#### Scenario: Digit-prefixed token is ignored
- **WHEN** `detectOpenSpecActivity` is called with tool `"bash"` and command `'openspec archive 1bad'`
- **THEN** the result SHALL be `null`

#### Scenario: Token exceeding length cap is ignored
- **WHEN** `detectOpenSpecActivity` is called with a `changeName` candidate longer than 64 characters
- **THEN** the result SHALL be `null`

#### Scenario: Valid kebab-case slug is still extracted
- **WHEN** `detectOpenSpecActivity` is called with tool `"bash"` and command `'openspec archive add-auth'`
- **THEN** the result SHALL be `{ changeName: "add-auth", isActive: true }`

#### Scenario: Valid slug with digits is still extracted
- **WHEN** `detectOpenSpecActivity` is called with tool `"bash"` and command `'openspec archive valid-name-123'`
- **THEN** the result SHALL be `{ changeName: "valid-name-123", isActive: true }`

### Requirement: Auto-attach branch re-validates change-name shape
The server's auto-attach branch in `event-wiring.ts` SHALL re-validate `detected.changeName` against `isValidOpenSpecChangeSlug` before stamping `session.openspecChange`, setting `session.attachedProposal`, or sending `rename_session`. When the predicate returns `false`, the auto-attach branch SHALL skip all three mutations for that event. This is intentional defense-in-depth so a future detector regression cannot rename a session to junk.

User-initiated attach paths (`handleAttachProposal`, REST `POST /api/session/:id/attach-proposal`) operate on names from a server-curated list and SHALL NOT add this re-validation.

#### Scenario: Detector returns valid slug — auto-attach proceeds
- **WHEN** `detectOpenSpecActivity` returns `{ changeName: "add-auth", isActive: true }` for a session with `attachedProposal = null` and `name` empty
- **THEN** the server SHALL set `session.openspecChange = "add-auth"`, `session.attachedProposal = "add-auth"`, send `rename_session{ name: "add-auth" }`, and broadcast `session_updated`

#### Scenario: Future detector regression returns junk — rename site refuses
- **WHEN** `detectOpenSpecActivity` returns `{ changeName: "019df0aa-1234-5678-9abc-def012345678", isActive: true }` for a session with `attachedProposal = null` and `name` empty (simulating a detector bug)
- **THEN** the server SHALL NOT mutate `session.openspecChange`, `session.attachedProposal`, or `session.name`, and SHALL NOT send `rename_session`

#### Scenario: Manual attach via browser is unaffected
- **WHEN** the browser sends `{ type: "attach_proposal", sessionId: "s1", changeName: "AnyShape" }`
- **THEN** the server SHALL set `session.attachedProposal = "AnyShape"` exactly as today, with no slug-shape validation
