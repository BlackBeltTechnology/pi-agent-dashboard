## ADDED Requirements

### Requirement: ToolCallStep collapsed summary preserves full argument strings

The chat view's collapsed tool-call row (`ToolCallStep` and the equivalent row inside `CollapsedToolGroup`) SHALL pass the full argument-derived summary string to its rendered `<span>` without applying any JavaScript-level `String.prototype.slice` to truncate it. Overflow handling SHALL be delegated entirely to CSS (`truncate` / `text-overflow: ellipsis`), so the visible length adapts to the available width and a proper ellipsis indicates that more text exists.

The row's clickable container element (the `<button>` that toggles the expanded panel) SHALL carry a `title` attribute whose value equals the full summary string, so that desktop user agents expose the un-truncated text as a native hover tooltip.

This requirement applies uniformly to every entry of the `toolSummaries` map, including but not limited to: `bash` (`command`), `Agent` (`description`), `ask_user` (`title`), `get_subagent_result` (`agent_id`), `steer_subagent` (`agent_id`). The `read` / `edit` / `write` / `grep` / `find` / `ls` entries already pass their argument strings through unsliced and SHALL continue to do so; they SHALL also gain the same `title=` affordance.

#### Scenario: Long bash command in collapsed row preserves full text in DOM
- **WHEN** a `bash` tool call has `args.command` of length > 60 characters (e.g. `test -e openspec/changes/archive/2026-05-28-bump-pi-compat-to-0-75/proposal.md`)
- **THEN** the rendered summary `<span>` text content SHALL be the complete command (prefixed by `$ `), not the first 60 characters
- **AND** the surrounding row element SHALL carry the CSS class `truncate` so overflow ellipsizes against the available width
- **AND** the row's `<button>` SHALL carry a `title` attribute equal to the full summary string

#### Scenario: Desktop hover exposes full summary
- **WHEN** a user hovers a collapsed tool-call row on a desktop browser
- **THEN** the browser SHALL display the full summary string as the native tooltip from the row's `title=` attribute, regardless of how much of the text the CSS ellipsis hid

#### Scenario: CollapsedToolGroup row applies the same rule
- **WHEN** consecutive same-tool calls collapse into a `CollapsedToolGroup` and the group's first-args summary exceeds 50 characters
- **THEN** the visible row SHALL contain the full summary in its DOM text and SHALL carry a `title=` attribute with the same full text
- **AND** the previous hard `slice(0, 50)` behavior SHALL NOT be applied

#### Scenario: Short summaries are unaffected
- **WHEN** a tool call's summary fits within the row's rendered width (no overflow)
- **THEN** the row SHALL render identically to the pre-change behavior (the `title=` attribute is present but the tooltip is harmless / redundant)

### Requirement: Bash tool expanded renderer shows the full command

The chat view's expanded `BashToolRenderer` panel SHALL display the entire `args.command` string without applying CSS truncation. The command `<span>` SHALL use wrapping classes (`whitespace-pre-wrap break-all` or equivalent) so commands longer than the panel width break across multiple lines instead of being clipped with an ellipsis. The `$` prefix and any optional timeout pill SHALL remain on the first wrapped line; subsequent lines SHALL contain only the continuation of the command text.

#### Scenario: Long command wraps in expanded view
- **WHEN** a user clicks the chevron on a collapsed `bash` tool-call row whose `args.command` is longer than the panel width
- **THEN** the expanded panel SHALL render the full command across as many wrapped lines as needed
- **AND** the rendered `<span>` SHALL NOT carry the CSS class `truncate`
- **AND** the full command string SHALL be present in the DOM text content

#### Scenario: Short command is unchanged
- **WHEN** the command fits on a single line within the panel width
- **THEN** the expanded panel SHALL render the command on a single line, visually identical to the pre-change behavior
