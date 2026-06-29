# chat-view Specification

## Purpose
Defines how the dashboard's chat panel renders the live and replayed event stream for a session: optimistic user cards, bash output, command feedback, collapsed-failed retries, and pairing of running tool calls with interactive prompts.
## Requirements
### Requirement: Optimistic pending card in chat
The chat view SHALL render an optimistic user message card at the bottom of the message list when `state.pendingPrompt` is set. The card SHALL use the same styling as a regular user message card but include an animated spinning icon to indicate processing.

#### Scenario: Pending card rendered
- **WHEN** `state.pendingPrompt` is defined
- **THEN** the chat view SHALL render a user-styled card at the bottom with the prompt text and a spinning loader icon

#### Scenario: Pending card removed on server event
- **WHEN** `state.pendingPrompt` becomes undefined (server confirmed or cancelled)
- **THEN** the optimistic card SHALL no longer be rendered

#### Scenario: Auto-scroll to pending card when following
- **WHEN** a pending card appears AND the user is at or near the bottom (within 50px)
- **THEN** the chat view SHALL auto-scroll to show the pending card

#### Scenario: No auto-scroll to pending card when scroll-locked
- **WHEN** a pending card appears AND the user has scrolled up (more than 50px from bottom)
- **THEN** the chat view SHALL NOT auto-scroll

### Requirement: Bash output event rendering
The chat view SHALL render `bash_output` events as styled cards in the message stream. Each card SHALL display:
- The command in monospace font
- The output in a pre-formatted scrollable block (max-height with overflow scroll)
- Exit code indicator: green for 0, red for non-zero
- A "silent" badge (e.g., "!!") when `excludeFromContext` is `true`, indicating output was not sent to the LLM

#### Scenario: Successful command rendered
- **WHEN** a `bash_output` event with `exitCode: 0` and `excludeFromContext: false` is in the event stream
- **THEN** the chat view SHALL render a card with the command, output, and green exit indicator

#### Scenario: Failed command rendered
- **WHEN** a `bash_output` event with `exitCode: 1` is in the event stream
- **THEN** the chat view SHALL render a card with a red exit code indicator

#### Scenario: Silent command badge
- **WHEN** a `bash_output` event with `excludeFromContext: true` is in the event stream
- **THEN** the card SHALL show a "!!" or "silent" badge to distinguish it from LLM-sent commands

### Requirement: Command feedback event rendering
The chat view SHALL render `command_feedback` events as inline status cards:
- `started`: Subtle info card with command name (e.g., "⏳ /compact in progress")
- `completed`: Success card
- `error`: Error card with the error message

#### Scenario: Started feedback rendered
- **WHEN** a `command_feedback` event with `status: "started"` is in the event stream
- **THEN** the chat view SHALL render an info-style card

#### Scenario: Error feedback rendered
- **WHEN** a `command_feedback` event with `status: "error"` is in the event stream
- **THEN** the chat view SHALL render an error-style card with the message

### Requirement: Failed-then-retried tool calls collapse into a pill
The chat view SHALL collapse a `toolResult` message with `toolStatus: "error"` into a one-line badge when the very next non-skip message is a `toolResult` of the same `toolName` whose `toolStatus` is NOT `"error"` (i.e. `"complete"` or `"running"`). The badge SHALL display the tool name and the text "failed — retried" with a small alert icon. Clicking the badge SHALL expand it to the full original error card (a standard `ToolCallStep` with `status: "error"` showing the validation error and `Received arguments:` JSON); clicking again SHALL collapse it back to the badge. Skip roles for the look-ahead are `assistant`, `thinking`, `turnSeparator`, `rawEvent`, and `commandFeedback`. The look-ahead aborts on `user`, a different-tool `toolResult`, or a chained same-tool `error` — those error cards continue to render in full.

#### Scenario: Empty-args ask_user followed by valid retry
- **WHEN** the message stream contains a `toolResult` for `ask_user` with `toolStatus: "error"` (validation message complaining about missing `method` / `title`) followed (after intervening `thinking` / `assistant` messages) by another `toolResult` for `ask_user` with `toolStatus: "complete"`
- **THEN** the chat view SHALL render the first `toolResult` as a single-line "ask_user failed — retried" pill instead of the full red validation card

