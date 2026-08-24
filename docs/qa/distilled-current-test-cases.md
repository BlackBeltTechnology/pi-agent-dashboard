# Distilled Current-State Playwright Test Cases

> **Generated:** 2026-07-04. Companion to `archived-frontend-test-cases.md`.
> **340** distinct, **code-verified** test cases distilled from **1811** historic candidates (431 archived changes).
> Every case was checked against the CURRENT source in `packages/client/src` + plugin `src/client` dirs. Drifted behaviors were dropped.

## What this is

The historic inventory captured *what was once true*. This document captures *what is testable now*. Pipeline:

1. **1811** historic candidates → anchor-grep vs current code → dropped **102 DRIFTED + 41 no-UI**.
2. Remaining **1668** clustered into 18 functional surfaces; each surface's cases checked by `google/gemma-4-31b-it` workers **against a digest of the real current component source** (testids, visible text, roles, handlers) → **482** code-grounded assertions kept, the rest dropped as drifted.
3. Per-surface dedup + coverage tagging vs the **32 existing `tests/e2e/*.spec.ts`** → **340** distinct cases.

## Legend

- **[NEW]** — coverage gap: no existing e2e spec tests this. Highest-value to author. (**320** cases)
- **[COVERED]** — an existing `tests/e2e` spec already asserts this. (**20** cases)
- **[target]** — the current component or `data-testid` the case exercises (from live source).

## ⚠️ Caveat

Cases are grounded in a *source digest* (testids/text/handlers), not a running app. Before authoring a spec, open the named component to confirm the exact selector and interaction. Digests can miss dynamically-generated testids.

## Summary by Surface

| Surface | Total | NEW (gap) | COVERED |
|---|---|---|---|
| Session Cards, List & Sidebar | 57 | 55 | 2 |
| Chat & Message Rendering | 42 | 38 | 4 |
| Composer & Command Input | 37 | 35 | 2 |
| Tool-Call Renderers & Output | 23 | 22 | 1 |
| Flows | 20 | 20 | 0 |
| Subagent Inspector | 2 | 2 | 0 |
| Goals & Automation | 21 | 21 | 0 |
| Settings, Provider Auth & Packages | 39 | 36 | 3 |
| Internal Editor Pane | 19 | 18 | 1 |
| Diff, Git & Worktrees | 16 | 16 | 0 |
| Terminal | 4 | 3 | 1 |
| Theme | 5 | 5 | 0 |
| Mobile, Routing & Navigation | 7 | 7 | 0 |
| OpenSpec | 13 | 13 | 0 |
| File Preview & Media | 10 | 8 | 2 |
| Interactive Renderers (ask_user) | 9 | 8 | 1 |
| Status Bar & Banners | 16 | 13 | 3 |
| **TOTAL** | **340** | **320** | **20** |

---

## Session Cards, List & Sidebar

