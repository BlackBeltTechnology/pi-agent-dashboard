## MODIFIED Requirements

### Requirement: Consecutive tool-call bursts collapse into a progress-aware group

The chat view SHALL collapse a maximal run of consecutive tool-like items into a single **group** whenever the run contains 1 or more members. Composition is **semantic-INNER-first, burst-OUTER-second**: the identical-call collapse (`groupConsecutiveToolCalls`) runs FIRST over the ENTIRE message stream, producing a mixed list of `ChatMessage` and `ToolCallGroup` items; the group pass then walks that list. A **tool-like** item is a `toolResult` row OR a `×N` `ToolCallGroup` (which counts as ONE member). The run walks across TRANSPARENT rows (`thinking`, `turnSeparator`, `rawEvent`, `commandFeedback`, and **empty** `assistant` rows with no text) without breaking; a HARD row (`user`, **non-empty** `assistant` prose, `interactiveUi`, `bashOutput`, `inlineTerminal`, or any other role) terminates the run.

Grouping is **turn-scoped**: the group window SHALL extend BACKWARD across LEADING transparent rows that precede the first tool-like member (up to but not including the previous HARD row or start of stream) AND FORWARD across TRAILING transparent rows that follow the last tool-like member (up to but not including the next HARD row or end of stream). All such transparent rows — most importantly `thinking` — are ABSORBED into the group slice. This makes a turn's *opening plan* reasoning (before the first tool) AND its *concluding* reasoning (after the last tool) part of the group rather than standalone rows above or below it. Leading/trailing transparents are absorbed but SHALL NOT count toward member counting; a group still forms on ≥ 1 tool-like member.

A group with a SINGLE tool-like member is valid and SHALL render in the same frame as a multi-member group. Because the semantic pass runs first, identical calls separated by narration prose fold into a nested `×N` BEFORE group formation; the group pass sees that group as a single member. Non-empty `assistant` prose remains a HARD boundary, so a turn's substantive reply between distinct investigation steps stays visible at the top level and splits groups. Group formation SHALL NOT replace or alter the identical-call collapse helper's boundary logic.

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

### Requirement: Running groups group live, auto-expanded, with an honest animated count

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

### Requirement: Burst expansion is a bounded scrollbox and honours display preferences

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

## ADDED Requirements

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
