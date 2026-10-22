# Proposal

## Why

The composer dock (Changes, OpenSpec, Context/quota and the other lanes above the composer) is always fully expanded, so it permanently takes 150–300 px of chat height. With the Changes lane open it can cover most of a short pane. The user cannot put it away and bring it back quickly.

The Changes lane's file rows offer only **Diff**, and that link ignores the row. `App.tsx` wires `onOpenFile={() => navigate(buildSessionDiffUrl(selectedId))}`, so every row opens the whole-session diff page. There is no way to open the changed file itself in the editor pane, even though the editor pane already has `openInSplit(path)` and per-file `diff:` tabs (`openDiffTab(path)`).

The design was explored on a mockup and approved on 2026-10-22: 300 ms hover dwell (the session-actions menu constants), explicit Hide and Pin controls, and collapse state per session. During planning review, Open for files outside the session folder was split off into a follow-up change (user decision): it needs editor-pane read/watch rule changes, a preference gate and a write-path review.

## What Changes

- **Collapsible dock.** A **Hide** control on the dock's top edge collapses the lanes into a one-line **summary bar**. The bar shows each lane's existing plain-text summary (for example `3 files changed +1 −0 · <OpenSpec summary> · plugin context`). Quota figures in the bar are out of scope, because the Context lane has no summary contract for them. The bar has no actions, and a lane that renders nothing adds nothing to it. Live signals stay visible: a running process keeps its working indicator, and a queue shows its count. Header details (base, drift, actions) return whenever the lanes are shown, including during a peek.
- **Hover peek.** On devices with a fine pointer and hover, resting on the collapsed bar opens the dock as an **overlay that grows upward** over the transcript. The composer card does not move and the chat does not reflow. It opens after the pointer has stayed 300 ms below 0.4 px/ms speed, and closes 300 ms after the pointer leaves bar ∪ dock. These are the `session-hover-intent.ts` constants. The peek stays open while a menu opened from inside the dock is up, or while keyboard focus is inside it. Escape closes an open dock menu first, and then the peek when focus is on the bar or inside the overlay. Escape in the composer keeps its meaning. A modal dialog opening, or activating a row target, ends the peek. Only the live dock of the session the editor pane serves can peek, hide or pin.
- **Pin.** A peek shows a **Pin** button. Pin, or a click / Enter / Space on the bar, turns the dock back to expanded (in-flow, like today). On touch (no hover), tapping the bar expands it.
- **Default and persistence.** The dock starts expanded and never collapses on its own. The collapsed/expanded choice is stored **per session** in `localStorage` (`pi-dashboard:composer-dock-collapsed:<sessionId>`), the same pattern as `tree-visible`.
- **YOLO footer unchanged.** It is not collapsible: it stays as the dock's last line under the collapsed bar and is never inside the peek overlay.
- **Changes rows get Open and Diff.**
  - **Open**, and a click on the file name, opens the file itself in the editor pane via `openInSplit(path)`. The usual viewer and plugin file-handler rules apply.
  - **Diff** opens that file's `diff:<path>` tab via `openDiffTab(path)` instead of the whole-session diff page. The lane-level **Review** still opens the session diff page.
  - A file missing on disk keeps both targets. Open shows a new `File no longer exists: <path>` state in the editor pane, for every viewer kind. Diff renders from the session diff.
  - Files outside the session folder keep today's behaviour (no targets). Out-of-folder Open is a follow-up change.
  - Targets appear only when the dock is live for the session the editor pane serves.
- Mockup: mockups/composer-dock-collapse (in this change). Its out-of-folder Open rows, the quota text in the bar, and the 34 px bar are superseded by this proposal: out-of-folder Open is deferred, the bar shows `summaryText`, and it is 44 px tall.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `composer-dock`: new requirements for dock collapse, the summary bar, hover peek, pin and per-session persistence. MODIFIED:
  - "Changes lane shows worktree identity and the session's changed files": separate Open and Diff targets for in-cwd rows, and a file-missing state.
  - "Dock is a shrinkable row of the chat pane": the collapsed entry, and a peek that sits outside the budget.
  - "Compact dock below 520 px": a collapsed compact dock shows the bar instead of the chips.
  - "Changes lane identity segment for worktree sessions": applies whenever the lane is shown; the bar keeps only the branch.
- `dashboard-shell-slots`: MODIFIED "Process group rows use the dock row primitive". `ComposerDockRow` gains an optional activatable title (`onTitleActivate`, `titleLabel`).

## Discipline Skills

- `review-code`: non-trivial client change across `ComposerDock`, `ChangesLane`, `ComposerDockHost` and a new hover-intent hook, run before commit.
- No `security-hardening` trigger: Open reads only in-cwd files through the existing editor-pane path. The file-missing probe reuses the existing no-prompt `/api/file` metadata read. Out-of-folder Open, which would touch the grant layer, is deferred.
- No `performance-optimization` trigger: the hover listener follows the session menu's one-listener, refs-only pattern, with no React state per pointer move.
- `doubt-driven-review`: `ComposerDockRow` gains optional props, which is an additive public plugin-runtime API. The review runs during planning (plan-proposal).
- No `observability-instrumentation` trigger: no new endpoint or job.

## Impact

- **Client:**
  - `packages/client/src/components/chat/ComposerDock.tsx`: collapsed bar, Hide/Pin, peek overlay, row-table entry for the collapsed state.
  - `ChangesLane.tsx`: Open + Diff per row.
  - `packages/dashboard-plugin-runtime/src/ComposerDockRow.tsx`: an optional, additive `onTitleActivate` / `titleLabel` (an activatable file name). This is a public plugin-runtime surface; existing callers are unchanged.
  - `EditorPane.tsx` / `CappedViewer.tsx`: a file-missing state for every viewer kind, from the metadata probe.
  - `ComposerDockHost.tsx` / `useComposerDockLanes.ts`: wire `openInSplit` / `openDiffTab` through `useOptionalSplitWorkspace()`.
  - `App.tsx`: drop the path-ignoring `onOpenFile`, and pass `live={!frozen}` to the dock host.
  - A new per-session store `lib/util/dock-collapsed.ts`.
  - A dock hover-intent hook that reuses the exported `session-hover-intent.ts` constants.
  - `lib/layout/chat-pane-row-class.ts`: `COLLAPSED_BAR_PX` and the `composer-dock:collapsed` / `-yolo` entries.
  - `index.css`: unchanged; the `composer-dock + composer-root` join keeps matching because no wrapper is added.
  - New i18n keys for Hide, Pin, Open, the bar label and the file-missing message, in `i18n-en-source.json`, `i18n-hu.ts` and `i18n-zh-CN.ts`. The existing `dock.changes.openDiff` is reused.
- **Server / shared:** none.
- **Compatibility:** existing users see no change until they press Hide. Review keeps its route. Old `localStorage` is unaffected.
- **Rollback:** revert the client commit. The stored keys are ignored harmlessly.
