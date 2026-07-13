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
The `groupConsecutiveToolCalls` helper SHALL collapse 3 or more consecutive `toolResult` messages that share the same `toolName` AND have `argsSimilar` arguments (deep-equal JSON) into a single `ToolCallGroup` pill, even when the messages are separated by *transparent* intermediate rows: `assistant`, `thinking`, `turnSeparator`, `rawEvent`, and `commandFeedback`. "Hard" rows — `user`, a different-tool `toolResult`, `interactiveUi`, `bashOutput` — SHALL still terminate the run. Non-empty `assistant` prose between two identical calls is transparent (narration of a repeated action) and SHALL NOT prevent the collapse; the temporal burst pass never sees the run un-collapsed because the semantic pass runs FIRST over the full stream.

This is required because the event reducer inserts a `turnSeparator` after every tool-only assistant turn (no prose, just a tool call), so a polling loop that issues the same bash command N times produces a sequence `toolResult, turnSeparator, toolResult, turnSeparator, …` in which no two `toolResult`s are immediately adjacent. Without skipping transparents the grouper would never fire and N identical cards would render.

The `ToolCallGroup` SHALL carry, in addition to its `toolResult`-only `messages` array (which drives the `×N` count and summary), a `rendered` array holding the FULL walked slice `[start, lastToolEnd)` in original order — the tool results plus the absorbed transparent rows. The collapsed group's expanded view SHALL render `rendered`: each `toolResult` as a `ToolCallStep`, each `thinking` or non-empty `assistant` prose row as a lightweight inline text block, and empty/separator/`rawEvent`/`commandFeedback` rows skipped. The absorbed narration SHALL NOT render standalone at the top level and SHALL NOT appear in the collapsed (one-line) header. When fewer than 3 matching `toolResult`s accumulate, the helper SHALL emit every walked row verbatim — including the intermediate transparents — so layout for sub-threshold runs is identical to the pre-grouping output. A `toolStatus: "running"` `toolResult` SHALL never be absorbed into a collapsed group (it is always rendered as a live card). Trailing prose after the final grouped call SHALL NOT be absorbed (it belongs to the next row) so a turn's final reply renders at the top level.

#### Scenario: Polling loop with turnSeparators collapses
- **WHEN** the LLM issues 40 identical `bash` `toolResult` rows interleaved with `turnSeparator` rows (e.g. `curl -s http://localhost:8000/ | grep -oE 'src=...'` repeatedly waiting for a server restart)
- **THEN** the chat view SHALL render exactly one `×40` `CollapsedToolGroup` pill, expandable to reveal all 40 individual `ToolCallStep` rows

#### Scenario: Identical calls separated by thinking blocks collapse
- **WHEN** 3 identical `bash` `toolResult` rows are separated by `thinking` rows
- **THEN** the chat view SHALL render exactly one `×3` `CollapsedToolGroup`

#### Scenario: Identical calls separated by narration prose collapse
- **WHEN** 3 or more identical `bash` `toolResult` rows are separated by non-empty `assistant` prose (the agent narrates each polling attempt)
- **THEN** the chat view SHALL render exactly one `×N` `CollapsedToolGroup` (NOT N standalone rows), and expanding it SHALL show the absorbed prose interleaved with the tool calls in original order

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

### Requirement: Consecutive tool-call bursts collapse into a progress-aware group

The chat view SHALL collapse a maximal run of consecutive tool-like items into a single **group** whenever the run contains 1 or more members. Composition is **semantic-INNER-first, burst-OUTER-second**: the identical-call collapse (`groupConsecutiveToolCalls`) runs FIRST over the ENTIRE message stream, producing a mixed list of `ChatMessage` and `ToolCallGroup` items; the group pass then walks that list. A **tool-like** item is a `toolResult` row OR a `×N` `ToolCallGroup` (which counts as ONE member). The run walks across TRANSPARENT rows (`thinking`, `turnSeparator`, `rawEvent`, `commandFeedback`, and **empty** `assistant` rows with no text) without breaking; a HARD row (`user`, **non-empty** `assistant` prose, `interactiveUi`, `bashOutput`, `inlineTerminal`, or any other role) terminates the run.

