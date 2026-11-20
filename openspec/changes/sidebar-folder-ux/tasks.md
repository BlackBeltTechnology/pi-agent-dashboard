## 1. Remove from sidebar (#1118)

- [ ] 1.1 Failing tests in `client-utils` for default focus: `useFocusTrap` prefers the first focusable `[data-autofocus]` descendant, unmarked dialogs unchanged; `Dialog.Cancel autoFocus` renders `data-autofocus`; `Confirm defaultFocus="cancel"` focuses Cancel on open (✕ is first focusable otherwise).
- [ ] 1.2 Implement the additive default-focus hook in `packages/client-utils/src/{useFocusTrap.ts,Dialog.tsx,Confirm.tsx}`.
- [ ] 1.3 Failing tests in `SessionList.folder-menu.test.tsx`: item present for pinned / workspace / pinned-in-workspace folders, absent for unpinned folders outside every workspace (present for a workspace-owned but unpinned folder); ended-only folder sends the right message set immediately (no dialog); renders neutral (no `data-action-tone`).
- [ ] 1.4 Failing tests for live sessions: activating opens the confirm dialog listing each live session (`role="dialog"`, accessible title, focus on Cancel, Esc/Cancel sends nothing); confirm sends `shutdown` per live session via `onShutdown`, then removal messages, in that order; keyboard-only path (Enter on item → Tab → Enter on confirm); a live session hidden by "show hidden" is listed and shut down; a live worktree session (`gitWorktree.mainPath = /repo`, `cwd = /repo/.worktrees/x`, unpinned) rendered in the `/repo` card is listed and sent `shutdown`; a live session whose `cwd` differs from the folder only by trailing separator / case drift is listed and sent `shutdown`; the shutdown set is read from the unfiltered sessions at confirm time (a session that goes live while the dialog is open is included); on close focus returns to `folder-actions-menu-<cwd>` when mounted; the dialog stays open if the folder leaves the list (state hosted in `SessionList`).
- [ ] 1.5 Implement `remove-from-sidebar` in `folderMenuItems` (`SessionList.tsx` ~L1922); alive = `status !== "ended"` over the unfiltered `sessions` **in that folder's group** (same key as the card: `pathKey(resolveSessionGroupPath(s, pinnedKeys, plat), plat) === pathKey(group.cwd, plat)`; reuse/export the key derivation from `session-grouping.ts`, no raw `cwd` compare), recomputed at confirm time; dialog state in `SessionList` keyed by cwd (like `manageWorktreesCwd`, not inside the menu) with an explicit `onClose` that focuses the folder's menu trigger; new `components/folder/RemoveFromSidebarConfirm.tsx` over `Confirm` (`intent="danger"`, `defaultFocus="cancel"`, live-session list capped + scrollable); reuse `onShutdown` (→ `handleShutdownSession`), `onRemoveFolderFromWorkspace`, `onUnpinDirectory`; add i18n keys (en + existing locales fallback).
- [ ] 1.6 Test: ended-only folder disappears after both messages are reflected in props (no archive needed); after shutdown the live-session folder leaves by the #1086 rule; Folder filter re-reveals it.

## 2. Hide compact chips in Focus mode (#1134)

- [ ] 2.1 Failing tests in `components/folder/__tests__` for `FolderActionBanner` and `SessionList`: Focus on ⇒ compact chip renders nothing for every rung (`init-needed`, `setup`, `retrust`, `failed`, `running`) in both accordion-compact and `folder-banner`-hidden paths; Focus off ⇒ chip renders for all rungs including `init-needed` (unchanged); expanded `compact={false}` banner unchanged; Focus on with a profile that shows `folder-banner` ⇒ the full banner renders for a failed/running/re-trust folder; retitle `SessionList.card-blocks.test.tsx:178` to "outside Focus".
- [ ] 2.2 Implement: `SessionList` reads `useFocusState().enabled` (`CardSectionsContext.tsx:152`) and passes a suppress prop to both compact `FolderActionBanner` call sites (`SessionList.tsx` ~L2399 and ~L2440); `FolderActionBanner` returns null for the compact chip when set.

## 3. Slimmer compact cards (#1134) — mockup first

- [ ] 3.1 Measure current heights (classic collapsed vs accordion compact-empty) in an isolated dashboard (debug-dashboard `references/isolated-verification.md`, non-8000 port); record numbers in the mockup README.
- [ ] 3.2 Live-component mock under `openspec/changes/sidebar-folder-ux/mockups/` (`frontend-mockup-loop-dashboard`); confirm D4 layout with the owner via `mock-decide`; score at 3 breakpoints, base dark/light + one palette.
- [ ] 3.3 Failing tests: compact modes render no `folder-group-by-row-<cwd>`; a classic collapsed folder with the same group-by setting still renders it; compact-empty renders no `folder-compact-row-<cwd>` and the header shows the count as a sibling `<button>` of the name link with accessible name `N sessions` (link name unchanged, not `--text-muted`); activating the count focuses the folder without changing the route, even with a session in another folder selected; keyboard Enter on `folder-header-name-<cwd>` still focuses and navigates.
- [ ] 3.4 Implement in `SessionList.tsx` (group-by row condition ~L2386; compact body ~L2490-2519; count button next to the name link, `stopPropagation`, `activateFolder` only).

## 4. Directory menu scroll (#1153)

- [ ] 4.0 Ask the reporter on #1153 which menu and viewport fails (D5).
- [ ] 4.1 Reproduce at 1280×720 with 14 pinned folders in an isolated dashboard: folder actions menu, add-to-workspace menu, workspace header menu, Add-folders dialog, sidebar list. Record which surface fails (design D5); this selects any extra surface for 4.2.
- [ ] 4.2 Playwright spec (`tests/e2e/`) at 1280×720, independent of reproduction: with 14 pinned folders the folder actions menu's last item is reachable by wheel and keyboard (panel bottom ≤ viewport bottom). If 4.1 finds a different failing surface, add the same assertion for it first and confirm it fails before 4.3.
- [ ] 4.3 Fix the failing surface (use `usePopoverFlip` `maxHeight` + `overflow-y-auto`; do not add a second positioning mechanism). If nothing reproduces, close as not-reproducible with the spec test kept as a regression guard.

## 5. Verify and land

- [ ] 5.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then grep the summary per AGENTS.md.
- [ ] 5.2 Client change: `npm run build && npx tsx .pi/skills/implement/scripts/restart-server.ts`; `curl -s http://localhost:8000/api/health | jq .mode`.
- [ ] 5.3 Update per-directory `AGENTS.md` rows (`components/session/`, `components/folder/`, `packages/client-utils/`); docs via DocScribe if `docs/` prose is touched.
- [ ] 5.4 `npx openspec validate sidebar-folder-ux --strict` and `node scripts/check-conventions.mjs`.
