# craft-live-control Specification

## Purpose
Let an agent session drive a Craft document that is open in a dashboard editor pane, live, through the app's own control protocol, so edits land in the open document without a reload and the user keeps their cursor, view and undo history.

## Requirements

### Requirement: The agent addresses an open document by path
The plugin SHALL give agent sessions a tool that runs one control-protocol method, with optional parameters, against a Craft document identified by its workspace path. A relative path SHALL be resolved against the session's working directory. The tool SHALL return the app's result marked as app output, or an error with a code and a message. It SHALL NOT edit the file on disk itself, and it SHALL NOT fall back to headless editing.

#### Scenario: Document open in the pane
- **WHEN** the user has `logo.svg` open and visible in VectorCraft in session S's editor pane and S's agent runs `engine.execute` with a command that adds a rectangle
- **THEN** the rectangle appears in the open editor without a reload and the tool returns the app's result

#### Scenario: Document not open
- **WHEN** S's agent targets `report.docx` and no editor instance of S shows it
- **THEN** the tool returns `not-open` and the file on disk is unchanged

### Requirement: Only eligible editor instances can run a request
An editor instance SHALL be eligible only when all of these hold:
- it shows the requested file;
- it belongs to the requesting session;
- it has finished opening;
- its app and build support live control;
- it is visible to the user;
- its browser has full operating rights.

When none is eligible, the tool SHALL return the most specific reason: `not-visible`, `not-ready`, `unsupported` or `not-open`.

#### Scenario: Observe-only device
- **WHEN** `logo.svg` is open in session S only on an observe-only device
- **THEN** the tool returns `not-open` and the document there is unchanged

#### Scenario: Another session's editor
- **WHEN** `logo.svg` is open only under session T and session S's agent targets it
- **THEN** the tool returns `not-open`

#### Scenario: Editor in a background tab
- **WHEN** `logo.svg` is open in session S but its pane tab is not the active one
- **THEN** the tool returns `not-visible` and nothing runs

#### Scenario: Editor still opening
- **WHEN** the agent sends a request while the only matching editor has not finished opening the document
- **THEN** the tool returns `not-ready` and nothing runs

### Requirement: A request executes in exactly one editor instance
A request SHALL run in at most one eligible instance. When several are eligible, it SHALL run in the one the user focused most recently, provided that focus is recent. Otherwise the tool SHALL return `ambiguous` and run nothing. A reply SHALL be accepted only from the instance the request was sent to.

#### Scenario: Same file open on two devices
- **WHEN** `logo.svg` is open and visible in session S on a laptop (focused a minute ago) and a phone (focused an hour ago), and the agent runs a command
- **THEN** the command runs only in the laptop's editor

#### Scenario: Unfocused copies
- **WHEN** `logo.svg` is open in session S on two devices, neither focused recently, and the agent runs a command
- **THEN** the tool returns `ambiguous` and neither document changes

#### Scenario: Reply from another client
- **WHEN** a client that was not sent the request answers it
- **THEN** that answer is ignored

### Requirement: Live control is opt-in per app
Only apps whose verified web build provides a control transport SHALL accept requests. For any other app, and for an installed build that lacks the transport, the tool SHALL return `unsupported`. Enabling an app SHALL require its web build to pass the live-control checks under the production frame isolation.

#### Scenario: App without a control transport
- **WHEN** the agent targets a `.docx` open in WordCraft, whose verified build has no control transport
- **THEN** the tool returns `unsupported` and nothing is sent to the editor

#### Scenario: Method the app's transport does not offer
- **WHEN** the agent requests `ui.screenshot` from an app whose page API runs engine commands only
- **THEN** the tool returns `unsupported` and nothing is sent to the editor

#### Scenario: Outdated installed build
- **WHEN** the profile enables live control but the installed build predates the app's control transport
- **THEN** the tool returns `unsupported` with a message naming the update

### Requirement: The host refuses requests that leave the document
The host SHALL run only methods and app commands on the app's list for its verified build. It SHALL answer `denied` to anything else, including commands that open, create, close or revert documents, quit, open URLs or print. A download to the device that the user did not just initiate SHALL require the user's confirmation.