Grouping is **turn-scoped**: the group window SHALL extend BACKWARD across LEADING transparent rows that precede the first tool-like member (up to but not including the previous HARD row or start of stream) AND FORWARD across TRAILING transparent rows that follow the last tool-like member (up to but not including the next HARD row or end of stream). All such transparent rows — most importantly `thinking` — are ABSORBED into the group slice. This makes a turn's *opening plan* reasoning (before the first tool) AND its *concluding* reasoning (after the last tool) part of the group rather than standalone rows above or below it. Leading/trailing transparents are absorbed but SHALL NOT count toward member counting; a group still forms on ≥ 1 tool-like member.

A group with a SINGLE tool-like member is valid and SHALL render in the same frame as a multi-member group. Because the semantic pass runs first, identical calls separated by narration prose fold into a nested `×N` BEFORE group formation; the group pass sees that group as a single member. EXCEPTION: a single-member group whose one member is itself a `×N` `ToolCallGroup` SHALL stay a bare `×N` group (rendered un-reframed) WHEN its absorbed leading/trailing transparents are all STRUCTURAL (`rawEvent`/`turnSeparator`/`commandFeedback`/empty `assistant`); those transparents render standalone around it. Such a lone `×N` SHALL be reframed into a group ONLY when it absorbed a non-empty `thinking` row (so its reasoning folds inside); a single `toolResult` member always reframes. Non-empty `assistant` prose remains a HARD boundary, so a turn's substantive reply between distinct investigation steps stays visible at the top level and splits groups. Group formation SHALL NOT replace or alter the identical-call collapse helper's boundary logic.

#### Scenario: Single tool call forms a group
- **GIVEN** one `toolResult` row bounded by HARD rows on both sides
- **WHEN** the chat renders
- **THEN** a group SHALL form over that one member and render in the unified group frame (NOT a bare top-level row)

#### Scenario: Leading reasoning before the first tool is folded into the group
- **GIVEN** a `user` row, then a `thinking` row, then 3 heterogeneous `toolResult` rows, then a non-empty `assistant` reply
- **WHEN** the chat renders
- **THEN** the group SHALL absorb the leading `thinking` row as its first body item, and NO standalone `thinking` row SHALL render between the `user` row and the group

#### Scenario: Heterogeneous multi-member group collapses
- **GIVEN** 8 consecutive `toolResult` rows of mixed tools (`grep`, `Read`, `git`) with differing args, none running
- **WHEN** the chat renders
- **THEN** a single group SHALL render in place of the 8 rows, and no individual member row SHALL appear at the top level

#### Scenario: Trailing reasoning after the last tool is absorbed into the group
- **GIVEN** 3 heterogeneous `toolResult` rows followed by two `thinking` rows and then a `user` row
- **WHEN** the chat renders
- **THEN** the group SHALL absorb both trailing `thinking` rows into its body, and NO standalone `thinking` row SHALL render between the group and the `user` row

#### Scenario: Group split by a turn-final reply
- **GIVEN** 4 heterogeneous `toolResult` rows, then a non-empty `assistant` reply, then 4 more heterogeneous `toolResult` rows
- **WHEN** the chat renders
- **THEN** two separate groups SHALL form, split at the reply row, and the reply SHALL render between them at the top level

#### Scenario: Identical calls across prose nest as a ×N inside a group
- **GIVEN** a `grep`, a `Read`, then a run of 24 identical `curl` calls each separated by narration prose
- **WHEN** the chat renders
- **THEN** the 24 `curl` calls SHALL fold into one nested `×24` line (prose absorbed), and expanding the `×24` SHALL show the absorbed narration

### Requirement: Running bursts group live, auto-expanded, with an honest count

While a group contains a member whose `toolStatus` is `running`, the group SHALL form INCLUDING that running member (overriding the identical-call rule that never groups running tools) and SHALL render in the EXPANDED state so the live tool stays visible. The header SHALL show an animated indeterminate spinner, the title `Working`, a `"N done"` count of COMPLETED visible members only, and the summary of the currently-running member. The header SHALL render an **indeterminate** shimmer/pulse animation to signal liveness. The header SHALL NOT display a total-count denominator or a determinate progress bar. When `prefers-reduced-motion: reduce` is set, animation SHALL be suppressed while the static `Working` / `N done` / live-command text remains.

When the group boundary is reached and no member is running, the group SHALL render in the COLLAPSED state. A SINGLE-member group SHALL show a completion check, the member's tool icon, the member's one-line summary, and its duration (NOT the literal text `"1 tool calls"`). A MULTI-member group SHALL show a completion check, `"N tool calls"`, a per-tool-kind icon+count breakdown, and an aggregate duration. When any member has `toolStatus: "error"`, the completed header SHALL additionally render a `"N failed"` badge in the error color. A user's manual toggle of a specific group instance SHALL override the automatic expanded/collapsed default for that instance.