- [ ] **NEW** [session-card-desktop] Selecting a session card applies the selected highlight (blue border + tint + ring) and expands it to reveal detail sections; non-selected cards stay compact with the blended secondary+tertiary background.
- [ ] **NEW** [session-card-spawn-worktree] Clicking session-card-spawn-worktree opens the WorktreeSpawnDialog scoped to the session cwd and spawns a worktree-backed sibling card; with an attached proposal it opens the proposal-aware dialog (branch `os/<change>`).
- [ ] **NEW** [session-card-spawn-worktree] A worktree spawn renders a placeholder-session-card under the parent repo folder group and replaces it in-slot at the top of the pinned group with no orphaned placeholder.
- [ ] **NEW** [session-card-spawn-sibling] session-card-spawn-sibling renders on live, ended (alongside Resume/Fork), and no-sessionFile cards; it is disabled with a changed tooltip when cwdMissing.
- [ ] **NEW** [session-card-spawn-sibling] Clicking session-card-spawn-sibling on a card with an attached proposal spawns with the parent's cwd and the proposal pre-attached.
- [ ] **NEW** [resume-error-banner] A failed resume renders a persistent resume-error-banner dismissible via resume-error-dismiss.
- [ ] **NEW** [dragHandleProps] Dragging an ended session card onto an alive card in the same folder triggers drag-to-resume; on failure resume-error-banner appears.
- [ ] **NEW** [session-activity-bar] A streaming session with in-flight bash toolCalls renders session-activity-bar with one session-activity-row per command showing command + elapsed time; it disappears when no tool is in flight, and absent for a session with no long-running processes.
- [ ] **NEW** [session-activity-stop] Clicking session-activity-stop on a session-activity-row calls abortToolCall to halt that tool run and removes the row.
- [ ] **NEW** [session-activity-overflow] With more than 2 in-flight bash rows, a session-activity-overflow "+N more" chip appears after 2 rows and lists the hidden commands in its title.
- [ ] **NEW** [background-drawer-chip] A session with background processes and no stored choice renders the drawer collapsed showing the `⚠ N background processes` summary row with the count.
- [ ] **NEW** [background-drawer-sheet] Toggling background-drawer-chip flips the drawer open optimistically and the open state persists across reload.
- [ ] **NEW** [background-drawer-sheet] A cross-client broadcast updates the background drawer collapsed state in an already-open dashboard.
- [ ] **NEW** [header-app-bar] The sidebar header renders header-app-bar (logo + settings-btn) and header-filter-bar as two distinct rows.
- [ ] **NEW** [settings-btn] Clicking settings-btn opens the settings/workspace resources surface.
- [ ] **NEW** [session-search-input] Typing in session-search-input filters cards by case-insensitive substring on the display name and renders folder-search-empty when nothing matches.
- [ ] **NEW** [workspace-filter-input] With a session-search-input query and empty workspace-filter-input, only pinned folders are searched until a workspace-filter value is entered.
- [ ] **NEW** [queue-count-badge] A session with queued prompts renders queue-count-badge showing the pending count.
- [ ] **NEW** [session-status-icon] session-status-icon shows solid green (active), pulsing yellow with animate-pulse (streaming), and gray (ended), conveying state via icon/shape not hue alone, with the source label as tooltip.
- [ ] **NEW** [state-pill] state-pill reflects the session's current status and updates live on server transitions without reload; ask_user shows "Needs you" (non-green dot), idle shows muted "Idle", IMPLEMENTING shows the change state label.
- [ ] **NEW** [worktree-pill] A session with gitWorktree set renders worktree-pill with bare `worktree` label, tooltip `created from <base>` when base known else `git worktree`; a session without it renders no worktree-pill.
- [ ] **NEW** [git-init-btn] A non-git cwd renders git-init-btn; clicking it starts git init (opening an interactive session when there is no worktreeInit hook) — an initialized repo renders git-branch-btn instead.
- [ ] **NEW** [git-branch-btn] Clicking git-branch-btn opens the branch picker/switcher dialog.
- [ ] **NEW** [git-branch-btn] Dispatching git_head_update { branch: "develop" } updates git-branch-btn to "develop"; a folder HEAD entry overrides any worktree child branch, else it falls back to the session/fetched branch.
- [ ] **NEW** [OPENSPEC] An expanded card renders the OPENSPEC section collapsed by default; clicking its header toggles it open via onToggle.
- [ ] **NEW** [OPENSPEC] The OPENSPEC section lists changes grouped in-progress/completed with task counts and is hidden for projects with no openspec/ directory.
- [ ] **NEW** [OPENSPEC] Clicking an OpenSpec action button (Continue/FF/Apply) sends the corresponding command to the session.
- [ ] **NEW** [settings-btn] Toggling "Enable OpenSpec" hides the OPENSPEC subcard across cards and re-enabling restores it.
- [ ] **NEW** [SessionCard] Triggering activity for `openspec/changes/add-auth/...` auto-renames the card name to `add-auth` and shows the attached-proposal chip; a UUID-shaped path leaves the name unchanged and attached-proposal chip unset.
- [ ] **NEW** [SessionCard] A card renders subcard titles only for sections with content: MEMORY absent with no plugin claim, FLOWS absent with no flow claims.
- [ ] **NEW** [session-activity-bar] Running a flow renders the session-activity-bar / activity badge on the session card.
- [ ] **NEW** [SessionCard] A session with no custom name displays the directory basename (cwd.split("/").pop()); clicking the name region navigates to `/session/:id` and highlights it after reload.
- [ ] **NEW** [session-hide-btn] Clicking session-hide-btn removes the card from the default list and swaps in session-unhide-btn; with "Show hidden" the muted card's session-unhide-btn restores it, and neither navigates (stopPropagation).
- [ ] **NEW** [session-close-btn] Clicking session-close-btn dims the card and swaps ✕ for a spinner; a streaming session confirms first; re-clicking while closing is disabled; on timeout without session_removed it reverts and re-enables.
- [ ] **NEW** [session-close-btn] Closing removes only that session's card, leaves siblings, and transitions its session-status-icon to ended.
- [ ] **NEW** [SessionCard] On `session_removed` the card unmounts and disappears.
- [ ] **NEW** [folder-toggle-btn] Clicking folder-toggle-btn collapses/expands the folder's session group (header stays visible) and the collapsed state persists across reload.
- [ ] **NEW** [folder-toggle-btn] Clicking "+ New Session" on a collapsed folder expands it and shows the placeholder/new session card; the parent's "+ New Session" is disabled during an in-flight spawn.
- [ ] **NEW** [folder-ended-toggle-group] Each folder renders a collapsed `N ended` toggle below its alive sessions; clicking it expands the ended group and reveals the Hide ended toggle (folder-ended-toggle-top-group).
- [ ] **NEW** [placeholder-session-card] Clicking a group's spawn/New button renders placeholder-session-card at the top of that group, replaced when the real session registers; two spawns produce two distinct placeholders.
- [ ] **NEW** [drag-handle] Dragging the sidebar drag-handle resizes it, clamps within bounds, and persists across reload.
- [ ] **NEW** [sidebar-collapse] Clicking sidebar-collapse (on the ResizableSidebar edge, not the header toolbar) collapses to the narrow strip; sidebar-expand restores it, and the state survives reload.
- [ ] **NEW** [workspace-drag-handle-id] Dragging workspace-drag-handle-id reorders workspaces, emits `reorder_workspaces`, and persists after reload; the dragged workspace collapses during drag and restores its state on drop.
- [ ] **NEW** [folder-toggle-btn] Dragging a folder within a workspace reorders it, emits `reorder_workspace_folders`, and persists; dropping into another workspace is a no-op.
- [ ] **NEW** [sortable-pinned-group] Pinned folder groups render inside sortable-pinned-group with working dragHandleProps; dragging group A onto group B swaps order and persists.
- [ ] **NEW** [dragHandleProps] Dragging a session card by its handle reorders it within its folder group (without changing pinned-group order) and persists after reload; press-and-hold shows the grabbing cursor.
- [ ] **NEW** [sortable-pinned-group] A hovered workspace/folder/group drop slot shows a dashed accent outline while session slots show only slide feedback.
- [ ] **NEW** [workspace-name-id] A directory group header shows the full absolute path middle-truncated with `…`, preserving root prefix and trailing directory name.
- [ ] **NEW** [workspace-toggle-id] Clicking workspace-toggle-id collapses the workspace's folder rows and the collapsed state persists across reload; the header shows a pin toggle on the right.
- [ ] **NEW** [workspace-menu-id] WorkspaceHeader renders no add-folder pin icon; an expanded workspace body shows a full-width `+ Add Folder` button.
- [ ] **NEW** [folder-toggle-btn] A folder added to a workspace stays visible even when unpinned with zero sessions.
- [ ] **NEW** [sortable-pinned-group] An empty pinned directory group still renders editor buttons and a spawn/New button.
- [ ] **NEW** [InlineRenameInput] Double-clicking a session name opens the inline rename input; Enter confirms the new name, Escape restores the previous.
- [ ] **NEW** [mobile-card-attached-chip] On a mobile viewport subcard panels are hidden and mobile-card-attached-chip renders with per-letter (P/D/S/T) artifact status colors; detaching a proposal removes it, attaching a change to an unnamed session sets the title and shows it.
- [ ] **NEW** [folder-ended-toggle-group.cwd] After reconnect, no active session renders below the "Show N ended" divider toggle.
- [x] _COVERED_ [session-card-spawn-sibling] Clicking session-card-spawn-sibling spawns a new session in the folder's cwd and the card appears already attached after the round-trip.
- [x] _COVERED_ [git-branch-btn] A session in a git repo shows the branch indicator via git-branch-btn.

## Chat & Message Rendering