#### Scenario: Agent asks the app to open another file
- **WHEN** the agent runs `engine.execute` with a command that opens a file
- **THEN** the tool returns `denied` and the editor is unchanged

#### Scenario: Agent-triggered export
- **WHEN** an agent request makes the app export a file that would be downloaded to the device, with no recent user input in the editor
- **THEN** the user is asked whether to allow the download, and nothing is downloaded unless they allow it

#### Scenario: User's own export
- **WHEN** the user clicks the app's export command
- **THEN** the export is downloaded to the device as before, without an extra question

### Requirement: Agent saves meet the same dialogs as user saves
An agent-triggered save SHALL follow exactly the routing of the user's save command, including:
- the save-target choice;
- the first-overwrite notice;
- the sibling question;
- conflict handling.

The tool SHALL NOT wait for the user to answer a dialog.

#### Scenario: Agent save after an external change
- **WHEN** the file changed on disk since the editor's snapshot and the agent's save would overwrite it
- **THEN** nothing is written, the user sees the conflict choices, and the editor's state lists the save as a conflict

### Requirement: The agent can read save outcomes afterwards
The agent SHALL be able to read the editor's unsaved state and the outcome of each save made since its request, also when the editor is no longer visible.

#### Scenario: Agent save in an app that saves its own format
- **WHEN** the agent saves in VectorCraft editing `logo.svg` and the user then confirms creating `logo.vectorcraft`
- **THEN** `logo.svg` is not overwritten, and reading the editor's state lists a sibling save after the request, with the tab still unsaved

#### Scenario: Save not performed
- **WHEN** the agent requests a save and the user cancels the app's own save dialog
- **THEN** reading the editor's state reports that no save has happened since the request

### Requirement: Agent edits are never silently lost
Any agent request that may change the document SHALL mark the editor as holding unsaved edits from the moment it is sent, whatever its result, until the tab's own file is saved with those edits. The existing unsaved-edit guards therefore apply.

#### Scenario: App reports clean after an agent edit
- **WHEN** the agent changed the document and the app's own signals then report no unsaved changes
- **THEN** the tab still reports unsaved edits until the tab's own file is saved

#### Scenario: Close after an agent edit
- **WHEN** the agent added a rectangle and the user closes the tab without saving
- **THEN** the user is asked to confirm discarding unsaved edits

### Requirement: Requests are bounded
The host SHALL enforce:
- one request in flight per editor instance (`busy`);
- a time limit per request (`timeout`);
- a size limit on replies (`reply_too_large`);
- a rate limit per session (`rate_limited`).

A `timeout` SHALL be reported as an unknown outcome, not as a failure.

#### Scenario: Concurrent requests
- **WHEN** a second request for the same editor arrives while one is running
- **THEN** the second returns `busy`

#### Scenario: Slow command
- **WHEN** the app has not answered within the time limit
- **THEN** the tool returns `timeout`, stating that the change may still have been applied

### Requirement: Agent edits are visible to the user and stay theirs to undo
While a request runs, the editor tab SHALL show that the agent is editing, naming the method. The tab SHALL keep a log of recent agent requests with time, method and outcome. Agent requests SHALL NOT block the user's own input. Agent edits SHALL land in the app's own undo history.

#### Scenario: User watches an agent edit
- **WHEN** the agent runs a command in the open editor
- **THEN** the tab shows an "agent is editing" indicator naming the method until the reply, and the request appears in the tab's agent log

#### Scenario: User undoes an agent edit
- **WHEN** the agent's command changed the document, the user made no edit since, and the user presses the app's undo shortcut
- **THEN** the agent's change is undone

### Requirement: App replies are treated as untrusted output
The tool SHALL accept a reply only when it is well-formed and within the size limit, and SHALL present it as app output, not as instructions. Screenshot replies SHALL be downscaled before the size check. The tab's agent log SHALL show the size and a short preview of each reply.

#### Scenario: Malformed reply
- **WHEN** the editor answers a request with a value that is not a well-formed reply
- **THEN** the tool returns an error and the malformed value is not passed to the agent