#### Scenario: Running group is expanded with an animated header
- **GIVEN** a group of 12 completed members followed by a 13th member with `toolStatus: "running"`
- **WHEN** the chat renders
- **THEN** the group SHALL render expanded, the header SHALL read `Working` with `12 done` and the running member's summary, an indeterminate animation SHALL play, and no total denominator SHALL appear

#### Scenario: Reduced motion suppresses animation
- **GIVEN** a running group and `prefers-reduced-motion: reduce`
- **WHEN** the chat renders
- **THEN** no shimmer/pulse animation SHALL play, and the `Working` / `N done` / live-command text SHALL still render

#### Scenario: Single completed group shows its own summary
- **GIVEN** a single completed `Read` group bounded by HARD rows
- **WHEN** the chat renders
- **THEN** the collapsed header SHALL show the `Read` icon and the file summary and duration, NOT the text `"1 tool calls"`

#### Scenario: Multi completed group shows an icon breakdown
- **GIVEN** a completed group of 9 members (`3× grep`, `5× Read`, `1× git`)
- **WHEN** the chat renders
- **THEN** the collapsed header SHALL show `"9 tool calls"`, a per-kind icon+count breakdown, and an aggregate duration

#### Scenario: Failed member surfaces an error badge
- **GIVEN** a completed group where 1 of 6 members has `toolStatus: "error"`
- **WHEN** the chat renders
- **THEN** the collapsed header SHALL render a `"1 failed"` badge in the error color

#### Scenario: Count excludes the running member
- **GIVEN** a group with 5 completed members and 1 running member
- **THEN** the header count SHALL read `5 done`, not `6`

### Requirement: Burst expansion grows in flow and honours display preferences

An expanded group SHALL render every visible member in DOCUMENT FLOW and grow to whatever height its content needs — there SHALL be NO fixed max-height and NO inner `overflow-y` scroll container on the group body. Long groups extend the page and scroll with the chat timeline like any other content, rather than trapping scroll inside a bounded box. There SHALL be NO inner elision or windowing (every visible member is in the DOM). Members gated off by the tool-kind display preferences (`chat-display-preferences`) SHALL be excluded before counting and rendering, using the same gating as the identical-call collapse; a group whose every member is gated off SHALL render nothing. Header counts SHALL be over VISIBLE underlying tool calls (a nested `×N` contributes N), while the formation threshold SHALL count `toolResult` members (a nested `×N` counts as one member).

#### Scenario: Counting is over underlying calls, threshold over members
- **GIVEN** a group of two distinct `toolResult` rows plus a run of 24 identical calls
- **THEN** the group SHALL form AND the done header SHALL read `26 tool calls`, not `3`

#### Scenario: Expanded group grows to full height with no inner scroll
- **GIVEN** an expanded group of 30 members
- **WHEN** it renders
- **THEN** all 30 visible members SHALL be present in the DOM in document flow, the group body SHALL have NO fixed max-height and NO inner `overflow-y` scroll, and no "N more" elision band SHALL appear

#### Scenario: Auto-collapse does not jump the scroll position
- **GIVEN** a running group rendered expanded while the user has scrolled up into history (not pinned to bottom)
- **WHEN** the last running member completes and the group auto-collapses to a one-line summary
- **THEN** the chat SHALL preserve the user's scroll anchor so the visible content does not jump

#### Scenario: Fully-gated group renders nothing
- **GIVEN** a group whose every member is a tool kind toggled off in display preferences
- **WHEN** the chat renders
- **THEN** the group SHALL render `null` (no header, no container)

#### Scenario: Gating adjusts the visible count
- **GIVEN** a group of 10 members where 3 are a tool kind toggled off
- **THEN** the header count SHALL reflect 7 visible members, not 10

### Requirement: Reasoning blocks stay open for the active turn when enabled

