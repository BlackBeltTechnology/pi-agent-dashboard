# Compact the folder header: drop Terminals + Editor buttons, merge actions onto the git row

## Why

The sidebar folder-group header spent three rows on controls: the name/path
head row, the git row (`branch · commit badge · Commit`), and a `FolderActionBar`
row (`Initialize · Terminals(N) · Editor · Clean up broken · ⚙`).

Two of those action buttons — **Terminals(N)** and **Editor** — were redundant:

1. **They were identical.** In `App.tsx`, `onOpenTerminals` and `onOpenEditor`
   both ran `navigate(\`/folder/:cwd/editor\`)` — byte-for-byte the same target.
   Clicking `Terminals(0)` opened the Editor pane and, with zero existing
   terminals to auto-surface, looked like a no-op.
2. **The pane is already reachable elsewhere.** The same
   `/folder/:cwd/editor` pane is launched from the Directory home page
   (`DirectoryHomeView`) and from ChatView, so the sidebar duplicated an
   existing entry point.

Removing them lets the surviving controls (Initialize + Directory Settings)
collapse onto the git row, saving a full row of vertical space per folder in a
dense sidebar. UX validated against three compaction mockups; the human picked
variant **B** (git left, actions right-grouped, one row).

This change was implemented directly in the working session and is captured
here for the record.

## What Changes

- **Remove the `Terminals(N)` and `Editor` buttons** from `FolderActionBar`,
  along with their props (`terminalCount`, `onOpenTerminals`, `onOpenEditor`)
  and now-unused icon imports (`mdiConsoleLine`, `mdiCodeBraces`).
- **Merge the git row and the action bar into one compact row** in
  `SessionList` (variant B): `GroupGitInfo` on the left (`min-w-0`),
  `FolderActionBar` right-grouped (`ml-auto shrink-0`). The action bar becomes a
  tight content-width group (drops `flex-wrap`; the settings gear drops
  `ml-auto`).
- **Clean up the orphaned wiring** my change creates: the `terminalsByCwd`
  memo, the `terminals` / `onOpenTerminals` / `onOpenEditor` props on
  `SessionList`, the `TerminalSession` import, and the three matching props
  passed from `App.tsx` to `SessionList`. The `DirectoryHomeView`
  `onOpenTerminals` / `onOpenEditor` wiring in `App.tsx` is **preserved** — that
  is now the surviving entry point.
- **Tests**: `FolderActionBar.test.tsx` flips its "still renders Terminals"
  assertion to assert **both** Terminals and Editor are absent.
- The pre-existing unused `onKillTerminal` / `onRenameTerminal` props on
  `SessionList` are left as-is (out of scope) with a clarifying comment.

## Capabilities

### Modified Capabilities

- `folder-action-bar`: the "Folder action bar layout" Requirement is rewritten
  to drop Terminals/Editor and describe the merged one-row layout; the
  "Terminals button with count badge" and "Editor button opens the internal
  folder pane" Requirements are removed.

## Impact

- **No feature lost.** The internal folder editor pane (with its terminal tabs)
  remains reachable from the Directory home page and ChatView.
- **Vertical density.** Each expanded folder header drops from three rows to two.
- **Code impact.** ~90 LOC net removed across `FolderActionBar.tsx`,
  `SessionList.tsx`, `App.tsx`, and two test files. No new dependencies.
- **Out of scope.** Two separately-diagnosed bugs still live on the
  `DirectoryHomeView` / editor-pane path: (a) its `onOpenTerminals` ===
  `onOpenEditor` identical-navigation (Terminals opens Editor with no terminal
  when count is 0), and (b) the duplicate terminal header (`TerminalView`'s
  internal header duplicates the `EditorTabs` tab title). Neither is addressed
  here.

## Discipline Skills

- `review-code`: applied inline after the change and before it landed (non-trivial multi-file edit with tests passing).