- [ ] **NEW** [MarkdownContent] A fenced code block renders a highlighted `<code>` block and inline code renders with an inline-code background, not literal backticks.
- [ ] **NEW** [MarkdownContent] A markdown heading/list/bold message renders formatted HTML (no invalid nested `<p>`), not literal markdown characters.
- [ ] **NEW** [MarkdownContent] A GFM table renders as a `<table>` element, not raw pipe text.
- [ ] **NEW** [MarkdownContent] A local markdown image renders once its closing token streams in and still renders after reconnect/replay of an asset_register log.
- [ ] **NEW** [ToolCallStep] A `tool_execution_start` renders a collapsed tool card with a running spinner and visible args, no auto-expand.
- [ ] **NEW** [ToolCallStep] Expanding a ToolCallStep reveals both the args and the result output section.
- [ ] **NEW** [ToolCallStep] A streaming `tool_execution_update` updates the existing tool card's result in place with no duplicate card.
- [ ] **NEW** [ToolCallStep] A tool entry with `isError:true` paints the row border and name red.
- [ ] **NEW** [ToolCallStep] A tool entry with output shows the collapse/show-full toggle; an entry without output shows no toggle.
- [ ] **NEW** [ToolCallStep] Opening a long historical session renders each tool card exactly once and the count stays byte-stable across reconnect.
- [ ] **NEW** [tool-collapse-output] A >200-line tool result shows the last 200 lines with a "«N earlier lines hidden»" marker; tool-show-full-output expands and tool-collapse-output collapses it.
- [ ] **NEW** [tool-stop-button] Clicking "Stop after turn" ends the session after the current turn with the final assistant message intact and no aborted-tool errors.
- [ ] **NEW** [tool-force-stop-button] The "Force Kill" control renders, distinct from "Stop after turn", and stops a running tool call.
- [ ] **NEW** [reasoning-block] A completed thinking block renders collapsed with a brain icon; clicking toggles reasoning-body to show/hide full text.
- [ ] **NEW** [reasoning-block] A live streaming reasoning block shows a streaming indicator while expanded.
- [ ] **NEW** [reasoning-block] An empty thinking block produces no reasoning-block in the timeline.
- [ ] **NEW** [reasoning-body] Toggling a live reasoning block before expiry cancels its auto-collapse and keeps reasoning-body under manual control.
- [ ] **NEW** [pending-prompt-card] A queued follow-up shows a pending-prompt-card chip with edit, remove, promote, and to-editor controls.
- [ ] **NEW** [pending-prompt-card] An `extension_ui_request` confirm renders an inline pending-prompt-card with confirm/cancel; resolving collapses it to a summary.
- [ ] **NEW** [pending-prompt-card] Enter on an ended session keeps the optimistic pending-prompt-card visible across resume→replay→first user_message and session_state_reset.
- [ ] **NEW** [pending-prompt-card] Pressing Stop/Esc during an in-flight resume clears the pending-prompt-card and re-enables the input.
- [ ] **NEW** [pending-steer-card] A mid-stream steer renders a STEERING ghost user bubble anchored after the streaming text; it survives refresh via replay and clicking ✕ removes it while the agent continues.
- [ ] **NEW** [ChatView] With both steer and follow-up queues empty, neither pending-steer-card nor pending-prompt-card renders.
- [ ] **NEW** [chat-view-modified-pill] After a per-session view override, chat-view-modified-pill appears; clicking "Use global settings" clears the override and removes the pill.
- [ ] **NEW** [chat-view-popover] Opening the ⚙ View menu renders chat-view-popover with all tool-call toggle rows on-screen, flipping upward near the viewport bottom.
- [ ] **NEW** [chat-view-popover] Hiding a tool call via the ChatView popover affects only the current session.
- [ ] **NEW** [scroll-to-bottom] The button appears when scrolled away from the bottom, hides near the bottom, and clicking it returns the view to the latest message.
- [ ] **NEW** [chat-history-skeleton] Opening a loading session renders chat-history-skeleton and not "No messages yet"; it is replaced by message bubbles with no flash once history arrives.
- [ ] **NEW** [ChatView] Opening a genuinely empty session shows "No messages yet" and no chat-history-skeleton.
- [ ] **NEW** [ChatView] Assistant text bubble renders above its tool-call/reasoning card, and the order is preserved after reload/replay.
- [ ] **NEW** [ChatView] Sending a `!command` renders its bash output block (including non-zero-exit output) in the chat view.
- [ ] **NEW** [ChatView] Sending a `/slash` command shows command-execution feedback rather than posting a plain user message.
- [ ] **NEW** [ChatView] A session with no content-view plugin still renders the chat pane and it stays visible after server restart/reload.
- [ ] **NEW** [MinimalChatView] On mobile width, pressing the header Back arrow navigates to the session-card list (`/`).
- [ ] **NEW** [MinimalChatView] Clicking Back from the markdown preview restores the hidden chat view.
- [ ] **NEW** [LinkifiedText] Output with `.pi/settings.json` renders one clickable link with the full path (no `.js` truncation, no stray `on`).
- [ ] **NEW** [LinkifiedText] A `javascript:`/`data:` URI in tool output is not rendered as a clickable link.
- [ ] **NEW** [LinkifiedText] Prose like `version 1.0.0` or `and/or` produces no false-positive file link.
- [x] _COVERED_ [reasoning-block] A live reasoning block stays expanded then auto-collapses after reasoningAutoCollapseMs; reload renders replayed blocks collapsed; reasoningAutoCollapseMs=0 keeps it open until clicked.
- [x] _COVERED_ [pending-prompt-card] Sending to an idle session shows an optimistic bubble that confirms with no leftover card; a mid-turn send shows a queue chip, not an optimistic bubble.
- [x] _COVERED_ [LinkifiedText] `src/foo.ts:42` renders an inline clickable OpenFile link and an http(s) URL renders `<a target="_blank" rel="noopener noreferrer">`, drag-selectable and click-to-open.
- [x] _COVERED_ [ToolCallStep] A tool result exceeding the threshold ships the truncated display form and exposes show/collapse toggles.

## Composer & Command Input

