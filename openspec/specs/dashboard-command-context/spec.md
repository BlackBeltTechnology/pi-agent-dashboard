# dashboard-command-context Specification

## Purpose

Hidden dashboard command registration and extension context capture for session control.

## Requirements

### Requirement: Hidden dashboard command registration
The bridge extension SHALL register a command named `__dashboard` via `pi.registerCommand()` during initialization. This command SHALL NOT have a description, ensuring it does not appear in user-facing command lists.

#### Scenario: Command registered on init
- **WHEN** the bridge extension initializes
- **THEN** a command named `__dashboard` SHALL be registered with `pi.registerCommand()`

#### Scenario: Command hidden from autocomplete
- **WHEN** the extension sends the commands list to the server
- **THEN** commands starting with `__` SHALL be filtered out from the list

### Requirement: ExtensionCommandContext capture
The `__dashboard` command handler SHALL receive `ExtensionCommandContext` as its second parameter. The bridge SHALL store a reference to the latest context for use by the command handler when processing session control requests.

#### Scenario: Context captured on command execution
- **WHEN** the `__dashboard` command handler executes
- **THEN** the `ExtensionCommandContext` SHALL be stored for subsequent use by the command handler

### Requirement: Session prompt access
The command handler SHALL access `session.prompt()` through the cached extension context to route slash commands. The session object is accessible via `cachedCtx.sessionManager` or equivalent context path.

#### Scenario: Session prompt accessible
- **WHEN** the command handler needs to route a slash command
- **THEN** it SHALL access the session's `prompt()` method through the cached context

#### Scenario: Session prompt not accessible gracefully handled
- **WHEN** the session's `prompt()` method is not available (e.g., older pi version)
- **THEN** the handler SHALL fall back to `pi.sendUserMessage()` without error

### Requirement: Terminal session type
The `SessionSource` type in shared types SHALL include `"terminal"` as a valid value. No behavioral changes are required — this is a type-level placeholder for future terminal session support.

#### Scenario: Terminal type accepted
- **WHEN** a session registers with `source: "terminal"`
- **THEN** the session manager SHALL accept and store the session without error

#### Scenario: Terminal type in sidebar
- **WHEN** a session with `source: "terminal"` appears in the session sidebar
- **THEN** it SHALL be displayed (the specific icon/styling is deferred to future work)