The chat view SHALL expose a `keepReasoningOpenUntilTurnEnds` display preference (boolean, default `false`) at both global scope and per-session override. When `true`, a live-streamed reasoning block (`streamedLive`) SHALL remain EXPANDED for the whole duration of the active turn and SHALL collapse on the turn-end edge — the session status transitioning out of `streaming` (`turnActive` true→false) — bypassing the per-block `reasoningAutoCollapseMs` timer. When `false`, behavior is unchanged: live blocks mount expanded and `reasoningAutoCollapseMs` governs per-block collapse. The two preferences coexist (the ms timer is the sole governor only when `keepReasoningOpenUntilTurnEnds` is false). The preference SHALL apply only to live-streamed blocks; replayed/cold-loaded blocks (`streamedLive` falsy) SHALL mount collapsed regardless. A manual toggle SHALL freeze the block thereafter (user owns it — no auto-collapse, no re-open). Legacy `displayPrefs` files lacking the field SHALL backfill to `false` at load.

#### Scenario: Enabled — live block held open past the ms timer while the turn runs
- **GIVEN** `keepReasoningOpenUntilTurnEnds` is true and `reasoningAutoCollapseMs` is 30000
- **WHEN** a live reasoning block finishes streaming but the turn is still active (`turnActive`)
- **THEN** the block SHALL stay expanded past 30000 ms (the ms timer is suppressed)

#### Scenario: Enabled — collapses on the turn-end edge
- **GIVEN** `keepReasoningOpenUntilTurnEnds` is true and a live reasoning block is expanded while the turn is active
- **WHEN** the session status transitions out of `streaming` (`turnActive` true→false)
- **THEN** the block SHALL collapse

#### Scenario: Disabled — per-block ms timer governs (unchanged)
- **GIVEN** `keepReasoningOpenUntilTurnEnds` is false and `reasoningAutoCollapseMs` is 30000
- **WHEN** a live reasoning block finishes streaming
- **THEN** the block SHALL collapse 30000 ms after it finishes, independent of the turn boundary

#### Scenario: Disabled — turn-end does not restart the ms timer
- **GIVEN** `keepReasoningOpenUntilTurnEnds` is false and a live reasoning block's `reasoningAutoCollapseMs` countdown is in flight
- **WHEN** the turn ends (`turnActive` transitions true→false) before the countdown elapses
- **THEN** the countdown SHALL keep its ORIGINAL schedule (fire relative to when the block finished), NOT be cleared and re-armed relative to the turn-end edge

### Requirement: Reasoning renders consistently inside and outside a group

Absorbed `thinking` rows inside an expanded group SHALL render through the same `ThinkingBlock` component used at the top level — a labeled, collapsible "Reasoning" block — NOT a flat, unlabeled narration paragraph. Reasoning SHALL be visually indistinguishable whether it lands inside a group (interior or trailing) or as a standalone top-level row. Absorbed reasoning SHALL honour the `thinking` display preference (hidden when reasoning is toggled off). Non-empty `assistant` prose absorbed as a nested member is NOT reasoning and MAY continue to render as narration text.

#### Scenario: Interior reasoning keeps the Reasoning affordance
- **GIVEN** an expanded group whose members are separated by a `thinking` row
- **WHEN** the group body renders
- **THEN** the `thinking` row SHALL render as a `ThinkingBlock` with its "Reasoning" header and collapse control, identical to a top-level reasoning block

#### Scenario: Trailing reasoning keeps the Reasoning affordance
- **GIVEN** a group that absorbed a trailing `thinking` row after its last tool call
- **WHEN** the group body renders
- **THEN** that trailing `thinking` row SHALL render as a `ThinkingBlock`, NOT as demoted grey narration text

### Requirement: A display preference controls the tool-group default collapse state

The chat view SHALL expose a `toolGroupDefaultCollapsed` display preference (boolean, default `false`). It SHALL be settable at TWO scopes through the existing display-prefs plumbing: (1) a GLOBAL default, set in the `SettingsPanel` chat-display section (same surface as `reasoning` / `keepReasoningOpenUntilTurnEnds`), persisted to `~/.pi/dashboard/preferences.json#displayPrefs` and inherited by every session; and (2) a per-session OVERRIDE, toggleable from the `ChatViewMenu` "View" popover, persisted to `<session>.meta.json#displayPrefsOverride`. Effective value = `mergeDisplayPrefs(global, override)`. When `false` (default, unchanged behavior), a group's automatic open state follows run status — expanded while any member runs, collapsed when done (`expanded = override ?? isRunning`). When `true`, a group SHALL default to COLLAPSED in every automatic state, INCLUDING while a member is running (`expanded = override ?? false`); the live/running animation and header remain, but the body starts closed. A user's per-instance manual toggle SHALL still override the preference for that instance. Legacy `displayPrefs` files lacking the field SHALL backfill to `false` at load. The `DISPLAY_PRESETS` (`simple`/`standard`/`everything`) SHALL each define the field. The preference SHALL NOT affect reasoning-block collapse (governed by `reasoningAutoCollapseMs` / `keepReasoningOpenUntilTurnEnds`), nor the nested `×N` `CollapsedToolGroup` (always manual, starts closed).