- [ ] **NEW** [composer-root] The composer renders a multiline textarea, not a single-line input.
- [ ] **NEW** [composer-root] Pressing Shift+Enter inserts a newline instead of sending.
- [ ] **NEW** [composer-root] Typing `/` opens a command autocomplete dropdown listing available commands.
- [ ] **NEW** [composer-root] Typing `/dep` then Tab (or clicking the dropdown row) fills the input with `/deploy `.
- [ ] **NEW** [composer-root] Typing a registered `module.command` slash command opens the GenericExtensionDialog.
- [ ] **NEW** [composer-root] Typing `@` opens a file-path mention dropdown (top-level entries alphabetically); Tab on a file suggestion inserts `@path/to/file`.
- [ ] **NEW** [composer-root] The composer textarea auto-resizes its height as multiple lines are entered.
- [ ] **NEW** [composer-root] Reloading restores the per-session draft (`chat-draft:<sessionId>`); switching sessions shows each session's own draft with no leak.
- [ ] **NEW** [composer-root] ArrowUp on an empty composer recalls the most recent prompt; repeated ArrowUp walks further back; ArrowDown walks forward and restores the draft.
- [ ] **NEW** [composer-root] ArrowUp with a non-empty single-line or first-line multiline draft does NOT recall history.
- [ ] **NEW** [composer-root] Escape during history walk exits history mode and restores the draft.
- [ ] **NEW** [composer-root] With the `/` dropdown open, ArrowUp navigates the dropdown, not history.
- [ ] **NEW** [composer-root] Ctrl/Cmd+ArrowUp with non-empty text recalls the most recent prompt; Escape restores the prior draft.
- [ ] **NEW** [composer-root] Ctrl/Cmd+ArrowDown walks forward and restores the in-progress draft past newest.
- [ ] **NEW** [composer-root] Ctrl+ArrowUp with empty text but a pending image keeps the image and does NOT recall history.
- [ ] **NEW** [composer-root] Ctrl+ArrowUp while the `/`-command dropdown is open does NOT recall history.
- [ ] **NEW** [ImagePreviewStrip] Pasting an image into the composer shows a preview thumbnail before sending.
- [ ] **NEW** [ImagePreviewStrip] Clicking a paste preview thumbnail opens the lightbox.
- [ ] **NEW** [ImagePreviewStrip] After a successful send, the preview strip is emptied.
- [ ] **NEW** [stop-button] Clicking stop-button transitions to a force-stop-button state with a distinct (orange/pulsing) style.
- [ ] **NEW** [force-stop-button] Clicking force-stop-button issues force-kill and shows the disabled killing-button state.
- [ ] **NEW** [stop-button] The stop/force-stop button state resets when the session status changes.
- [ ] **NEW** [stop-button] A transient retry state shows the yellow retrying banner with a stop-button and nothing else.
- [ ] **NEW** [model-selector] With no provider credentials, the model-selector renders disabled / shows "no model".
- [ ] **NEW** [model-selector] After a `models_refreshed` broadcast, the disabled model-selector becomes enabled and repopulates models for the session.
- [ ] **NEW** [model-dropdown] Clicking model-selector-button opens model-dropdown with a provider-filter for role model selection.
- [ ] **NEW** [model-selector] The custom provider's models appear in the model-dropdown.
- [ ] **NEW** [model-refresh] The model-dropdown footer renders a model-refresh control.
- [ ] **NEW** [send-button] Pressing Enter sends the prompt with delivery "steer".
- [ ] **NEW** [send-button] With a file preview overlay open, clicking send-button sends the prompt (backdrop does not intercept the click).
- [ ] **NEW** [queue-followup-position] Multiple queued prompts render in insertion order with a correct queue-followup-position count.
- [ ] **NEW** [queue-followup-clear-all] Clicking queue-followup-clear-all empties the QueuePanel.
- [ ] **NEW** [queue-chip-followup] The queue-chip-followup element carries the `max-h-80` and `overflow-auto` classes.
- [ ] **NEW** [send-button] Entering bare `!!` opens an inline terminal card in the chat stream.
- [ ] **NEW** [InputComposer] A batch input sub-question renders the InputComposer textarea (with paste support), not a single-line input.
- [x] _COVERED_ [open-inline-terminal-button] Clicking open-inline-terminal-button opens the inline terminal (xterm mounts).
- [x] _COVERED_ [queue-chip-followup] Sending a prompt while the agent is streaming adds a queue-chip-followup showing the pending text, not an optimistic bubble.

## Tool-Call Renderers & Output

- [ ] **NEW** [tool-collapse-output] A long bash command in a collapsed ToolCallStep row is CSS-ellipsized and its full text is exposed via the row's `title` attribute.
- [ ] **NEW** [collapsed-group] A collapsed CollapsedToolGroup row exposes the full summary in its `title` attribute without truncation.
- [ ] **NEW** [BashToolRenderer] Expanding a bash tool call renders the complete command wrapping via `break-all` rather than truncating.
- [ ] **NEW** [AgentToolRenderer] A long Agent description shows its full text in the collapsed row's tooltip.
- [ ] **NEW** [BashOutputCard] An absolute POSIX path in Bash output is linkified and opens the correct file with root not stripped.
- [ ] **NEW** [BashOutputCard] A `file://` link (including `%20`-encoded) in tool output opens the correct decoded file.
- [ ] **NEW** [BashOutputCard] Clicking a worktree-session file link re-roots the token under the parent root and opens the worktree path via `POST /api/open-editor`.
- [ ] **NEW** [GenericToolRenderer] A generic-extension path like `config/app.toml` renders as a clickable file link.
- [ ] **NEW** [GenericToolRenderer] A bare `README.md` or `Node.js` in prose does not render as a clickable file link.
- [ ] **NEW** [tool-show-full-output] Clicking tool-show-full-output reveals the full untruncated output and tool-collapse-output collapses it again.
- [ ] **NEW** [tool-show-full-output] A truncated result shows the tool-show-full-output control instead of a "0 agents" placeholder.
- [ ] **NEW** [bash-show-full-output] Clicking bash-show-full-output expands the full bash output in BashOutputCard.
- [ ] **NEW** [AgentToolRenderer] A flow_agents card with a truncation-marker result renders a truncated/expandable indicator and does not show "0 agents".
- [ ] **NEW** [AgentToolRenderer] A flow_agents card with a genuinely empty result (`[]`) renders "0 agents".
- [ ] **NEW** [AgentToolRenderer] An Agent/sub-agent tool call renders via AgentToolRenderer and expands on click.
- [ ] **NEW** [rich-diff] On desktop, expanding an Edit card with old/new text renders syntax-highlighted RichDiff, not DiffView.
- [ ] **NEW** [DiffView] On mobile, expanding an Edit card renders the homegrown DiffView, not RichDiff.
- [ ] **NEW** [rich-diff] On desktop, an Edit card with three edits[] renders exactly three RichDiff instances separated by borders.
- [ ] **NEW** [DiffView] On mobile, an Edit card with three edits[] renders exactly three DiffView instances.
- [ ] **NEW** [EditToolRenderer] An Edit result with a single oldText/newText renders exactly one diff block.
- [ ] **NEW** [EditToolRenderer] An Edit card with neither old/new text nor edits[] renders raw JSON in a `<pre>` regardless of viewport.
- [ ] **NEW** [collapsed-group] CollapsedToolGroup renders collapsed by default and clicking collapsed-group expands to reveal the tool detail block.
- [x] _COVERED_ [ReadToolRenderer] A read tool renderer mounts for a faux tool call.

