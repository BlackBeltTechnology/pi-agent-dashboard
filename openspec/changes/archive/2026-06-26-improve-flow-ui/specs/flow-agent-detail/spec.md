## MODIFIED Requirements

### Requirement: Agent detail shows tool call history
The agent detail view SHALL display all tool calls for the agent in chronological order. Each tool call entry SHALL show: tool name, input preview (path for read/write/edit, command for bash, pattern for grep), output (collapsible), error status, and duration if available. Tool call entries in the agent detail view SHALL NOT render the leading per-entry status glyph (the status/`ask_user` icon shown in the main chat tool renderer); the opt-out SHALL be scoped to the flow agent views and SHALL NOT affect the main chat tool renderer.

#### Scenario: Tool call with file path
- **WHEN** a tool call for `read` with `{ path: "src/foo.ts" }` is displayed
- **THEN** the entry SHALL show "read · src/foo.ts"

#### Scenario: Tool call with error
- **WHEN** a tool call has `isError: true`
- **THEN** the entry SHALL be visually marked as an error (red accent)

#### Scenario: No leading status icon in agent detail
- **WHEN** a tool call entry renders in the flow agent detail view
- **THEN** no leading status/`ask_user` glyph SHALL appear before the tool name
- **AND** the same tool renderer in the main chat SHALL still show its status glyph