#### Scenario: Default off keeps status-following behavior
- **GIVEN** `toolGroupDefaultCollapsed` is false and a group has a running member
- **WHEN** the chat renders
- **THEN** the group SHALL render expanded (unchanged)

#### Scenario: On keeps a running group collapsed
- **GIVEN** `toolGroupDefaultCollapsed` is true and a group has a running member
- **WHEN** the chat renders
- **THEN** the group SHALL render collapsed with its running header/animation, and its body SHALL be closed until clicked

#### Scenario: On keeps a completed group collapsed
- **GIVEN** `toolGroupDefaultCollapsed` is true and a completed group
- **WHEN** the chat renders
- **THEN** the group SHALL render collapsed (same as default-off completed behavior)

#### Scenario: Manual toggle still overrides the preference
- **GIVEN** `toolGroupDefaultCollapsed` is true and a running group rendered collapsed
- **WHEN** the user clicks the group header to expand it
- **THEN** that instance SHALL stay expanded regardless of the preference until toggled again

#### Scenario: Global default applies to sessions without an override
- **GIVEN** the global `toolGroupDefaultCollapsed` is set true in `SettingsPanel` and a session has NO per-session override for the field
- **WHEN** that session's chat renders
- **THEN** its groups SHALL default to collapsed (the global value is inherited)

#### Scenario: Per-session override beats the global default
- **GIVEN** the global `toolGroupDefaultCollapsed` is true and a session sets its per-session override to false in the View popover
- **WHEN** that session's chat renders
- **THEN** its groups SHALL follow run status (override wins over the global default)

### Requirement: Group frame is unified across states with a completion transition

Running, completed, single-member, and multi-member groups SHALL share ONE visual frame (accent left-rail, rounded surface, hover affordance, chevron). The transition from running→completed SHALL play a brief, GPU-cheap completion cue (transform/opacity only; no layout-affecting animation) and then settle into the collapsed summary. Expand/collapse SHALL use a bounded height transition. All animations SHALL be suppressed under `prefers-reduced-motion: reduce`. The frame SHALL NOT change the existing scroll-anchor behavior on auto-collapse (the shrink must not jump the viewport).

#### Scenario: Completion cue plays once on finish
- **GIVEN** a running group whose last running member completes with no HARD-row change to membership
- **WHEN** the running→completed flip occurs
- **THEN** a single completion cue SHALL play and the group SHALL settle into the collapsed summary, using only transform/opacity animation

#### Scenario: Auto-collapse does not jump the scroll position
- **GIVEN** a running group rendered expanded while the user has scrolled up into history (not pinned to bottom)
- **WHEN** the last running member completes and the group auto-collapses
- **THEN** the chat SHALL preserve the user's scroll anchor so the visible content does not jump

### Requirement: Streaming response carries the same liveness animation as a running group

While the assistant response bubble is actively streaming (`streamingText` present, turn active), the bubble SHALL render the SAME indeterminate liveness cue used by a running group — an edge-pulse glow and a shimmer sweep — to signal the turn is alive, in addition to the existing streaming caret. The animation SHALL be indeterminate (no progress denominator), GPU-cheap (`box-shadow`/`opacity`/`background-position` only), and SHALL stop the instant streaming ends, leaving the settled bubble static with no residual glow. When `prefers-reduced-motion: reduce` is set, the glow and shimmer SHALL be suppressed while the streaming caret remains.

#### Scenario: Streaming bubble animates
- **GIVEN** an assistant response is streaming while the turn is active
- **WHEN** the chat renders
- **THEN** the response bubble SHALL show the edge-pulse + shimmer liveness cue and the streaming caret

#### Scenario: Settled bubble is static
- **GIVEN** an assistant response that has finished streaming (turn ended)
- **WHEN** the chat renders
- **THEN** the bubble SHALL render with NO glow, NO shimmer, and NO caret

