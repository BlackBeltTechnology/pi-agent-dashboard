## MODIFIED Requirements

### Requirement: Tool-call rendering and output disclosure

The view SHALL prefer a registered rich tool-call renderer, and SHALL provide a fallback renderer whose output is collapsed by default and expandable only when output exists. Tool output SHALL be presented as text: a string as-is; an object carrying a `content` array of `{ type: "text", text }` blocks as those texts joined by newlines; any other value as pretty-printed JSON.

#### Scenario: Rich renderer available
- **WHEN** the tool-call step primitive is registered
- **THEN** the tool call is rendered by that primitive with a derived status of `error` when the entry is an error, `complete` when output is present, and `running` otherwise

#### Scenario: Fallback renderer
- **WHEN** the tool-call step primitive is not registered
- **THEN** the tool call is rendered inline showing the tool name and input preview

#### Scenario: Expanding fallback output
- **WHEN** the fallback tool entry has output and the user activates its header
- **THEN** the output is revealed

#### Scenario: No output to expand
- **WHEN** the fallback tool entry has no output
- **THEN** no expansion affordance toggles content

#### Scenario: Text result envelope is unwrapped
- **WHEN** a tool entry's output is `{ content: [{ type: "text", text: "line 1\nline 2" }], structuredContent: "…" }`
- **THEN** the output shown is `line 1` and `line 2` on separate lines, not the JSON envelope
