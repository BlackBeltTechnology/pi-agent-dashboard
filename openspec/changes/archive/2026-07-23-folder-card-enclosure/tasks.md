## 1. Enclose the folder body (TDD)

- [x] 1.1 Write/extend `SessionList.test.tsx` first: assert the Create tray (`folder-spawn-*`) and the "Show N ended" toggle render as descendants of the folder body wrapper (a `data-testid="folder-body-<cwd>"`), not as siblings outside the card. Verify it fails.
- [x] 1.2 In `renderGroup`, make the header card `rounded-t-[14px]` + `border-b-0` when expanded (keep fully-rounded when collapsed), and add a `folderbody` wrapper (`bg-[var(--bg-primary)]`, `border-t-0`, `rounded-b-[14px]`, fold-shadow `::before` via an inline element or utility) that renders only when `!isCollapsed`.
- [x] 1.3 Move the Create tray (`FolderSpawnButtons` + CREATE divider), the active session list + `PlaceholderSessionCard` + spawn-error banners, and the "Show N ended" row inside `folderbody`. Preserve DnD `SortableContext`, all `data-testid`s, and gating.
- [x] 1.4 Add a `SESSIONS` separator (reuse the CREATE divider markup/style) between the Create tray and the session cards; omit it when the folder has no sessions.
- [x] 1.5 Verify collapsed folders render only the header (no body), fully rounded.

## 2. Root (non-workspace) accent tint

- [x] 2.1 Write test first: a folder rendered at top level (`!inWorkspace`) has the tinted surface class/style; a folder rendered with `inWorkspace` does not. Verify it fails.
- [x] 2.2 Apply the accent tint (`color-mix(in srgb, var(--accent-blue) 5%, var(--bg-primary))` bg + accent-tinted border) to the header AND body (and the nub) only when `!inWorkspace`. Workspace path unchanged.

## 3. Verify

- [x] 3.1 `SessionList.test.tsx` green (existing + new cases).
- [x] 3.2 `npm run build` clean; restart; visually confirm in the live dashboard: enclosure + fold seam + CREATE/SESSIONS separators + ended inside, in light AND dark AND a warm theme (Rosé Pine Dawn) for the root tint.
- [x] 3.3 Confirm no regression to spawn, DnD reorder, collapse/expand, workspace nesting, or the folder-tab nub.