#### Scenario: Reduced motion suppresses the streaming animation
- **GIVEN** a streaming response bubble and `prefers-reduced-motion: reduce`
- **WHEN** the chat renders
- **THEN** no glow or shimmer SHALL play, and the streaming caret SHALL still render

### Requirement: Chat view importable by sibling workspace packages
The live chat UI SHALL be importable by other packages in the monorepo through a curated subpath export `"./chat-embed"` on `@blackbelt-technology/pi-dashboard-web`, without requiring the consumer to reach into deep source paths. The export surface SHALL expose the full-fidelity chat surface (larger than `ChatView` alone): the `ChatView` component + props type, the per-session display-preferences menu component, the steer/abort/fork input+action surface, the `SessionState` and `ToolContext` types, and the context providers a host must mount. Because `packages/client` publishes only `dist/`, the `"./chat-embed"` subpath SHALL be treated as **workspace-only** (usable by monorepo siblings via the workspace symlink, NOT by an npm-registry install). The export SHALL be additive: it SHALL NOT alter the dashboard app's own runtime behaviour or Vite build output.

#### Scenario: Sibling imports the chat surface via subpath
- **WHEN** a sibling workspace package imports from `@blackbelt-technology/pi-dashboard-web/chat-embed`
- **THEN** the import SHALL resolve `ChatView`, the display-preferences menu, and `useSessionState`, and type-check against their exported types
- **AND** no deep relative source path SHALL be required

#### Scenario: package.json resolution preserved (build-safety)
- **WHEN** the `exports` map is added to `packages/client/package.json`
- **THEN** `"./package.json"` SHALL remain resolvable so that `packages/server/src/server.ts` and `packages/electron/scripts/bundle-server.mjs` continue to resolve `@blackbelt-technology/pi-dashboard-web/package.json`

#### Scenario: App behaviour and build unchanged by the export surface
- **WHEN** the dashboard app is built and run after the subpath export is added
- **THEN** its runtime behaviour and Vite build output SHALL be identical to before the export existed

### Requirement: Headless session-state hook driven by the dashboard protocol
The event→state reduction that produces `SessionState` SHALL be available as a headless hook `useSessionState` that consumes the same pi dashboard event stream and returns the current `SessionState`, with no JSX or UI-primitive dependencies. The reduction primitives (`createInitialState`, `reduceEvent`) already exist as pure functions in `event-reducer.ts`; the hook SHALL wrap them and SHALL replicate the `event_replay` sequence-reset semantics (the `maxSeqMapRef`/`shouldReset` decision made before folding) so that replay correctness is preserved.

#### Scenario: Hook reduces the event stream to SessionState
- **WHEN** `useSessionState` is driven by a sequence of dashboard events equivalent to a real session
- **THEN** it SHALL return a `SessionState` identical to what the app's existing driver produces for the same sequence

#### Scenario: Replay resets state correctly
- **WHEN** an `event_replay` arrives whose sequence indicates a reset relative to the tracked max sequence
- **THEN** `useSessionState` SHALL reset before folding the replayed events, matching the app's existing behaviour

### Requirement: Image-bearing rows keep true height in the virtualized transcript

The virtualized chat transcript SHALL correct an image-bearing row's measured height after each attached image finishes decoding, so the row never stays collapsed at its pre-decode estimate. The image element SHALL reserve a bounded layout box while loading so the initial measurement is not near-zero.

Rationale: image data-URLs decode asynchronously. Under TanStack virtualization a
row is first measured at mount (before decode) and only corrected by measurement.
Without a decode-driven re-measure the row can be cached at a collapsed height and
overlap its neighbour — the message with the image visually disappears (issue #267).

#### Scenario: Row re-measures after an image decodes
- **WHEN** a user `ChatMessage` with one or more `images` renders in the virtualized
  transcript AND an attached `<img>` fires `onLoad`
- **THEN** the virtualizer SHALL re-measure that row so its recorded height reflects
  the decoded image, not the pre-decode estimate

#### Scenario: Image-bearing message survives session switch and scroll
- **WHEN** the user switches away from and back to a session (ChatView is reused,
  not remounted) whose transcript contains an image-bearing message, or scrolls the
  message out of and back into the viewport
- **THEN** the image-bearing row SHALL remain visible at its true height and SHALL
  NOT collapse or overlap adjacent rows

#### Scenario: Multiple images do not cause a measure storm
- **WHEN** a single message carries multiple images that decode in the same frame
- **THEN** the row SHALL be re-measured at most once per row per animation frame

