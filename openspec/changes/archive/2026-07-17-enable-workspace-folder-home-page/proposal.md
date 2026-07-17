# Enable workspace-folder directory home page

## Why

The directory home page (`/folder/:encodedCwd` → `DirectoryHomeView`) already exists,
but workspace-owned folders cannot reach it. Two gates from the archived
`add-directory-home-page` change block them:

- **D3 (sidebar affordance):** the "open" icon-button is rendered only when
  `isPinned && !inWorkspace` (`SessionList.tsx` `renderGroup`), so it is hidden on
  every folder inside a workspace.
- **D4 (page guard):** `DirectoryHomeView` renders only when
  `pinnedDirectories.includes(cwd)`; workspace folders live in `workspaces[].folders`,
  not `pinnedDirectories`, so a direct URL to one shows the "not pinned" notice.

Users organize directories into workspaces and expect the same per-directory home
page there. Today that surface is unreachable for exactly those folders.

## What Changes

- Show the existing open (`mdiOpenInNew`) sidebar affordance on workspace-folder
  rows, not only on pinned non-workspace rows. **The condition becomes
  `isPinned || inWorkspace`** — NOT merely "drop `!inWorkspace`": `renderGroup` is
  called for workspace rows as `renderGroup(folder, folder.pinned, true)`
  (`SessionList.tsx:1396`), so `isPinned` is `false` for an *unpinned* workspace
  folder (`session-grouping.ts:232` `pinned: pinnedSet.has(key)`). Dropping only
  `!inWorkspace` would still hide the button on exactly the folders this change
  targets. Navigation stays on this distinct control; the folder-name click
  continues to toggle collapse (unchanged).
- Broaden the `DirectoryHomeView` guard to accept a cwd that is EITHER pinned OR a
  member of `workspaces[].folders` (approach **A1** — pass workspace-folder paths in).
- Add a `workspacesLoaded` gate. Pinned dirs and workspaces arrive in **separate**
  WS messages (`pinned_dirs_updated` then `workspaces_updated`), NOT one snapshot,
  so reusing `pinnedDirectoriesLoaded` alone flashes the guard-miss notice for a
  workspace-only cwd on cold load. The guard must wait on both flags.
- Reword the guard-miss notice so it is not pinned-specific (it now covers
  "neither pinned nor a workspace folder").

Non-goals: the folder-name click is NOT repurposed to navigate (preserves the D3
collapse gesture and avoids conflict with the active `accordion-workspace-folders`
and `focus-driven-folder-compaction` changes, which both rely on the header click).

## Capabilities

### Modified Capabilities

- `directory-home-page`: broaden the pinned-only page guard and the pinned-only
  sidebar open affordance to also cover workspace-owned folders.

## Impact

- `packages/client/src/components/SessionList.tsx` — drop the `!inWorkspace` term on
  the open-affordance render condition.
- `packages/client/src/components/DirectoryHomeView.tsx` — accept a workspace-folder
  set in the eligibility guard; reword the miss notice.
- `packages/client/src/App.tsx` — pass workspace-folder paths into `DirectoryHomeView`.
- Tests: `DirectoryHomeView.test.tsx`, `SessionList` affordance tests.