## Flows

- [ ] **NEW** [flow-agent-detail] Clicking a FlowAgentCard's Details button opens the agent detail Dialog showing its Summary section with typed outputs and file list.
- [ ] **NEW** [flow-summaries] After a flow completes, FlowSummary renders frozen agent cards above the summary lines in flow-summaries.
- [ ] **NEW** [flow-summary-toggle] Clicking flow-summary-panel-toggle/flow-summary-toggle expands and collapses the summary rows in flow-summary-scrollbox while agent cards stay visible.
- [ ] **NEW** [flow-graph] FlowGraph renders on_complete edges as plain solid arrows with no label while branch/on_error edges keep labels.
- [ ] **NEW** [flow-graph] Error-route (⚠) edges are hidden by default and the toggle state persists across remount/reload.
- [ ] **NEW** [flow-graph] Clicking "Expand graph" opens the enlarged FlowGraph/summary Dialog at near-fullscreen.
- [ ] **NEW** [flows-new-edit-button] Clicking flows-new-edit-button (New / Edit…) opens the flow picker with "Search flows..." and "Pick a flow to edit, or + New flow…".
- [ ] **NEW** [flows-new-edit-button] The flow picker lists flows by name from flows_list data and filters via "Search flows...".
- [ ] **NEW** [flows-new-edit-button] Choosing "+ New flow…" initiates flow-new without an error state.
- [ ] **NEW** [flows-new-edit-button] Selecting an existing flow under "New / Edit flow" opens its edit action.
- [ ] **NEW** [flow-launch-run] Filling "Describe the task (optional)..." and clicking Run (flow-launch-run) submits the flow launch dialog.
- [ ] **NEW** [flow-launch-run] A gated unavailable flow in FlowLaunchDialog appears greyed out with its reason on tooltip.
- [ ] **NEW** [SessionFlowActions] Clicking Run Flow… opens the flow run menu; Delete Flow removes the selected flow.
- [ ] **NEW** [flow-activity-badge] Clicking Abort in FlowActivityBadge aborts the running flow.
- [ ] **NEW** [FlowDashboard] Toggling AUTO (Toggle autonomous mode) switches autonomous mode and Abort flow aborts the active flow.
- [ ] **NEW** [flow-question-card] Submitting flow-question-card via Submit (or Yes) posts the answer and Dismiss clears the card.
- [ ] **NEW** [flow-questions-transcript] A flow-tagged prompt renders the question widget in FlowDashboard's flow-questions-transcript slot, not in the chat message stream.
- [ ] **NEW** [flow-question-card] A non-flow ask_user prompt renders via the default chat adapter while flow-tagged prompts render in flow-question-card.
- [ ] **NEW** [FlowAgentCard] A flow agent card displays its name, status, and stats via the ui:agent-card primitive with a stepType-distinct icon/accent (decision/loop/fork vs worker).
- [ ] **NEW** [FlowAgentCard] An event lacking nodeKind falls back to a FlowAgentCard without breaking the grid, showing Details/Loading… states.

## Subagent Inspector

- [ ] **NEW** [SubagentDetailView] Triggering a hidden worker subagent keeps ChatWindow on the current session and surfaces the subagent in SubagentDetailView showing "Result" or "Subagent not found in this session."
- [ ] **NEW** [SubagentPopoutPage] Opening a subagent popout renders the parent session (or "Parent session not found") with a working Close tab / Back control.

## Goals & Automation

- [ ] **NEW** [goal-chip] Broadcasting a new snapshot updates the goal-chip text between "Achieved" and "Pursuing ${turnsUsed}/${maxTurns}" with the current turn count.
- [ ] **NEW** [goal-control-pause] Clicking goal-control-pause ("Pause loop") updates the goal loop status shown in the chip.
- [ ] **NEW** [run-result-panel] After a run completes, run-result-panel shows the assistant reply text rather than the echoed prompt.
- [ ] **NEW** [run-archived-r.runId] A run with no genuine findings renders as auto-archived/empty (run-archived-r.runId) instead of echoing the prompt.
- [ ] **NEW** [create-automation-dialog] create-automation-dialog renders Identity/Trigger/Action/Advanced sections with create-advanced collapsed until create-advanced-toggle expands it.
- [ ] **NEW** [create-model-selector] The Model field renders create-model-selector with the @role dropdown (create-model-role) instead of free text.
- [ ] **NEW** [trigger-categories] The trigger picker renders a trigger-categories tab strip and a level-2 create-event-ev.event checklist.
- [ ] **NEW** [create-cron] Selecting the scheduled category shows the create-cron helper with a create-next-run preview.
- [ ] **NEW** [trigger-planned-note] Unwired categories/events render disabled with a "coming soon" trigger-planned-note.
- [ ] **NEW** [create-worktree-hint] The worktree mode option is disabled with create-worktree-hint when the target is not a git repo.
- [ ] **NEW** [automation-def-a.name] Opening automation-def-a.name loads its values into the editor and Delete is reachable via overflow-menu-a.name.
- [ ] **NEW** [goals-board-new] Clicking goals-board-new ("New Goal") opens the centered goal-create-dialog modal.
- [ ] **NEW** [goal-create-dialog-close] Clicking goal-create-dialog-close or the backdrop closes goal-create-dialog.
- [ ] **NEW** [goal-form-submit] Submitting goal-form creates a goal and a new goal-card appears on goals-board-page.
- [ ] **NEW** [goal-form] goal-form exposes goal-form-criterion, goal-form-max-turns, goal-form-max-spend, and goal-form-judge inputs whose values render on the goal board.
- [ ] **NEW** [goal-card-verdict] The goal detail renders per-turn judge verdict history entries (goal-card-verdict).
- [ ] **NEW** [automation-run-r.runId] A running automation card shows the barber-pole stripe overlay and a "⏹ Stop" control.
- [ ] **NEW** [automation-triage] The runs table (automation-run-r.runId) shows a findings count and a status-specific run-result-r.runId link.
- [ ] **NEW** [create-action-picker] The action control renders a grouped accordion listing core.prompt and core.skill, filterable via create-action-search.
- [ ] **NEW** [automation-board-back] Clicking automation-board-back on the Automations board navigates to "/".
- [ ] **NEW** [run-result-empty] On the automation run monitor, run-result-empty renders when a run yields no findings.

