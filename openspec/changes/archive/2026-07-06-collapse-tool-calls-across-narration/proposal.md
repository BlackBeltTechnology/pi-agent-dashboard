## Why

The `group-tool-call-bursts` change (archived 2026-07-06) added a temporal **burst** pass as the OUTER pass over the semantic identical-call (`×N`) pass, running it FIRST over the raw reducer array with a boundary rule that treats **any non-empty `assistant` prose as a HARD boundary** (design finding 2, "over-merge"). That decision has a severe real-world side effect: pi agents routinely emit a short line of narration before each tool call. When they do, the burst pass slices the run into single-`toolResult` fragments **before** the semantic pass can see them, so:

- **Identical polling loops no longer collapse.** A narrated health-check loop (`curl … "still starting" … curl … "still starting" … curl`) that used to fold into one `×N` pill now renders as a wall of individual rows. Verified reproduction: `[curl, curl, prose, curl, curl]` → 4 standalone rows today vs a single `×4` pill before the change.
- **Heterogeneous bursts also never form** when prose sits between the calls.

Net effect for any narrated session: **neither collapse axis ever fires** — the user observes "collapsed messages in chat view are not shown at all." This is a regression against the pre-existing, spec'd `Polling-loop tool calls collapse across transparent intermediate rows` requirement, whose scenario `Mixed transparent rows do not break the run` explicitly lists `assistant` as transparent.

Separately, even when a `×N` pill *does* form today, the narration between the calls is **silently dropped** (the group keeps only `toolResult` rows). Users want that narration preserved — visible when the pill is expanded — rather than discarded.

## What Changes

