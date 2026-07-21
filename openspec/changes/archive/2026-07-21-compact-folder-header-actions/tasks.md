# Tasks — compact-folder-header-actions

All tasks implemented in-session (change captured retroactively for the record).

## Implementation

- [x] Remove `Terminals(N)` + `Editor` buttons from `FolderActionBar.tsx`, drop props (`terminalCount`, `onOpenTerminals`, `onOpenEditor`) and unused icon imports (`mdiConsoleLine`, `mdiCodeBraces`)
- [x] Tighten `FolderActionBar` layout: drop `flex-wrap`; settings gear drops `ml-auto`
- [x] Merge git row + action bar into one row in `SessionList.tsx` (variant B: `GroupGitInfo` `min-w-0` left, `FolderActionBar` `ml-auto shrink-0` right)
- [x] Remove orphaned `terminalsByCwd` memo, `terminals` / `onOpenTerminals` / `onOpenEditor` props, and `TerminalSession` import from `SessionList.tsx`
- [x] Remove the three matching props (`terminals`, `onOpenTerminals`, `onOpenEditor`) passed to `SessionList` in `App.tsx`; preserve the `DirectoryHomeView` pair

## Tests

- [x] `FolderActionBar.test.tsx` — assert Terminals **and** Editor buttons are NOT rendered
- [x] `FolderActionBar-cleanup-broken.test.tsx` — drop removed props from `renderBar` defaults
- [x] `npx vitest run` FolderActionBar + cleanup + SessionList → 44 pass
- [x] `tsc --noEmit` on client → no new errors (2 pre-existing, unrelated)

## Validate

- [x] `npm run build` client → success
- [x] `POST /api/restart` → live dashboard shows variant B (git left, Initialize + gear right, one row; Terminals/Editor gone)

## Docs

- [x] Update `FolderActionBar.tsx.AGENTS.md` + `folder/AGENTS.md` per Documentation Update Protocol
