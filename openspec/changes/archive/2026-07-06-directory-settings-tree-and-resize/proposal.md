## Why

The Directory Settings → Instructions file picker renders every writable `.md`
candidate as a flat list of full `relPath` strings. With `.pi/skills/**`,
`.pi/agents/**`, `.pi/prompts/**` etc., dozens of rows share the same prefix
while their meaningful leaf name is truncated off the right edge, and there is
no way to collapse a noisy directory. The picker is also frozen at 240px, so
long paths clip with no way to widen the pane. The result reads as unfriendly
and hard to scan.

## What Changes

- Fold the flat `relPath` candidate list into a **collapsible folder tree**:
  directories nest with chevron rows, files show only their basename. A plain
  tree — single-child directories are NOT auto-collapsed (`skills/autofix/SKILL.md`
  stays as `autofix › SKILL.md`).
- Make the tree column and the editor pane **resizable** via a draggable
  `col-resize` gutter (reusing the `ResizableSidebar` drag idiom), clamped to a
  min/max width.
- **Persist** UI state to `localStorage`: which folders are collapsed (default:
  all expanded) and the tree column width. Only collapsed paths are stored, so
  new folders default to expanded.
- The substring filter keeps a folder visible when any descendant matches, and
  force-expands while filtering.
- **Mobile** (below the `md` breakpoint) uses a **master/detail** layout instead
  of a split: the tree owns the full viewport; tapping a file swaps to the
  full-screen editor; a back affordance returns to the tree (aligned with the
  existing per-file URL push in `InstructionsPage`). No split, no resize on
  mobile; rows are ≥44px tall for touch.

No server/API changes — `/api/file/md-candidates` already returns the `relPath`
list the tree folds from.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `directory-settings-page`: the Instructions file picker requirement changes
  from a flat writable-candidate list to a collapsible folder tree with a
  resizable, persisted column width and a mobile master/detail layout.

## Impact

- **Code**: `packages/client/src/components/DirectorySettings/FilePicker.tsx`
  (flat map → tree build + recursive rows + collapsed-set state),
  `InstructionsPage.tsx` (resize gutter + width state; mobile view-switch keyed
  off `selected`/URL).
- **Reused idioms**: chevron-fold + `depth*16px` indent from `resource-tree.tsx`;
  `col-resize` drag from `ResizableSidebar.tsx`.
- **Persistence**: two new `localStorage` keys (collapsed set, tree width).
- **APIs / server / shared**: none. No protocol or endpoint change.
- **Tests**: `FilePicker.test.tsx`, `InstructionsPage.test.tsx` updated for tree
  rendering, fold/persist, and resize.

## Discipline Skills

None of the `eng-disciplines` skills apply — this is a self-contained
client-side UX change with no auth/untrusted-input, latency budget, new
endpoint, or irreversible step. Design was grounded via `frontend-mockup-loop`
(mockups in `mockups/`).
