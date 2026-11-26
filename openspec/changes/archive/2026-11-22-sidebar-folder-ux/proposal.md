## Why

Three sidebar folder-card defects, grouped because they all live in the folder card / folder actions menu (`SessionList.tsx`, `FolderActionsMenu.tsx`, `FolderActionBanner.tsx`).

- **[#1118](https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/1118) — no one-step "remove folder from sidebar".** Verified: `folderMenuItems` (`packages/client/src/components/session/SessionList.tsx:1922-1943`) offers *Remove from workspace* only when `inWorkspace` and *Pin/Unpin* only when `!inWorkspace`, so a folder that is both pinned and in a workspace has no Unpin until it is removed from the workspace, and nothing does both. Drag-eject (`moveFolderToWorkspaceNow`, `packages/server/src/browser-handlers/directory-handler.ts:446-448`) pins on purpose. The "stuck until every session is archived" step of the issue is **already fixed** by #1086 (archived `2026-11-04-fix-sidebar-folder-visibility`; rule at `SessionList.tsx:1474`).
- **[#1134](https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/1134) — Focus mode shows "Init needed" and closed cards are not slim.** Verified: in accordion compact modes (`isCompact` defined `SessionList.tsx:2074`; chip call site `SessionList.tsx:2398`) and whenever `folder-banner` is hidden (`compact={!showFolderBanner}`, `SessionList.tsx:2451`) `FolderActionBanner` renders the compact chip for **every** rung, including the informational `init-needed` rung (compact chip branch `FolderActionBanner.tsx:143-157`, `CHIP_LABEL` L115-121). The built-in focus profile hides `folder-banner`, so Focus always surfaces the chip. Slimness: a compact folder renders the same condensed header as a collapsed one **plus** the Group-by row (`SessionList.tsx:2389`, condition `isCollapsed || isStub`) **plus** the `N sessions — click to view` row (`SessionList.tsx:2493-2519`) — taller than a classic collapsed card. Exact rendered heights not browser-measured (see tasks 3.1).
- **[#1153](https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/1153) — directory menu not scrollable on a 13" display.** **PARTIAL / not reproduced in code.** Every directory-listing popover is already viewport-bounded via `usePopoverFlip` + `overflow-y-auto` (`FolderActionsMenu.tsx:147-163,252-253`, `AddToWorkspaceMenu.tsx:41-88`, `WorkspaceHeader.tsx:58-200`), `Dialog` caps at `max-h-[80vh]` (`client-utils/src/Dialog.tsx:61-64`) and short viewports (<600px) switch to the sheet. The issue does not name the menu. This change adds a reproduction-first task and a regression-guard requirement; a fix is only drafted once a surface is reproduced (see DECISIONS).

## What Changes

- **#1118:** new folder-menu item **Remove from sidebar** (`id: remove-from-sidebar`, `directory` group, no tone — renders neutral). Client composes the existing `remove_folder_from_workspace` and `unpin_directory` messages (no protocol change). Shown for folders that are pinned or in a workspace. When any session in the folder is alive (status ≠ `ended`) it opens an accessible **confirm dialog listing the live sessions** (default focus on Cancel); on confirm the client ends each (every session in the folder's group — same grouping key as the card, so unpinned worktree sessions inside the parent repo's card are included — taken from the unfiltered session list at confirm time, hidden ones included) via the existing `shutdown` browser message (`handleShutdownSession`, server `shutdownSession`), then sends the removal messages. After the action an ended-only folder leaves the sidebar by the existing #1086 rule; sessions stay in history/archive/Folder search; a new session brings the folder back.
- **#1134:** while **Focus mode is on**, the compact folder-banner chip is hidden for **all** rungs (init-needed, setup, re-trust, failed, running); outside Focus the chip is unchanged. Compact accordion folders drop the Group-by row and fold the session count into the header, removing the `N sessions — click to view` row; the count becomes a sibling button that only focuses the folder (the header row click also navigates to the folder home, so it cannot stand in).
- **#1153:** reproduce at 1280×720 across directory-listing surfaces; add a requirement that the folder actions menu content is fully reachable at any desktop height; fix whichever surface fails.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `folder-actions-menu`: ADDED "Menu offers one-step removal from the sidebar"; ADDED "Menu content stays reachable at short desktop heights"; MODIFIED "Folder menu items carry an optional semantic tone" (Remove from sidebar is neutral; the confirm dialog carries severity).
- `session-card-section-visibility`: "Folder banner safety chip" — suppressed for all rungs only while Focus mode is on.
- `focus-mode`: MODIFIED "Built-in default focus profile" — the "Safety cues survive" scenario no longer covers the folder chip (PROCESS chip still survives).
- `worktree-init-feedback`: MODIFIED "Init progress and failure render in the tier-0 banner" — Focus-mode exception (no card-level init feedback while Focus hides the banner and chip).
- `session-list-group-by`: MODIFIED "Folder header shows the active grouping" — accordion compact folders render no Group-by row.
- `dialog-primitive`: MODIFIED "Focus Containment" (initial focus honours `data-autofocus`, additive).
- `dialog-system`: MODIFIED "Dialog focus management" (same `data-autofocus` exception).
- `confirm-dialog`: ADDED "Confirm can default focus to Cancel".
- `folder-focus`: "Render-mode resolution" — compact modes omit the Group-by row.
- `session-filtering`: "Compact-empty affordance" — count lives in the condensed header as a sibling button (focus only, no navigation); no separate row.

## Non-goals

- Changing drag-eject auto-pin (`sidebar-drag-reorder`); "Remove from sidebar" is the obvious path instead (design D1/D2).
- A per-cwd "dismissed" preference or any new persistence (D1).
- Bulk "archive all ended sessions" (issue lists it as optional).
- Redesigning the expanded card, or changing the `setup` / `retrust` / `failed` rungs outside Focus mode.
- Any change to the Focus built-in profile contents.

## Relationship

- Archived `2026-11-04-fix-sidebar-folder-visibility` (#1086/#1085) already delivers the visibility rule this change relies on.
- Archived `2026-10-08-add-focus-mode-and-card-block-toggles` (accordion + safety chip) and `2026-08-09-add-folder-actions-menu` are the specs modified here.
- No overlapping active change found (`ls openspec/changes` — none touches folder menu / folder banner / focus compaction).

## Discipline Skills

- `review-code` — non-trivial client change across `SessionList.tsx`, `FolderActionBanner.tsx`, `FolderActionsMenu.tsx`.
- `systematic-debugging` — #1153 starts from an unreproduced report.
- `doubt-driven-review` — D2 now ends running sessions as part of a one-click-plus-confirm action; review the confirm copy, ordering and the Focus-mode chip trade-off (D3) before landing.
- No security, performance or observability checkpoints apply (client-only; reuses existing messages incl. `shutdown`; no new endpoint). Ending sessions is user-confirmed and covered by `doubt-driven-review` above.

## Impact

- Client: `packages/client/src/components/session/SessionList.tsx` (menu item ~L1922, compact header/rows ~L2386-2519), `components/folder/FolderActionBanner.tsx` (chip gating by Focus state), new `components/folder/RemoveFromSidebarConfirm.tsx` (live-session confirm, built on `Confirm`, state hosted in `SessionList`), `packages/client-utils/src/{Dialog,Confirm,useFocusTrap}.tsx` (additive default-focus hook), `components/folder/FolderActionsMenu.tsx` (only if #1153 reproduces there), i18n keys (`sessionList.removeFromSidebar`, `sessionList.removeFromSidebarConfirm*`).
- Tests: `SessionList.folder-menu.test.tsx`, `components/folder/__tests__` banner tests, new Playwright spec at 1280×720 for #1153.
- Mockup: `openspec/changes/sidebar-folder-ux/mockups/` (compact folder card) — required before implementing section 3.
- Backend/protocol: none (reuses `shutdown`, `remove_folder_from_workspace`, `unpin_directory`) → no migration; rollback = revert the client commit (ended sessions remain resumable).
- Build: client change → `npm run build` + restart-server per AGENTS.md.
