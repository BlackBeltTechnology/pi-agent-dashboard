## 1. Copy-path popup on file-tree rows (TDD)

- [x] 1.1 In `EditorFileTree.test.tsx`, add failing cases: (a) hovering a row reveals a copy glyph; (b) activating the glyph opens the popup and does NOT call `onOpenFile`; (c) selecting **Copy full path** writes `cwd + "/" + rel` via a mocked `navigator.clipboard.writeText`; (d) **Copy relative path** writes `rel`; (e) **Copy file name** writes the basename; (f) a directory row's glyph copies without toggling `onToggleRoot`; (g) outside-click / Escape / rail-scroll dismiss the popup with no copy; (h) with `navigator.clipboard` undefined, selecting an action does not throw.
- [x] 1.2 In `EditorFileTree.tsx`, render a hover-revealed copy glyph on each row (file and directory), flush-right, visible on `:hover` and while its popup is open. Add `paddingRight` so the glyph does not overlap the name.
- [x] 1.3 Wire the glyph click to `stopPropagation` + toggle an anchored popup (component-local state keyed by row `rel`). Popup offers **Copy full path** (`absOf(cwd, rel)`), **Copy relative path** (`rel`), **Copy file name** (basename), with the absolute path as a truncated header. Flip the popup above the glyph when it would overflow the rail bottom.
- [x] 1.4 On action select: `navigator.clipboard?.writeText(payload)` guarded (silent no-op when unavailable), transient ✓ on the chosen item, then close. Reuse the `CopyButton` feedback timing (~1.5 s). Dismiss on outside-click, rail scroll, and Escape.

## 2. Validate

- [x] 2.1 `EditorFileTree.test.tsx` green via `HOME=$(mktemp -d) npx vitest run packages/client/src/components/editor-pane/__tests__/EditorFileTree.test.tsx`.
- [x] 2.2 Keyboard/a11y pass (per `accessibility-a11y`): glyph is focusable, popup items are keyboard-reachable, Escape closes and returns focus to the glyph.
- [x] 2.3 Manual (browser-verified live, per `isolated-ui-verification`): hover a tree row → glyph appears → click → popup with the three actions and path header → each action copies the expected payload; popup flips above near the rail bottom; dismiss paths work.
- [x] 2.4 `openspec validate copy-file-path --strict` passes.