## Settings, Provider Auth & Packages

- [ ] **NEW** [settings-content] Navigating to `/settings/<page>` renders that page inside settings-content.
- [ ] **NEW** [settings-content] Navigating to `/settings` redirects to general; `?tab=advanced`/`?tab=servers` replace-redirect to canonical pages.
- [ ] **NEW** [settings-nav-rail] Each settings section renders on exactly one nav-rail page with no duplicate across pages.
- [ ] **NEW** [settings-content] At 390px on /settings/general, settings-content has non-zero width and sits fully on-screen.
- [ ] **NEW** [settings-nav-rail] At ≥1024px, settings-nav-rail renders as a vertical left rail with settings-content filling the right.
- [ ] **NEW** [settings-nav-rail] Clicking through nav-rail items renders each section's distinct content in settings-content.
- [ ] **NEW** [settings-save-bar] Editing any settings control reveals settings-save-bar; with no edits it stays hidden.
- [ ] **NEW** [unsaved-count] settings-save-bar shows unsaved-count reflecting the number of dirty controls.
- [ ] **NEW** [settings-save-bar] Editing fields across multiple sections then clicking save-btn sends all changed values in one save with unsaved-count reflecting the total.
- [ ] **NEW** [discard-btn] Clicking discard-btn reverts buffered edits, clears unsaved-count, and hides settings-save-bar.
- [ ] **NEW** [nav-dirty-item] A page with unsaved edits shows a nav-dirty-item indicator in the left nav rail.
- [ ] **NEW** [unsaved-changes-dialog] Navigating away with unsaved changes opens unsaved-changes-dialog with unsaved-cancel/unsaved-discard/unsaved-save actions.
- [ ] **NEW** [bypass-urls-textarea] Editing bypass-urls-textarea and clicking save-btn persists the auth bypass URL list across reload.
- [ ] **NEW** [ProviderAuthSection] Provider auth section lists providers with authenticated/expiry status and login/logout controls.
- [ ] **NEW** [ProviderAuthSection] Saving a provider with an empty/whitespace name shows an inline error and does not drop it.
- [ ] **NEW** [ProviderAuthSection] Re-saving a provider whose key field shows masked `***` does not overwrite the stored key indicator.
- [ ] **NEW** [test-pill] Clicking test-provider-button surfaces a test-pill result affordance for the provider check.
- [ ] **NEW** [proxy-toggle] Toggling proxy-toggle and clicking save-btn persists the model-proxy setting across reload.
- [ ] **NEW** [proxy-toggle] Saving settings with model-proxy controls untouched preserves the previously saved proxy-toggle/default-model-input values.
- [ ] **NEW** [default-model-input] Editing default-model-input and saving persists the new value after reload.
- [ ] **NEW** [second-port-input] Entering an invalid second-port value surfaces second-port-error.
- [ ] **NEW** [listen-interface-select] Selecting a non-local listen-interface-select value renders listen-exposure-warning.
- [ ] **NEW** [trusted-networks-add-local] Clicking trusted-networks-add-local opens a dropdown of detected local CIDRs and adds them to trusted-networks-list.
- [ ] **NEW** [trusted-networks-manual-input] Typing a CIDR into trusted-networks-manual-input, clicking trusted-networks-manual-add then save-btn keeps the entry in trusted-networks-list after reload.
- [ ] **NEW** [trusted-networks-remove-net] Clicking trusted-networks-remove-net removes only that row from trusted-networks-list.
- [ ] **NEW** [trusted-networks-list] Removing all entries and clicking save-btn leaves trusted-networks-list empty after reload.
- [ ] **NEW** [trusted-networks-legacy-hint] With a legacy trustedNetworks config present, trusted-networks-legacy-hint is visible in the Security section.
- [ ] **NEW** [diagnostics-section-sec] Diagnostics renders Doctor checks grouped into diagnostics-section-sec blocks.
- [ ] **NEW** [diagnostics-rerun] Clicking diagnostics-rerun re-resolves tools and refreshes diagnostics from /api/doctor.
- [ ] **NEW** [diagnostics-copy-md] Clicking diagnostics-copy-md opens diagnostics-copy-modal with diagnostic markdown.
- [ ] **NEW** [git-source-switch-bundled] Diagnostics git-source rows expose git-source-switch-host / git-source-switch-bundled toggles for bundled vs host source.
- [ ] **NEW** [whats-new-update] A row with a pending update renders the What's-New icon; clicking opens WhatsNewDialog showing whats-new-update/whats-new-breaking entries.
- [ ] **NEW** [package-search-input] Entering a query in package-search-input shows npm results filtered to pi-packages.
- [ ] **NEW** [installed-packages-section] installed-packages-section renders installed entries for the current scope.
- [ ] **NEW** [package-op-banner] Starting a package operation while another runs surfaces a busy state in package-op-banner instead of launching concurrently.
- [ ] **NEW** [plugin-settings-row] A plugin exposing settings renders its plugin-settings-row.id form with persisted fields.
- [x] _COVERED_ [RecommendedExtensions] The recommended-extensions list includes a `context-mode` entry marked strongly-suggested.
- [x] _COVERED_ [recommended-companion-plugin-entry] A recommended extension installed from a local checkout renders an `override` pill whose aria-label names the declared npm identity.
- [x] _COVERED_ [recommended-companion-plugin-entry] A `git:`-prefixed override row badges `git` while a normally npm-installed recommended extension shows no `override` pill.

## Internal Editor Pane