#### Scenario: Standalone error stays expanded
- **WHEN** a `toolResult` has `toolStatus: "error"` AND no subsequent same-tool `toolResult` exists in the message stream
- **THEN** the chat view SHALL render it as the full standard `ToolCallStep` error card (no collapse)

#### Scenario: Chained errors stay expanded
- **WHEN** two consecutive same-tool `toolResult` messages both have `toolStatus: "error"`
- **THEN** the chat view SHALL render BOTH as full error cards (the first is not considered "retried" because the next attempt also failed)

#### Scenario: Different-tool boundary
- **WHEN** an error `toolResult` for tool A is followed by a complete `toolResult` for tool B
- **THEN** the chat view SHALL render the tool-A error as a full card (no collapse)

#### Scenario: User-message boundary
- **WHEN** an error `toolResult` is followed by a `user` message before any retry
- **THEN** the chat view SHALL render the error as a full card (no collapse) — a user reply ends the auto-retry window

#### Scenario: Expand and recollapse the pill
- **WHEN** the user clicks an expanded "failed — retried" pill
- **THEN** the chat view SHALL render the full original error `ToolCallStep` plus a "Hide failed attempt" toggle

- **WHEN** the user clicks the "Hide failed attempt" toggle
- **THEN** the chat view SHALL collapse the error back to the one-line pill

### Requirement: toolResult hidden during paired pending interactiveUi
The chat view SHALL hide (return `null` from the message renderer) any `toolResult` message whose very next non-skip message is an `interactiveUi` message with `args.status === "pending"`, regardless of the `toolResult`'s own `toolStatus`. Skip roles are the same as for the retry-pill helper (`assistant`, `thinking`, `turnSeparator`, `rawEvent`, `commandFeedback`).

The `toolStatus` is intentionally ignored because, after a server restart, `state-replay.ts` synthesizes a `tool_execution_end` for every orphan tool call — including a legitimately-pending `ask_user`. The `toolResult` thus arrives as `"complete"` while the prompt replayed from the in-memory pending-prompt cache is still `"pending"`. Both must collapse to a single Confirm card. Once the user answers, the `interactiveUi` flips to `"resolved"` / `"cancelled"` / `"dismissed"`, the helper stops hiding, and the chat shows the full tool card in history.

#### Scenario: Pending ask_user (live) shows only the interactive card
- **WHEN** an `ask_user` tool is mid-execution, a `toolResult` exists with `toolStatus: "running"`, and the next non-skip message is an `interactiveUi` with `status: "pending"`
- **THEN** the chat view SHALL render only the `InteractiveUiCard` (with Allow/Deny/Cancel buttons) and SHALL hide the running `toolResult`

#### Scenario: Pending ask_user (post-restart replay) shows only the interactive card
- **WHEN** the dashboard server has restarted while an `ask_user` was unanswered, `state-replay.ts` synthesized a `tool_execution_end` for the orphan call so the `toolResult.toolStatus` is `"complete"`, AND the next non-skip message is an `interactiveUi` with `status: "pending"` (replayed from the in-memory pending-prompt cache)
- **THEN** the chat view SHALL hide the `complete` `toolResult` and render only the `InteractiveUiCard`, so the user sees exactly one Confirm card per unanswered prompt

#### Scenario: Errored toolResult paired with pending interactiveUi is hidden
- **WHEN** a `toolResult` with `toolStatus: "error"` is followed (across skip roles) by an `interactiveUi` with `status: "pending"`
- **THEN** the chat view SHALL hide the errored `toolResult` (the pending UI takes precedence)

#### Scenario: Resolved tool history shows the full tool card
- **WHEN** the user has answered the `ask_user` prompt, the `interactiveUi.args.status` is `"resolved"`, and the corresponding `toolResult.toolStatus` is `"complete"`
- **THEN** the chat view SHALL render the full `ToolCallStep` (showing the question + `User responded:` result), and the `InteractiveUiCard` SHALL render its compact one-line resolved-state pill (e.g. `mdi-shield-alert ▸ Allowed`)

