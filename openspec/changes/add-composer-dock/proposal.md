# Proposal

## Why

The bottom of the chat pane is five stacked layers, each with its own look: the context strip (OpenSpec · Git · plugin groups · Status), the `StatusBar` working line, the `QueuePanel`, the YOLO strip, and the composer card. Meanwhile the session's most actionable live state sits elsewhere. Background processes are on the sidebar session card. Changed files are on the `/diff` route. Running subagents are only cards in the transcript. Once the transcript scrolls, the user loses sight of what is running and what changed.

## What Changes

- **Composer dock.** One inset surface, docked onto the top of the composer card, replaces the stacked layers.
  - It holds lanes. A lane renders only when it has content, every lane is collapsed whenever a session is bound, and at most one is open at a time.
  - Each lane header is one disclosure target, with its actions beside it.
  - Below a 520 px container width, every lane folds into one row of summary chips, and a chip opens its lane.
  - The dock scrolls its lanes and shrinks before the transcript does.
  - A read-only archived session view has no composer, so it has no dock.
- **Processes lane.** Grouped into subagents, running commands and background processes.
  - Subagent rows come from the subagents plugin through a new `composer-dock-process-group` slot. They offer **Open**; a subagent that has not started yet shows `pending`.
  - Running bash commands offer **Show**, which scrolls to the tool card.
  - Bridge-scanned background processes offer **Kill**, which terminates the process group through the existing `kill_process` path.
  - The turn is still stopped only by the composer Stop.
- **Changes lane.**
  - Its header is the Git group's worktree identity and worktree actions, plus `N files +A −D` and **Review**. It renders for every worktree session, even one with no changes.
  - Expanding it lists the session's changed files from the existing session-diff endpoint, each opening its diff. The list is refetched, coalesced, when the agent stops working.
  - Changes the session cannot claim are summarized on one line.
- **OpenSpec lane.**
  - Replaces the strip's OpenSpec group, keeping its readiness gating, attach flow, traceable archived/missing attachments, single primary action and working-state rules.
  - The attached change name is the lane title, with a task count.
  - Open proposal, Refresh and Detach move into `⋯`.
  - Expanding it shows the next open tasks.
- **Queue lane.** Hosts the existing follow-up cycler unchanged, with Clear all in the lane header.
- **Context lane.**
  - Hosts `composer-context-group` contributions, which are never disabled while the agent works.
  - Hosts the Status group, which keeps its working gate.
- **YOLO footer.**
  - The YOLO strip becomes the dock's last line, outside the scrolling lanes. It is never collapsed, never a chip, and never scrolled away.
  - Every access-grant-yolo rule still holds.
  - The folder home composer renders the same dock.
- **Removed rows:** `composer-context-strip`, the standalone `StatusBar` (the working status becomes a status word in the toolbar), and the standalone `QueuePanel` and YOLO rows.
- **Composer card, one toolbar row:**
  - `＋` absorbs the Terminal control and is the toolbar's only fold host; the `⋯` overflow goes away.
  - `Steer ▾` becomes a dropdown; below 420 px it folds into `＋`.
  - Other toolbar controls (plugin `composer-toolbar-action`, access mode).
  - The status word.
  - One merged `model · thinking` chip.
  - A round send/stop button in the bottom-right, with `after turn`. Its fill moves from raw palette classes to tokens.
  - The focus-revealed footer hint line stays.
  - **BREAKING (spec):** the action button moves into the toolbar row, reversing a rule from `redesign-composer-session-strip`.
- **View menu.** `ChatViewMenu` moves to the session header next to the layout switch. `reorganize-session-header` carries a byte-identical delta; whichever change lands first does the move.
- Mockup: mockups/composer-dock (in this change)

## Non-goals

- Per-subagent or per-command stop: the protocol has neither. The composer Stop aborts the turn.
- An Undo action on changed files: that waits for `add-workspace-checkpointing`.
- A context gauge in the composer: `reorganize-session-header` puts the one context ring in the session header (its D8-R2).
- Server or bridge protocol changes.
- Retiring the session card's PROCESS section: it stays, and stays hideable.

## Capabilities

### New Capabilities
- `composer-dock`: the dock surface and its lanes (Processes, Changes, OpenSpec, Queue, Context), the YOLO footer, the accordion and compact modes, the live-region rule, and the pane height classification. The strip's OpenSpec-group, Git-group, single-primary and working-state rules move here.