- [ ] **NEW** [markdown-preview] A mermaid fenced code block in the markdown preview renders as an SVG diagram, not plain highlighted code.
- [ ] **NEW** [preview-tab-tab.id] Clicking an artifact letter on a change card opens markdown-preview showing that artifact's tab.
- [ ] **NEW** [OpenFileButton] Activating "More open options" reveals a menu of alternate open actions.
- [ ] **NEW** [EditorTabs] Opening a second file adds a second tab in the "Open files" tablist and makes it the active tab.
- [ ] **NEW** [EditorTabs] Closing a tab via "Close {basename}" activates the next tab.
- [ ] **NEW** [EditorTabs] Reloading the page restores the previously open tabs.
- [ ] **NEW** [MarkdownViewer] md-preview-toggle and md-edit-toggle switch MarkdownViewer between Preview and Edit.
- [ ] **NEW** [MonacoBuffer] Opening a text file renders the Monaco editor with a themed background that recolors on theme switch.
- [ ] **NEW** [md-dirty-dot] Editing a markdown file shows md-dirty-dot and md-save-btn persists the change.
- [ ] **NEW** [EditorFileTree] The file tree renders hidden directories (.git, .pi) as expandable folders.
- [ ] **NEW** [EditorFileTree] Opening a deep file auto-expands ancestor folders and highlights its tree row.
- [ ] **NEW** [EditorFileTree] Switching tabs highlights the corresponding tree row (bidirectional sync).
- [ ] **NEW** [tree-toggle] Clicking tree-toggle toggles the file tree.
- [ ] **NEW** [editor-search-toggle] Clicking editor-search-toggle opens editor-search-panel with editor-search-input focused.
- [ ] **NEW** [regex-toggle] Toggling regex-toggle enables regular-expression matching in editor-search-results.
- [ ] **NEW** [editor-search-close] Clicking editor-search-close closes editor-search-panel.
- [ ] **NEW** [live-preview-launch] Clicking live-preview-launch launches the local dev server preview.
- [ ] **NEW** [preview-back] Clicking preview-back returns from markdown-preview to chat.
- [x] _COVERED_ [OpenFileButton] Clicking Open opens the editor pane with the selected file in a tab, rendering markdown and monaco viewers.

## Diff, Git & Worktrees

- [ ] **NEW** [worktree-base-combobox] Opening the Worktree dialog shows the base-branch combobox trigger collapsed; clicking it opens a popover with the filter input autofocused.
- [ ] **NEW** [worktree-base-combobox] Typing in the base-branch filter narrows the branch list, ArrowDown/ArrowUp moves highlight, and Enter selects it updating the trigger label.
- [ ] **NEW** [worktree-base-combobox] Pressing Escape closes only the base-branch popover leaving the Worktree dialog open, and a no-match string + Enter is a no-op.
- [ ] **NEW** [worktree-source-pr] Selecting "From a pull request" reveals worktree-pr-combobox and typing filters the listed pull requests.
- [ ] **NEW** [worktree-gh-hint] When gh is unavailable the "From a pull request" toggle is disabled and worktree-gh-hint is shown.
- [ ] **NEW** [worktree-source-checkout] Opening plain +Worktree defaults to "Check out existing branch" with a branch picker, no new-branch input, and a `.worktrees/develop` path preview.
- [ ] **NEW** [worktree-new-branch-input] Mounting with attachProposal="add-foo" renders branch `os/add-foo` and worktree-path-input preview `<repo>/.worktrees/add-foo`.
- [ ] **NEW** [worktree-new-branch-input] Changing attachProposal after mount updates the branch input to `os/add-foo` when the user has not typed.
- [ ] **NEW** [worktree-new-branch-input] Typing `feature/x` makes a later attachProposal change not overwrite the branch field (dirty wins).
- [ ] **NEW** [worktree-new-branch-input] Clearing attachProposal when not dirty reverts the branch field to initialBranch, with initialBranch="os/preset" rendering `os/preset`.
- [ ] **NEW** [worktree-dialog-existing] An existing-worktree row without node_modules shows "⚠ Install deps first" instead of "Spawn →".
- [ ] **NEW** [worktree-dialog-orphan-cleanup] A worktree row reporting needs-init/orphan surfaces an Initialize/cleanup control and an error card on failed init.
- [ ] **NEW** [worktree-source-fork] Selecting worktree-source-fork reveals worktree-new-branch-input and worktree-base-combobox.
- [ ] **NEW** [worktree-dialog-branch-reuse] Selecting a branch checked out elsewhere shows worktree-dialog-branch-reuse with the holding worktree path inline.
- [ ] **NEW** [worktree-source-toggle] Opening WorktreeSpawnDialog via fork defaults to worktree-source-fork with worktree-new-branch-input visible.
- [ ] **NEW** [FileDiffView] Navigating to `/session/<id>/diff` on desktop renders FileDiffView and not the "Pick a session on the left" LandingPage.

## Terminal

- [ ] **NEW** [terminal-card] Opening a folder's terminals view renders exactly one `.xterm` element for a single active terminal.
- [ ] **NEW** [TerminalView] Typing a command in the terminal renders its output filling the visible viewport.
- [ ] **NEW** [TerminalView] Resizing the browser window re-fits the terminal without half-rendering or flicker.
- [x] _COVERED_ [terminal-card] Opening the inline terminal mounts an xterm instance.

## Theme

- [ ] **NEW** [theme-toggle] Clicking theme-toggle cycles the resolved theme and applies it to `<html>`.
- [ ] **NEW** [theme-toggle] Resolved theme from theme-toggle persists across reload via localStorage.
- [ ] **NEW** [theme-picker] Clicking theme-picker-trigger reveals theme-picker-dropdown.
- [ ] **NEW** [theme-picker] Selecting a theme-option-theme.id applies the resolved theme to `<html>`.
- [ ] **NEW** [theme-picker] Selected theme persists across reload.

## Mobile, Routing & Navigation

- [ ] **NEW** [mobile-kebab-btn] Clicking mobile-kebab-btn on a live session with no attached proposal opens mobile-action-menu showing "Explore" and "+ New Change" rows.
- [ ] **NEW** [mobile-action-menu] Clicking "+ New Change" opens the NewChangeDialog and sends a prompt containing `/skill:openspec-new-change`.
- [ ] **NEW** [mobile-action-menu] Clicking "Explore" opens the ExploreDialog.
- [ ] **NEW** [mobile-action-menu] The unattached OpenSpec rows are hidden when the session is ended or a proposal is already attached.
- [ ] **NEW** [mobile-action-menu] Tapping Apply, Verify, and Archive rows sends `/skill:openspec-apply-change`, `/skill:openspec-verify-change`, and `/skill:openspec-archive-change` respectively.
- [ ] **NEW** [LandingPage] With no sessions, providers, or folders, LandingPage renders three onboarding step cards.
- [ ] **NEW** [LandingPage] Clicking step ② "Add folder" opens the PinDirectoryDialog.

