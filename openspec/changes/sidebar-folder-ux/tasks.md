## 1. Remove from sidebar (#1118)

- [ ] 1.1 Failing tests in `client-utils` for default focus: `useFocusTrap` prefers the first focusable `[data-autofocus]` descendant, unmarked dialogs unchanged; `Dialog.Cancel autoFocus` renders `data-autofocus`; `Confirm defaultFocus="cancel"` focuses Cancel on open (✕ is first focusable otherwise).
- [ ] 1.2 Implement the additive default-focus hook in `packages/client-utils/src/{useFocusTrap.ts,Dialog.tsx,Confirm.tsx}`.
- [ ] 1.3 Failing tests in `SessionList.folder-menu.test.tsx`: item present for pinned / workspace / pinned-in-workspace folders, absent for unpinned; ended-only folder sends the right message set immediately (no dialog); neutral tone.
- [ ] 1.4 Failing tests for live sessions: activating opens the confirm dialog listing each live session (`role="dialog"`, accessible title, focus on Cancel, Esc/Cancel sends nothing); confirm sends `shutdown` per live session via `onShutdown`, then removal messages, in that order; keyboard-only path (Enter on item → Tab → Enter on confirm).
- [ ] 1.5 Implement `remove-from-sidebar` in `folderMenuItems` (`SessionList.tsx` ~L1922); alive = `status !== "ended"`; new `components/folder/RemoveFromSidebarConfirm.tsx` over `Confirm` (`intent="danger"`, `defaultFocus="cancel"`, live-session list capped + scrollable); reuse `onShutdown` (→ `handleShutdownSession`), `onRemoveFolderFromWorkspace`, `onUnpinDirectory`; add i18n keys (en + existing locales fallback).
- [ ] 1.6 Test: ended-only folder disappears after both messages are reflected in props (no archive needed); after shutdown the live-session folder leaves by the #1086 rule; Folder filter re-reveals it.

## 2. Hide compact chips in Focus mode (#1134)

- [ ] 2.1 Failing tests in `components/folder/__tests__` for `FolderActionBanner` and `SessionList`: Focus on ⇒ compact chip renders nothing for every rung (`init-needed`, `setup`, `retrust`, `failed`, `running`) in both accordion-compact and `folder-banner`-hidden paths; Focus off ⇒ chip renders for all rungs including `init-needed` (unchanged); expanded `compact={false}` banner unchanged.
- [ ] 2.2 Implement: `SessionList` reads `useFocusState().enabled` (`CardSectionsContext.tsx:152`) and passes a suppress prop to both compact `FolderActionBanner` call sites (`SessionList.tsx` ~L2399 and ~L2440); `FolderActionBanner` returns null for the compact chip when set.

## 3. Slimmer compact cards (#1134) — mockup first

- [ ] 3.1 Measure current heights (classic collapsed vs accordion compact-empty) in an isolated dashboard (debug-dashboard `references/isolated-verification.md`, non-8000 port); record numbers in the mockup README.
- [ ] 3.2 Live-component mock under `openspec/changes/sidebar-folder-ux/mockups/` (`frontend-mockup-loop-dashboard`); confirm D4 layout with the owner via `mock-decide`; score at 3 breakpoints, base dark/light + one palette.
- [ ] 3.3 Failing tests: compact modes render no `folder-group-by-row-<cwd>`; compact-empty renders no `folder-compact-row-<cwd>` and the header shows the count with accessible name `N sessions`; header activation still focuses the folder; keyboard Enter on `folder-header-name-<cwd>` works.
- [ ] 3.4 Implement in `SessionList.tsx` (group-by row condition ~L2386; compact body ~L2490-2519; header name region).

## 4. Directory menu scroll (#1153)

- [ ] 4.0 Ask the reporter on #1153 which menu and viewport fails (D5).
- [ ] 4.1 Reproduce at 1280×720 with 14 pinned folders in an isolated dashboard: folder actions menu, add-to-workspace menu, workspace header menu, Add-folders dialog, sidebar list. Record which surface fails (design D5).
- [ ] 4.2 Failing Playwright spec (`tests/e2e/`) for the failing surface at 1280×720: last item reachable by wheel and keyboard.
- [ ] 4.3 Fix the failing surface (use `usePopoverFlip` `maxHeight` + `overflow-y-auto`; do not add a second positioning mechanism). If nothing reproduces, close as not-reproducible with the spec test kept as a regression guard.

## 5. Verify and land

- [ ] 5.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then grep the summary per AGENTS.md.
- [ ] 5.2 Client change: `npm run build && npx tsx .pi/skills/implement/scripts/restart-server.ts`; `curl -s http://localhost:8000/api/health | jq .mode`.
- [ ] 5.3 Update per-directory `AGENTS.md` rows (`components/session/`, `components/folder/`, `packages/client-utils/`); docs via DocScribe if `docs/` prose is touched.
- [ ] 5.4 `npx openspec validate sidebar-folder-ux --strict` and `node scripts/check-conventions.mjs`.