#### Scenario: Cancelled tool history shows the full tool card
- **WHEN** the `interactiveUi.args.status` is `"cancelled"` and the corresponding `toolResult.toolStatus` is `"complete"`
- **THEN** the chat view SHALL render the full `ToolCallStep` (no hide)

#### Scenario: Skip-roles do not break pairing
- **WHEN** a `toolResult` is followed by `thinking` and `assistant` messages and THEN a pending `interactiveUi`
- **THEN** the chat view SHALL still hide the `toolResult`

#### Scenario: Different intervening tool breaks pairing
- **WHEN** a `toolResult` for tool A is followed by a `toolResult` for tool B BEFORE any `interactiveUi`
- **THEN** the chat view SHALL render the tool-A card normally (no hide); the tool-B card may itself be hidden if it is followed by a pending `interactiveUi`

#### Scenario: Standalone tool with no interactive UI
- **WHEN** a `toolResult` has no subsequent `interactiveUi`
- **THEN** the chat view SHALL render the card normally regardless of `toolStatus`

### Requirement: Polling-loop tool calls collapse across transparent intermediate rows
The `groupConsecutiveToolCalls` helper SHALL collapse 3 or more consecutive `toolResult` messages that share the same `toolName` AND have `argsSimilar` arguments (deep-equal JSON) into a single `ToolCallGroup` pill, even when the messages are separated by *transparent* intermediate rows: `assistant`, `thinking`, `turnSeparator`, `rawEvent`, and `commandFeedback`. "Hard" rows — `user`, a different-tool `toolResult`, `interactiveUi`, `bashOutput` — SHALL still terminate the run.

This is required because the event reducer inserts a `turnSeparator` after every tool-only assistant turn (no prose, just a tool call), so a polling loop that issues the same bash command N times produces a sequence `toolResult, turnSeparator, toolResult, turnSeparator, …` in which no two `toolResult`s are immediately adjacent. Without skipping transparents the grouper would never fire and N identical cards would render.

The collapsed group's expanded view SHALL render only the `ToolCallStep` rows (the absorbed transparents are not rendered standalone). When fewer than 3 matching `toolResult`s accumulate, the helper SHALL emit every walked row verbatim — including the intermediate transparents — so layout for sub-threshold runs is identical to the pre-grouping output. A `toolStatus: "running"` `toolResult` SHALL never be absorbed into a collapsed group (it is always rendered as a live card).

#### Scenario: Polling loop with turnSeparators collapses
- **WHEN** the LLM issues 40 identical `bash` `toolResult` rows interleaved with `turnSeparator` rows (e.g. `curl -s http://localhost:8000/ | grep -oE 'src=...'` repeatedly waiting for a server restart)
- **THEN** the chat view SHALL render exactly one `×40` `CollapsedToolGroup` pill, expandable to reveal all 40 individual `ToolCallStep` rows

#### Scenario: Identical calls separated by thinking blocks collapse
- **WHEN** 3 identical `bash` `toolResult` rows are separated by `thinking` rows
- **THEN** the chat view SHALL render exactly one `×3` `CollapsedToolGroup`

#### Scenario: Mixed transparent rows do not break the run
- **WHEN** identical `toolResult` rows are interleaved with a mix of `assistant`, `thinking`, and `turnSeparator` rows (no "hard" rows between them)
- **THEN** the chat view SHALL collapse them into a single group

#### Scenario: User message terminates the run
- **WHEN** 3 identical `bash` rows are followed by a `user` message and then 3 more identical `bash` rows
- **THEN** the chat view SHALL render two separate `×3` groups with the `user` message between them

#### Scenario: Different tool terminates the run
- **WHEN** the sequence is `bash, turnSeparator, bash, read, bash, bash` (only 2 bashes before the `read`, then 2 more after)
- **THEN** the chat view SHALL render no group (each side has fewer than 3 matching calls); every `toolResult` and intermediate transparent SHALL render verbatim

