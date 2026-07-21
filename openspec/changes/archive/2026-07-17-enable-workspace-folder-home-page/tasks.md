# Tasks

## 1. Page guard (DirectoryHomeView)

- [x] 1.1 Add `workspaceFolders: Set<string>` and `workspacesLoaded: boolean` props to `DirectoryHomeViewProps`.
- [x] 1.2 Broaden the eligibility guard to `pinnedDirectories.includes(cwd) || workspaceFolders.has(cwd)`.
- [x] 1.3 Gate the cold-load state on `pinnedDirectoriesLoaded && workspacesLoaded` (both messages), not the pinned flag alone.
- [x] 1.4 Reword the guard-miss notice to be neutral (not pinned-specific), keeping the pin CTA and `data-testid`.
- [x] 1.5 Test (test-plan E1, L1): input = workspace-only cwd, both loaded true · trigger = mount · observable = prompt surface renders, no notice. Extend `DirectoryHomeView.test.tsx`.
- [x] 1.6 Test (test-plan E3, L1): input = cwd neither pinned nor workspace, both loaded true · trigger = mount · observable = guard-miss notice + pin CTA, no prompt.
- [x] 1.7 Test (test-plan E2, L1 — regression): input = pinned non-workspace cwd, both loaded true · trigger = mount · observable = prompt surface (existing pinned behavior unchanged).
- [x] 1.8 Test (test-plan E4, L1): input = cwd both pinned AND workspace member · trigger = mount · observable = prompt surface (either-set membership suffices).
- [x] 1.9 Test (test-plan F1+F2, L1): input = workspace-only cwd, `pinnedDirectoriesLoaded=true`, `workspacesLoaded=false` · trigger = render in between-messages window, then flip `workspacesLoaded=true` · observable = loading state, notice NEVER renders, converges to prompt. Extend `DirectoryHomeView.test.tsx`.

## 2. Wire workspace data from App

- [x] 2.1 In `App.tsx`, add `workspacesLoaded` state, flipped `true` on the first `workspaces_updated` (treat a never-sent message from a legacy stub as loaded-empty so the guard cannot hang).
- [x] 2.2 Derive `useMemo(() => new Set(workspaces.flatMap(w => w.folders)), [workspaces])` and pass it plus both loaded flags to `DirectoryHomeView`.
- [x] 2.3 Verify: `tsc --noEmit` clean.

## 3. Sidebar open affordance (SessionList)

- [x] 3.1 In `renderGroup`, change the open-affordance condition from `isPinned && !inWorkspace` to `isPinned || inWorkspace` (an unpinned workspace folder has `folder.pinned === false`, so `isPinned` alone would keep it hidden).
- [x] 3.2 Confirm `stopPropagation` still guards the click from toggling collapse / starting a drag (unchanged behavior).
- [x] 3.3 Test (test-plan F3, L1): input = unpinned workspace-folder row (`DirectoryGroup.pinned=false`, `inWorkspace=true`) · trigger = row renders · observable = `folder-open-home-<cwd>` affordance present. Extend `SessionList.test.tsx`.
- [x] 3.4 Test (test-plan F4, L1): input = expanded unpinned workspace-folder row · trigger = activate the open affordance · observable = `navigate(buildFolderHomeUrl(cwd))` called, collapse state unchanged.
- [x] 3.5 Test (test-plan F5, L1 — regression): input = pinned non-workspace row · trigger = activate affordance · observable = still present and navigates (existing behavior unchanged).

## 4. Validate

- [x] 4.1 `openspec validate enable-workspace-folder-home-page --strict` passes.
- [x] 4.2 `npm test` green for `DirectoryHomeView` and `SessionList` suites.
- [x] 4.3 Manual (test-plan F6, manual-only): unpinned workspace folder → click ⧉ → directory home page renders with the centered prompt; hard-refresh that URL → no notice flash.
