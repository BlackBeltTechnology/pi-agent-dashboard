## ADDED Requirements

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

## MODIFIED Requirements

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

### Requirement: Consecutive tool-call bursts collapse into a progress-aware group

The chat view SHALL collapse a maximal run of consecutive tool-like items into a single **burst group** when the run contains 3 or more members. Composition is **semantic-INNER-first, burst-OUTER-second**: the identical-call collapse (`groupConsecutiveToolCalls`) runs FIRST over the ENTIRE message stream, producing a mixed list of `ChatMessage` and `ToolCallGroup` items; the burst pass then walks that list. A **tool-like** item is a `toolResult` row OR a `×N` `ToolCallGroup` (which counts as ONE member). The run walks across TRANSPARENT rows (`thinking`, `turnSeparator`, `rawEvent`, `commandFeedback`, and **empty** `assistant` rows with no text) without breaking; a HARD row (`user`, **non-empty** `assistant` prose, `interactiveUi`, `bashOutput`, `inlineTerminal`, or any other role) terminates the run. Runs of fewer than 3 members SHALL emit every consumed item verbatim — including intermediate transparent rows in original order — so a non-forming run renders byte-identical to before.

Because the semantic pass runs first over the full stream, identical calls separated by narration prose fold into a nested `×N` BEFORE burst formation; the burst pass sees that group as a single member. Non-empty `assistant` prose remains a HARD boundary for HETEROGENEOUS burst formation, so a turn's substantive reply between distinct investigation steps stays visible at the top level and splits bursts. Burst grouping SHALL NOT replace or alter the identical-call collapse helper's boundary logic.

#### Scenario: Heterogeneous burst collapses
- **GIVEN** 8 consecutive `toolResult` rows of mixed tools (`grep`, `Read`, `git`) with differing args, none running
- **WHEN** the chat renders
- **THEN** a single burst group SHALL render in place of the 8 rows, and no individual member row SHALL appear at the top level

#### Scenario: Sub-threshold run renders verbatim
- **GIVEN** 2 consecutive `toolResult` rows separated by a `turnSeparator`
- **WHEN** the chat renders
- **THEN** both rows SHALL render as standalone rows and no burst group SHALL form

#### Scenario: Heterogeneous burst split by a turn-final reply
- **GIVEN** 4 heterogeneous `toolResult` rows, then a non-empty `assistant` reply, then 4 more heterogeneous `toolResult` rows
- **WHEN** the chat renders
- **THEN** two separate burst groups SHALL form, split at the reply row, and the reply SHALL render between them at the top level

#### Scenario: Identical calls across prose nest as a ×N inside a burst
- **GIVEN** a `grep`, a `Read`, then a run of 24 identical `curl` calls each separated by narration prose
- **WHEN** the chat renders
- **THEN** the 24 `curl` calls SHALL fold into one nested `×24` line (prose absorbed), the burst SHALL form (3 members ≥ threshold), and expanding the `×24` SHALL show the absorbed narration

#### Scenario: Semantic ×N group nests inside a burst
- **GIVEN** a burst containing two distinct `toolResult` rows and a run of 24 identical `curl` calls
- **WHEN** the burst is expanded
- **THEN** the 24 identical calls SHALL render as a single nested `×24` line among the individual member rows, not as 24 rows