#### Scenario: Sub-threshold run renders verbatim with intermediates
- **WHEN** only 2 identical `bash` rows are separated by a `turnSeparator`
- **THEN** the chat view SHALL render 3 rows in order — `toolResult`, `turnSeparator`, `toolResult` — with no group pill (matches pre-grouping behavior exactly)

#### Scenario: Trailing running tool not absorbed
- **WHEN** 3 identical `complete` `bash` rows are followed (across transparents) by a 4th identical `bash` row whose `toolStatus` is `"running"`
- **THEN** the first 3 SHALL collapse into a `×3` group and the running 4th SHALL render as a separate live card

### Requirement: ask_user resolved icon uses help-circle in sky-blue
The `ToolCallStep` header SHALL render a sky-blue `mdi-help-circle-outline` (`?`) icon instead of the standard green `mdi-check` icon when both of the following are true: the `toolName` is `"ask_user"` AND the `status` is `"complete"`. This visually distinguishes resolved user-interaction prompts from ordinary tool executions in the chat history. The override SHALL NOT apply when `status === "running"` (which continues to show the yellow `mdi-loading` spinner) or when `status === "error"` (which continues to show the red `mdi-alert-circle` icon), so existing in-flight and failure semantics are preserved.

#### Scenario: Resolved ask_user shows sky-blue help icon
- **WHEN** a `toolResult` with `toolName: "ask_user"` and `toolStatus: "complete"` is rendered by `ToolCallStep`
- **THEN** the header icon SHALL be `mdi-help-circle-outline` and the wrapper class SHALL include `text-sky-400`

#### Scenario: Running ask_user keeps yellow spinner
- **WHEN** a `toolResult` with `toolName: "ask_user"` and `toolStatus: "running"` is rendered (and is not hidden by the paired-pending-interactiveUi rule)
- **THEN** the header icon SHALL be `mdi-loading` (spinning) and the wrapper class SHALL include `text-yellow-400`

#### Scenario: Errored ask_user keeps red alert
- **WHEN** a `toolResult` with `toolName: "ask_user"` and `toolStatus: "error"` is rendered (either as a full card or expanded from a `RetriedErrorBadge`)
- **THEN** the header icon SHALL be `mdi-alert-circle` and the wrapper class SHALL include `text-red-400`

#### Scenario: Other tools unaffected
- **WHEN** a `toolResult` with `toolName !== "ask_user"` and `toolStatus: "complete"` is rendered
- **THEN** the header icon SHALL be `mdi-check` and the wrapper class SHALL include `text-green-400` (unchanged from the pre-existing behavior)

<!-- Appended by render-skill-invocations-collapsibly. -->

### Requirement: User message rendering routes skill invocations to SkillInvocationCard

The chat view SHALL render user messages whose `ChatMessage.skill` is populated using the `SkillInvocationCard` component. Plain user messages (those with `skill === undefined`) SHALL continue to render via the existing `MessageBubble` component. The container layout (right-justified flex, `mt-4 mb-4`, `bubbleMax` width constraint) SHALL be preserved across both branches.

This requirement supersedes the previous behavior in which all user messages rendered identically through `MessageBubble`.

#### Scenario: Skill user message renders as collapsed card
- **WHEN** the chat view encounters a user `ChatMessage` with `skill` populated
- **THEN** the rendered DOM SHALL contain a `<SkillInvocationCard>` element with the card's collapsed-by-default header showing `/skill:${name}${args ? " " + args : ""}` and a wrench icon

#### Scenario: Plain user message still renders as MessageBubble
- **WHEN** the chat view encounters a user `ChatMessage` with `skill === undefined`
- **THEN** the rendered DOM SHALL contain a `<MessageBubble>` element with the existing blue-bordered styling

#### Scenario: Mixed conversation renders both card types side-by-side
- **WHEN** the conversation includes one skill user message followed by one plain user message
- **THEN** the chat view SHALL render one `<SkillInvocationCard>` and one `<MessageBubble>` in chronological order

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

