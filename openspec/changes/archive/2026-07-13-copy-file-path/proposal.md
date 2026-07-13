## Why

The editor pane's file-tree rail (`EditorFileTree`) lets a user browse the
session cwd and open files, but offers **no way to lift a file's path out of the
UI**. Copying a path is a constant need — pasting it into the chat prompt, a
terminal, a `cat`/`grep`, another tool — and today the only recourse is to open
the file and read the footer, then hand-retype the path. The rail already knows
each row's absolute path (`cwd + rel`); it just never exposes it.

## What Changes

- Add a **hover-revealed copy affordance** to every file-tree row (files **and**
  directories). A copy glyph fades in on row hover, flush-right, matching the
  rail's existing icon language.
- Clicking the glyph **never opens the file** (`stopPropagation`) — it opens a
  small **popup menu anchored to the glyph** with three actions:
  - **Copy full path** — the absolute path (`cwd + rel`).
  - **Copy relative path** — the path relative to the session cwd (`rel`).
  - **Copy file name** — the basename.
- The popup header shows the target absolute path (truncated) so the action is
  unambiguous. The popup flips above the glyph when it would overflow the rail
  bottom.
- On pick: the chosen item flashes a ✓, the payload copies to the clipboard, and
  the popup closes. Reuses the existing `CopyButton` feedback family (green ✓,
  `navigator.clipboard.writeText`). Dismiss on outside-click, scroll, or Esc.

Non-goals: no right-click OS context menu (the affordance is the visible glyph);
no "Reveal in Finder"/editor-launch actions in this menu (that path exists
elsewhere); no multi-select copy; no change to the tree-listing endpoint, the
open-file path, rail visibility/persistence, or icons.

## Impact

- `packages/client/src/components/editor-pane/EditorFileTree.tsx` — each row
  gains a hover-revealed copy glyph + anchored popup menu; row `paddingRight`
  accommodates the glyph. Absolute/relative paths derive from the existing
  `absOf`/`joinRel` helpers. Directory rows get the affordance too. `activePath`
  and open-file behavior unchanged.
- `packages/client/src/components/editor-pane/__tests__/EditorFileTree.test.tsx`
  — new cases: glyph copies absolute/relative/name via `navigator.clipboard`,
  glyph click does not trigger `onOpenFile`, popup dismiss paths, clipboard-
  unavailable no-op.
- `openspec/specs/internal-monaco-editor-pane/spec.md` — new requirement for the
  per-row copy-path popup on the file-tree rail.

## Discipline Skills

`accessibility-a11y` (popup keyboard reachability + focus return during
implementation) and `isolated-ui-verification` (task 2.3 live browser check).
No auth / untrusted-input / perf / observability surface; standard TDD +
code-review + code-quality end gates also apply.
