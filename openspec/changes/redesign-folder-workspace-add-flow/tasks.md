## 1. Phase 1 — Remove the directory-home dead end

- [ ] 1.1 Write a failing test in `packages/client/src/components/folder/__tests__/` (or the existing DirectoryHomeView test file) asserting a cwd that is NEITHER in `pinnedDirectories` NOR in any `workspaces[].folders` renders the home page prompt surface and NOT `directory-home-not-pinned`
- [ ] 1.2 Delete the eligibility branch + "not available" notice from `packages/client/src/components/folder/DirectoryHomeView.tsx`; keep the loading state driven only by the component's own session data
- [ ] 1.3 Remove the now-unused `pinnedDirectoriesLoaded` / `workspacesLoaded` eligibility props from `DirectoryHomeView` and drop them at every call site (grep for the prop names)
- [ ] 1.4 Delete i18n keys `directoryHome.notPinnedTitle`, `directoryHome.notPinnedBody`, `directoryHome.pinCta` from `packages/client/src/lib/i18n-en-source.json` and any translated catalogs
- [ ] 1.5 Update/remove existing tests asserting the guard or the `directory-home-not-pinned` test id; run `npm test 2>&1 | tee /tmp/pi-test.log` and confirm green
- [ ] 1.6 Verify manually: open a folder that has sessions but is neither pinned nor in a workspace → its home page renders with the session list and spawn prompt

## 2. Phase 2 — Compact add-to-workspace affordance

- [ ] 2.1 Write failing tests in `SessionList.test.tsx`: the folder header renders a button whose accessible name matches the add-to-workspace verb, exposes `aria-haspopup`/`aria-expanded`, and NO element with literal text `+ws` exists
- [ ] 2.2 Replace the `+ws` text token in `renderGroupWithWorkspaceMenu` with an `mdiFolderPlus` + `mdiMenuDown` icon button rendered INSIDE the header icon cluster (order `sort · add-to · home · pin`); delete the `absolute top-1 right-7` wrapper
- [ ] 2.3 Add `aria-label` + `title` ("Add to workspace…"), `aria-haspopup="menu"`, and `aria-expanded` bound to popover state; ensure the ≥44px touch target at mobile breakpoints matches the sibling icon buttons
- [ ] 2.4 Remove the "Pin to dashboard" entry from `packages/client/src/components/workspace/AddToWorkspaceMenu.tsx` (keep workspaces, `+ New workspace…`, and remove-from-workspace); keep the existing "No workspaces yet" empty state
- [ ] 2.5 Add the same icon button to the session card header cluster, targeting the session's cwd, reusing the popover component
- [ ] 2.6 Apply the cluster layout contract in `renderGroup`: `flex:none` + `white-space:nowrap` on the cluster, `min-width:0` on the name region, parent path `flex:0 1 auto; min-width:0`, leaf name with a legible minimum + ellipsis
- [ ] 2.7 Add a test asserting all cluster buttons remain rendered and unwrapped at a narrow container width, and that the parent path truncates before the leaf segment
- [ ] 2.8 Run tests; then `npm run build && curl -X POST http://localhost:8000/api/restart` and visually verify the cluster at ~220px, ~260px, ~300px sidebar widths in dark AND light themes

## 3. Phase 3a — PathPicker multi-select + MDI iconography

- [ ] 3.1 Write failing tests in `PathPicker.test.tsx`: in multi-select mode, activating a row browses into it and does NOT call `onSelect`; in single-select mode activation still calls `onSelect`
- [ ] 3.2 Add an opt-in selection mode to `packages/client/src/components/primitives/PathPicker.tsx` (props for selected set + change handler); default behaviour for existing callers MUST stay single-select
- [ ] 3.3 Render a per-row checkbox in multi-select mode using `mdiCheckboxMarked` / `mdiCheckboxBlankOutline`, with its own accessible name and `stopPropagation` so ticking never navigates
- [ ] 3.4 Add the trailing `mdiChevronRight` descend affordance to directory rows
- [ ] 3.5 Replace emoji glyphs with `@mdi/js` paths: `⬆` → `mdiArrowUp` (parent row), `📁` → `mdiFolder` (directory rows), `＋` → `mdiFolderPlusOutline` (create-here row and the footer New folder button); keep `git`/`pi` as text badges
- [ ] 3.6 Add a test asserting no row renders the characters `⬆`, `📁`, or `＋` and that each renders an SVG path
- [ ] 3.7 Wire keyboard semantics: Space toggles selection on the highlighted row, Enter activates (descends); verify existing arrow-key navigation and the create-here flow still pass

## 4. Phase 3b — Add Folders dialog

- [ ] 4.1 Write failing tests in `PinDirectoryDialog.test.tsx` (renamed/extended for the Add Folders dialog): selections persist across navigation, pill removal deselects, empty basket disables the primary action, and the action label reflects the count
- [ ] 4.2 Convert `packages/client/src/components/workspace/PinDirectoryDialog.tsx` into the Add Folders dialog: multi-select `PathPicker` + basket of removable pills + count-bearing primary action; normalize each path with `normalizePath`/`inferPlatform` as today
- [ ] 4.3 Add the single-select workspace destination control (default `None`), listing existing workspaces plus `+ New workspace…`; render "None — no workspaces yet" plus the create affordance when zero workspaces exist
- [ ] 4.4 Assert the dialog renders NO pin control anywhere (test), since pinning is implicit
- [ ] 4.5 Implement commit: send `pin_directory` for every selected path FIRST, then `add_folder_to_workspace` for each when a workspace destination is chosen; close on success
- [ ] 4.6 Add session-count badges by joining browse entries against session cwds using `pathKey` from `session-grouping` (NOT raw string equality); add a test for a badged loose cwd and an unbadged plain directory
- [ ] 4.7 Wire `dashboard-add-buttons` entry points: the sidebar `+ Add Folder` opens the dialog with destination `None`; each workspace-scoped `+ Add Folder` opens it with that workspace preselected
- [ ] 4.8 Add i18n keys for the destination control, empty-workspace state, basket label, and the count-bearing action

## 5. Validation

- [ ] 5.1 Run the full suite: `npm test 2>&1 | tee /tmp/pi-test.log` then `grep -nE 'FAIL|Error|✗|✘' /tmp/pi-test.log` — zero failures
- [ ] 5.2 Measure commit broadcast churn with ~10 selected paths; if sidebar reorder flicker is visible, record it as a follow-up for the deferred batched message (design Decision 5)
- [ ] 5.3 Accessibility pass on the dialog: keyboard-only select/navigate/commit, visible focus rings, ≥24×24 targets, and correct roles/names on the checkbox and destination controls
- [ ] 5.4 Verify all three phases in dark AND light themes at 420px and 1440px; confirm no console errors
- [ ] 5.5 Confirm no duplicate rows: a folder that is both pinned and workspace-owned renders exactly once (inside its tier), and removing it from the workspace leaves it visible at root

## 6. Documentation

- [ ] 6.1 Delegate to DocScribe (caveman style): update the folder/workspace + directory-home sections of `docs/architecture.md` for the removed guard, implicit pin, and multi-select add flow
- [ ] 6.2 Update directory `AGENTS.md` rows for every touched file (`components/folder/`, `components/workspace/`, `components/primitives/`, `components/session/`) with purpose + `See change: redesign-folder-workspace-add-flow`
- [ ] 6.3 Run `kb dox lint` and confirm no `over-threshold` rows were introduced