### Requirement: Composer mounts a session-action strip above the textarea
The chat view's composer (`CommandInput`) SHALL render a `ComposerSessionActions` strip between the existing model/level row and the textarea, when and only when the chat view is bound to a session (i.e. a session is selected and its details have loaded).

The strip SHALL render three logical groups, each separated by a vertical divider:

1. **Strip header** — gradient dot + label `session actions · <session-name>` + refresh button.
2. **OpenSpec group** — compact 7-node stepper (variant `compact` per the openspec-attach-combo capability) followed by the same action buttons that render inside the sidebar card's OPENSPEC subcard (`Explore`, `Apply` / `Continue` / `FF` / `Verify` by state, `Tasks N/M`, `Archive`, overflow `⋯`).
3. **Git group** — same actions as the sidebar card's GIT subcard (`Push`, `Open PR` / `View PR`, `Merge`, `Close`). The git group SHALL render only when its predicate is true (same predicate the GIT subcard uses).

The strip SHALL apply identical action gating to the sidebar card: `Explore` enabled only when `!attachedProposal`; `Archive` enabled only when `attachedProposal`; all actions disabled when `status === "streaming"`; the OpenSpec group hidden entirely when `OpenSpecData.hasOpenspecDir === false && pending === false`.

The strip SHALL share the `onSendPrompt`, `onAttachProposal`, `onDetachProposal`, `onReadArtifact`, and `onBulkArchive` callbacks with the sidebar surface. Firing an action from the strip SHALL produce the same effect as firing the equivalent action from the sidebar card; both surfaces SHALL stay in sync without additional state plumbing.

#### Scenario: Strip renders with attached implementing change
- **WHEN** the chat view is bound to session `"s1"` with `attachedProposal = "add-auth"` and `deriveChangeState` returns `IMPLEMENTING`
- **THEN** the composer SHALL render a `ComposerSessionActions` strip element between the model/level row and the textarea
- **AND** the strip SHALL contain a compact stepper with the correct node states (`Specs` done, `Tasks` current with `4/12`)
- **AND** the strip SHALL contain a disabled `Explore` button and an enabled `Archive` button (gating matches the sidebar)

#### Scenario: Strip hidden when no session selected
- **WHEN** the chat view has no session selected (e.g. on an empty initial view)
- **THEN** the composer SHALL NOT render the `ComposerSessionActions` strip
- **AND** the model/level row and textarea SHALL render in their existing layout

#### Scenario: OpenSpec group hidden when cwd is not OpenSpec-applicable
- **WHEN** the chat view is bound to a session whose cwd has `OpenSpecData.hasOpenspecDir === false && pending === false`
- **THEN** the strip SHALL render with the strip header and any active VCS groups
- **AND** the strip SHALL NOT render the OpenSpec stepper or OpenSpec action buttons

#### Scenario: Git group follows the sidecard predicate
- **WHEN** the chat view is bound to a session in a git repo where the GIT subcard predicate is true
- **THEN** the strip SHALL render the Git group

#### Scenario: Firing Apply from strip dispatches the skill prompt
- **WHEN** the user clicks the `Apply` button inside the composer strip for session `"s1"` with attached change `"add-auth"`
- **THEN** the strip SHALL invoke `onSendPrompt` with the same prompt the sidebar card's Apply button would send (`/skill:openspec-apply-change add-auth`)
- **AND** the session card's OPENSPEC subcard SHALL reflect the same `streaming` state without additional state propagation

#### Scenario: Streaming session disables all strip actions
- **WHEN** the chat view is bound to a session with `status = "streaming"`
- **THEN** every action button inside the strip SHALL render in a disabled state
- **AND** the refresh button SHALL remain enabled (refresh is a read-only action)

#### Scenario: Strip refresh re-fetches OpenSpec data
- **WHEN** the user clicks the refresh button inside the strip header
- **THEN** the system SHALL re-fetch the cwd's OpenSpec data
- **AND** the stepper and action gating SHALL re-render with the fresh data