- **Flip the composition to semantic-INNER-first, burst-OUTER-second over the semantic OUTPUT** (not the raw array). The identical-call pass runs first over the full stream so narrated poll loops fold into `×N` again (restoring the pre-regression behavior mandated by the polling-loop requirement). The burst pass then groups the semantic output, treating a nested `×N` group as one tool-like member.
- **Keep non-empty `assistant` prose a HARD boundary for HETEROGENEOUS burst formation only.** A real turn-final reply between distinct investigation steps still stays visible at top level and splits bursts — the legitimate case behind the original boundary rule is preserved. Prose is transparent ONLY for identical-call `×N` folding (as it always was pre-#249), never for heterogeneous burst formation.
- **BREAKING (behavioral, client-only):** reverse the archived design's `does NOT over-merge identical calls split by prose` decision. Identical consecutive calls separated by narration SHALL collapse into a `×N` pill again.
- **Fold the absorbed narration into the collapsed entry.** The `thinking` and `assistant`-prose rows absorbed between grouped identical calls (and the absorbed transparents inside a burst) SHALL render inside the EXPANDED view, interleaved in original order with their tool calls — instead of being dropped. Trailing prose after the final grouped call is NOT absorbed (it belongs to the next row) so the turn's final reply stays visible at top level.
- **Add a `keepReasoningOpenUntilTurnEnds` display preference (default OFF).** When ON, live-streamed reasoning blocks stay expanded for the whole active turn and collapse on the turn-end edge (session status leaves `streaming`), bypassing the per-block `reasoningAutoCollapseMs` timer. When OFF, behavior is unchanged (ms timer governs). The two prefs coexist; only live-streamed blocks are affected; a manual toggle freezes the block. Surfaced in `SettingsPanel` (global) and `ChatViewMenu` (per-session override); backfilled to `false` for legacy `displayPrefs` files.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `chat-view`: (0) ADD `Reasoning blocks stay open for the active turn when enabled` — a `keepReasoningOpenUntilTurnEnds` pref that holds live reasoning expanded until the turn-end edge, coexisting with the per-block `reasoningAutoCollapseMs` timer; (1) amend `Polling-loop tool calls collapse across transparent intermediate rows` so the collapsed group's expanded view renders the absorbed narration (`thinking` + `assistant` prose) interleaved with its tool calls, instead of rendering only `ToolCallStep` rows; (2) amend `Consecutive tool-call bursts collapse into a progress-aware group` so composition is burst-over-semantic-output (semantic pass runs first over the full stream), identical calls fold across narration into a nested `×N` even when prose sits between them, and absorbed transparents render inside the burst scrollbox.

## Impact

- **Code (modifications):**
  - `packages/client/src/lib/group-tool-calls.ts` — carry the absorbed intermediate rows on the `ToolCallGroup` (new field, e.g. `rendered: ChatMessage[]` = the full interleaved slice) so the expanded view can show narration; `messages` (toolResult-only) still drives the count/summary. Boundary logic unchanged.
  - `packages/client/src/lib/group-tool-bursts.ts` — run `groupConsecutiveToolCalls` over the FULL stream first, then walk that `ChatItem[]` forming bursts over tool-like items (a `×N` group counts as one member) with non-empty prose as a hard boundary. Remove the raw-array-first walk.
  - `packages/client/src/components/CollapsedToolGroup.tsx` — expanded view renders the interleaved narration rows (thinking/prose) alongside `ToolCallStep`.
  - `packages/client/src/components/ToolBurstGroup.tsx` — render absorbed transparent narration inside the scrollbox; consume the semantic-first `ChatItem[]` shape.
  - Tests: update `group-tool-bursts.test.ts` (`does NOT over-merge identical calls split by prose` is inverted), `group-tool-calls` tests for the new `rendered` field, and add narration-fold coverage.
  - `packages/shared/src/display-prefs.ts` — add `keepReasoningOpenUntilTurnEnds: boolean` to `DisplayPrefs`, all three `DISPLAY_PRESETS` (`false`), and `mergeDisplayPrefs`; `PartialDisplayPrefs` mapped type auto-covers.
  - `packages/server/src/preferences-store.ts` — `backfillDisplayPrefs` defaults the field to `false` for legacy files; `setDisplayPrefs` base literal + merge include it.
  - `packages/client/src/components/ThinkingBlock.tsx` — new `keepOpenUntilTurnEnds` + `turnActive` props; effect holds the live block open while `turnActive`, collapses on the true→false edge, suppressing the ms timer.
  - `packages/client/src/components/ChatView.tsx` — pass `keepOpenUntilTurnEnds={prefs.keepReasoningOpenUntilTurnEnds}` + `turnActive={state.status === "streaming"}` to `ThinkingBlock`.
  - `packages/client/src/components/SettingsPanel.tsx` + `ChatViewMenu.tsx` — new toggle (disabled when `reasoning` is off).
  - Tests: `ThinkingBlock.test.tsx` (turn-hold + turn-end-edge collapse), `display-prefs.test.ts` (preset default + override precedence).

  Note: the reasoning-hold pref is a self-contained addition recorded into this change per request; it shares the chat-view capability but is independent of the tool-call collapse composition flip.
- **Spec:** modify two `chat-view` requirements (deltas below). No new capability name.
- **Shared preference plumbing changes (reasoning-hold pref only).** The `keepReasoningOpenUntilTurnEnds` pref is persisted via shared `DisplayPrefs` + server backfill; the tool-call collapse transform stays pure client-side render, collapse state component-local `useState`. No protocol / API changes.
- **Interaction:** operates on the same reducer array as `preserve-chat-head-on-event-trim`, `reconstruct-reasoning-on-replay`; grouping stays a pure read keyed on role adjacency, tolerant of seq gaps.

## Discipline Skills

- `doubt-driven-review` — this reverses a deliberately-specified, tested design decision (archived design finding 2 / contract #6); stress-test the boundary rules before the change stands.
- `code-simplification` — the composition flip should net-simplify `group-tool-bursts.ts` (one pass over semantic output vs a bespoke raw-array walk); verify it does not accrete complexity.