## OpenSpec

- [ ] **NEW** [new-change-name] Opening NewChangeDialog renders new-change-name and new-change-description input fields.
- [ ] **NEW** [np-create] Submitting NewChangeDialog with a name sends the new-change prompt and closes the dialog; Cancel closes without sending.
- [ ] **NEW** [board-session-row] Clicking a linked session in board-session-row navigates to that session.
- [ ] **NEW** [folder-openspec-section] FolderOpenSpecSection renders only open-board, refresh, archive, and specs actions — no "+ Change" button.
- [ ] **NEW** [folder-archive-btn] folder-archive-btn renders next to folder-specs-btn when OpenSpec is initialized.
- [ ] **NEW** [folder-openspec-pending-spinner] A folder with pending:true renders folder-openspec-pending-spinner in place of the OPENSPEC label.
- [ ] **NEW** [folder-openspec-section] A folder with pending:false and no openspec dir renders no spinner and no folder-openspec-section.
- [ ] **NEW** [folder-openspec-section] An openspec_update with populated changes replaces the spinner with the OPENSPEC (N CHANGES) label.
- [ ] **NEW** [board-filter-text] Typing in board-filter-text narrows the visible change cards by name substring.
- [ ] **NEW** [group-section-header] Changes render under their OpenSpecGroupSection group-section-header/group-section-body sections.
- [ ] **NEW** [board-add-group] Clicking board-add-group reveals add-group-name and add-group-save to create a new group.
- [ ] **NEW** [board-new-proposal] Clicking board-new-proposal opens new-proposal-dialog with np-name, np-group, np-worktree and np-create.
- [ ] **NEW** [stepper-node] In OpenSpecStepper, a done artifact node renders its letter span (P/D/S) with green tint while a done non-artifact node renders the mdi-check.

## File Preview & Media

- [ ] **NEW** [ImageLightbox] Clicking a resolved `pi-asset:` markdown image opens ImageLightbox showing the resolved image.
- [ ] **NEW** [ImageLightbox] Clicking an external `https://` markdown image opens ImageLightbox with that URL.
- [ ] **NEW** [lightbox-backdrop] Pressing Escape closes the open ImageLightbox (lightbox-backdrop disappears).
- [ ] **NEW** [lightbox-backdrop] Clicking lightbox-backdrop outside the image closes the lightbox.
- [ ] **NEW** [ImageLightbox] An unresolved `pi-asset:` placeholder renders as a non-clickable span with no image.
- [ ] **NEW** [ImageLightbox] Rendered markdown images show a `cursor-pointer` affordance.
- [ ] **NEW** [ZoomControls] Clicking Zoom in / Zoom out / Reset zoom adjusts the image zoom level.
- [ ] **NEW** [MermaidBlock] A chat bubble containing a Mermaid diagram is widened to ~95% of the content area.
- [x] _COVERED_ [MermaidBlock] An author-colored node (inline `style` with `fill:`) renders unchanged at full saturation.
- [x] _COVERED_ [MermaidBlock] The same node id keeps the same hue across re-renders when an unrelated node is added.

## Interactive Renderers (ask_user)

- [ ] **NEW** [SelectRenderer] A select prompt renders each option as a full-width vertical row, and an option containing ` — ` shows its trailing text as a description sub-line.
- [ ] **NEW** [SelectRenderer] After answering, the select card shows the full option list dimmed with the chosen option highlighted and no `+N more` collapse.
- [ ] **NEW** [MultiselectRenderer] Checking options (via the select-all-row list) and clicking Submit resolves the card to an answered state with selected values highlighted.
- [ ] **NEW** [MultiselectRenderer] Clicking Submit with no options checked resolves as an empty selection, not a cancellation.
- [ ] **NEW** [MultiselectRenderer] Clicking Cancel resolves the multiselect card as cancelled.
- [ ] **NEW** [InputRenderer] An answered input card shows the entered value in a read-only field, and an empty submit shows `(left blank)`.
- [ ] **NEW** [ConfirmRenderer] A confirm card's buttons read `Yes` and `No`, not `Allow`/`Deny`.
- [ ] **NEW** [AskUserToolRenderer] An input ask_user card renders the title as a heading and the message as block-level markdown below it, with code blocks formatted.
- [x] _COVERED_ [SelectRenderer] A select widget mounts for a faux ask_user tool call.

## Status Bar & Banners

- [ ] **NEW** [ConnectionStatusBanner] While connecting/retrying, a role="alert" banner shows a connecting state.
- [ ] **NEW** [ConnectionStatusBanner] After repeated failures, the role="alert" banner shows an offline/disconnected state.
- [ ] **NEW** [ConnectionStatusBanner] Clicking the role="alert" connection banner triggers its reconnect handler.
- [ ] **NEW** [limit-exceeded-banner] On a usage-limit error, limit-exceeded-banner renders with limit-exceeded-hint text.
- [ ] **NEW** [error-banner-dismiss] Clicking error-banner-dismiss removes error-banner and stops the session.
- [ ] **NEW** [retry-banner] retry-banner shows retry-banner-attempt, retry-banner-reason, and either retry-banner-countdown or retry-banner-indeterminate.
- [ ] **NEW** [retry-banner-stop] Clicking retry-banner-stop aborts the retrying session.
- [ ] **NEW** [spawn-error-banner] A failed spawn shows spawn-error-banner; clicking spawn-error-dismiss removes it.
- [ ] **NEW** [spawn-timeout-banner] A spawn timeout shows spawn-timeout-banner; clicking spawn-timeout-dismiss removes it.
- [ ] **NEW** [Toast] After a failed action an error-variant Toast appears; clicking it invokes its dismiss handler.
- [ ] **NEW** [context-usage-bar] context-usage-bar renders context-usage-fill and context-usage-pct reflecting current usage.
- [ ] **NEW** [TokenStatsBar] After a turn ends, stats-panel shows non-zero token values in butterfly-chart.
- [ ] **NEW** [working-status] During an active turn, StatusBar shows working-status with an ElapsedBadge elapsed-time span.
- [x] _COVERED_ [error-banner] A terminal error shows one error-banner with Retry + Dismiss and no yellow retry-banner.
- [x] _COVERED_ [error-banner-retry] Clicking error-banner-retry keeps error-banner visible until a confirmed non-error response arrives.
- [x] _COVERED_ [ConnectionStatusBanner] When the WebSocket stays connected, no role="alert" disconnect banner renders within the hold window.
