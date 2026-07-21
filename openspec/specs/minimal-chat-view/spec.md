# minimal-chat-view Specification

## Purpose

MinimalChatView is a shared, compact chat-transcript renderer that displays an agent/subagent timeline of user text, thinking, tool calls, and errors. It normalizes producer status into a fixed set of visual treatments, summarizes tool-call inputs into short previews, and adapts its layout across inline, popout, and single-line row modes.

## Requirements

### Requirement: Timeline entry rendering by kind

The view SHALL render each timeline entry according to its `kind` discriminant, and SHALL ignore entries whose `kind` is unrecognized.

#### Scenario: Text entry
- **WHEN** an entry has `kind: "text"`
- **THEN** its `text` is rendered as markdown content

#### Scenario: Thinking entry
- **WHEN** an entry has `kind: "thinking"`
- **THEN** its `text` is rendered as a thinking block

#### Scenario: Error entry
- **WHEN** an entry has `kind: "error"`
- **THEN** its `text` is rendered as error-styled text

#### Scenario: Tool entry
- **WHEN** an entry has `kind: "tool"`
- **THEN** a tool-call entry is rendered showing the `toolName`, its input, and (when present) its output

#### Scenario: Unknown entry kind
- **WHEN** an entry has a `kind` that is none of `tool`, `text`, `thinking`, or `error`
- **THEN** nothing is rendered for that entry

### Requirement: Status visual treatment

The view SHALL map each normalized status to a distinct icon and color, and SHALL treat any unmatched status the same as `pending`.

#### Scenario: Known statuses
- **WHEN** the status is `complete`, `error`, `running`, `blocked`, or `pending`
- **THEN** a status-specific icon and color are resolved for that status
- **AND** each of these statuses resolves to a visually distinct icon/color from the others

#### Scenario: Unmatched status fallback
- **WHEN** the status is not one of the known statuses
- **THEN** the resolved icon and color are identical to the `pending` treatment

### Requirement: Tool-call input preview extraction

The view SHALL derive a short preview string from a tool call's input, selecting a preview strategy based on the tool name.

#### Scenario: File-oriented tools
- **WHEN** the tool name is `read`, `write`, or `edit` (case-insensitive)
- **THEN** the preview is the input's `file_path`, or its `path` when `file_path` is absent

#### Scenario: Bash tool
- **WHEN** the tool name is `bash` (case-insensitive)
- **THEN** the preview is the input's `command`, truncated to at most 80 characters

#### Scenario: Grep tool
- **WHEN** the tool name is `grep` (case-insensitive)
- **THEN** the preview is the input's `pattern`, truncated to at most 40 characters

#### Scenario: Other tools
- **WHEN** the tool name matches none of the recognized tools
- **THEN** the preview is the JSON serialization of the input, truncated to at most 60 characters

#### Scenario: Non-object input
- **WHEN** the input is absent or not an object
- **THEN** the preview is an empty string

### Requirement: Tool-call rendering and output disclosure

The view SHALL prefer a registered rich tool-call renderer, and SHALL provide a fallback renderer whose output is collapsed by default and expandable only when output exists.

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

### Requirement: Layout modes

The view SHALL support inline, popout, and row layout modes, defaulting to inline, and SHALL render only a single-line summary in row mode.

#### Scenario: Default mode
- **WHEN** no mode is supplied
- **THEN** the view renders in inline mode

#### Scenario: Row mode
- **WHEN** mode is `row`
- **THEN** only a single line is rendered containing the status icon and the title
- **AND** no header chrome, body, or footer is rendered

#### Scenario: Inline and popout modes
- **WHEN** mode is `inline` or `popout`
- **THEN** a header and a scrollable body are rendered
- **AND** popout fills its parent height while inline uses a stable fixed height

### Requirement: Header content

The view SHALL render a header in inline and popout modes showing the status icon and title, and SHALL render optional elements only when their data is present.

#### Scenario: Back button
- **WHEN** an `onBack` handler is supplied
- **THEN** a back control is rendered that invokes the handler when activated

#### Scenario: Subtitle
- **WHEN** a subtitle is supplied
- **THEN** it is rendered under the title

#### Scenario: Activity while running
- **WHEN** an activity string is supplied and the status is `running`
- **THEN** the activity is rendered under the title
- **AND** when the status is not `running`, the activity is not rendered in the header

#### Scenario: Meta block
- **WHEN** meta is supplied with a model name, cost, duration, or token counts
- **THEN** the corresponding meta values are rendered
- **AND** absent meta fields render no placeholder

### Requirement: Empty and footer states

The view SHALL show an empty-state message when there are no entries and SHALL render a supplied footer within the body.

#### Scenario: No entries
- **WHEN** the entries list is empty
- **THEN** the empty-state message is shown, using the supplied `emptyMessage` or a default when none is given

#### Scenario: Footer present
- **WHEN** a footer is supplied
- **THEN** it is rendered at the end of the body after the entries