### Modified Capabilities
- `chat-view`: the unified-composer requirement is removed and replaced by two smaller ones: the card's one toolbar row (Terminal in `＋`, footer hint line kept), and the working status word with the merged model chip. It also changes the morphing action button's placement, the delivery control's dropdown form, and mobile adaptation (new fold thresholds, `＋` as the only fold host).
- `dashboard-shell-slots`: `composer-context-group` renders in the dock's Context lane. The new `composer-dock-process-group` slot and the `ComposerDockRow` primitive are added, and the slot taxonomy table is brought up to date.
- `mid-turn-prompt-queue`: the stale v1 queue-panel requirement is removed. The dock's Queue lane hosts the current follow-up cycler.
- `chat-display-preferences`: the View menu mounts in the session header, and its popover opens downward from there.
- `model-selector`: model and thinking level share one composer chip, and the thinking-level propagation requirement names the chip instead of `StatusBar`. The stale "status bar always visible" requirement is removed.
- `popover-viewport-positioning`: the enumerated consumer table gains the composer's delivery menu. The model-selector row now also covers the merged chip.
- `plugin-ui-primitive-registry`: the stale `StatusBar` direct-import requirement is removed. The composer keeps the direct-import rule.
- `markdown-preview-view`: a replacing canvas hides the composer dock instead of the removed `StatusBar`.
- `split-editor-workspace`: the chat-pane height budget's row list names the composer dock instead of the context strip, status bar and queue panel.

## Discipline Skills

- `doubt-driven-review`: the new `composer-dock-process-group` slot is a public plugin API. Its contract (`reportSummary`, `sessionRefs`) was reviewed in planning; recheck it against the implemented types before the first claim lands.
- `performance-optimization`: two hot paths. Changed files are refetched from the git-backed diff endpoint when the agent stops working, and elapsed times tick once a second. Measure both, and keep the tick inside leaf rows.
- `review-code`: a non-trivial client change across about ten components, run before commit.

## Impact

- **Client:**
  - `App.tsx` (pane stack)
  - `CommandInput.tsx` (toolbar)
  - new `ComposerDock` and its lanes
  - `ComposerSessionActions.tsx` (split into the OpenSpec and Changes lanes)
  - `QueuePanel.tsx` (embedded in the Queue lane)
  - `StatusBar.tsx` (deleted)
  - `YoloIndicators.tsx` (strip reused as the footer)
  - `SessionHeader.tsx` (View menu)
  - `DirectoryHomeView.tsx`
  - `lib/layout/chat-pane-row-class.ts` (a `composer-dock` shrinkable row replaces three fixed rows)
  - i18n keys
- **Shared / runtime:** `slot-types.ts` and `slot-props.ts` (new slot), `dashboard-plugin-runtime` (`manifest-validator.ts`, the `ComposerDockRow` primitive).
- **Plugins:** `subagents-plugin` claims the new slot. The `composer-context-group` API is unchanged.
- **Compatibility and rollback:**
  - No server, bridge protocol or persisted-data change.
  - Not client-only: client, shared slot declarations, runtime and subagents plugin ship together and roll back together as one commit range. The manifest validator rejects an unknown slot id, so if a partial revert is ever needed, remove the plugin claim before the slot.
  - **BREAKING (tests):** test ids of surviving elements are kept. `composer-context-strip`, `status-bar`, `composer-session-actions` and the composer `overflow-button`/`overflow-menu` are removed (design D7).
- **Coordinates with:**
  - `reorganize-session-header`: context ring in the header, the View menu delta, its Changed files chip (which stays alongside the Changes lane), and its `play-stop-controls` delta, which names the session-actions strip. This is a tracked gate task.
  - `add-voice-assistant-dashboard-plugin`: the `composer-toolbar-action` slot moves to the toolbar row, directly before send/stop, and still never folds. This is a tracked gate task.
  - `add-supervised-tool-approval`: its access chip goes in the toolbar's leading cluster and folds into `＋`, not `⋯`. This is a tracked gate task.
  - `decouple-plugins-from-core` Phase 3: subagent rows stay plugin-owned.
  - `add-project-workflows`: its OpenSpec actions render in the OpenSpec lane.
