## Why

The Changes section pinned atop the editor-pane project-tree rail (`ChangesRailSection`) mounts **expanded by default** (`useState(true)`, `maxHeight: 45%`). On a large change (24 files in the reference screenshot) it consumes up to 45% of the rail's height and pushes the workspace file tree far down, forcing the user to scroll before they can reach ordinary project files. Compact-folder collapsing (`collapseTree` in `diff-tree.ts`) already merges single-child directory chains, so the remaining space cost is the section being open at all.

The user wants the changed-file tree collapsed by default so only its header is visible, reclaiming rail space until they choose to open it.

## What Changes

- `ChangesRailSection` SHALL mount **collapsed** by default — only the `▸ Changes (N)` header row is shown; the roll-up sub-header and `DiffFileTree` are hidden until the user expands it.
- Expanding (header click) SHALL reveal today's compact tree unchanged (directories open, single-child chains already merged). No change to `DiffFileTree`, `collapseTree`, or the flat/compact rendering.
- The existing `changesRevealSignal` / `openChanges()` reveal path SHALL continue to expand the section when the user activates a changed-file link from the chat transcript, so navigation-to-a-diff is unaffected.
- Collapse state is **not persisted** across sessions — every session/mount starts collapsed (matches the user's no-persistence preference). `openChanges()` reveal remains the escape hatch.

Out of scope (explored, rejected): collapsing the directory nodes inside the tree (Option B — too many drill-down clicks), a flat-list view mode (Option D — loses grouping), and reducing `maxHeight` (does not address "collapse by default").

## Discipline Skills

None — single-component default flip with an existing collapse mechanism and reveal path; covered by the component test.

## Capabilities

### Modified Capabilities
- `change-summary-table`: the Changes section's initial render state SHALL be collapsed (header-only); `openChanges()` reveal behavior is unchanged.

## Impact

- **Code**: `packages/client/src/components/editor-pane/ChangesRailSection.tsx` — initial `expanded` state `true` → `false`. No other files.
- **Tests**: `packages/client/src/components/editor-pane/__tests__/ChangesRailSection.test.tsx` — assert header-only on mount; assert `DiffFileTree` hidden until expand; assert `changesRevealSignal` bump expands.
- **APIs / protocol**: none.
- **Persistence**: none (ephemeral, resets to collapsed each mount).
- **Mockup**: `mockups/index.html` (five-option comparison; the shipped choice is Option A — section collapsed, header only).
