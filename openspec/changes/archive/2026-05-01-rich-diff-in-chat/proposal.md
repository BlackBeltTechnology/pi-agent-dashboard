## Why

The Edit tool card in chat renders diffs with a homegrown unified-patch renderer (`createTwoFilesPatch` + manual line coloring) while the dedicated `FileDiffView` content area renders the same data with `@git-diff-view/react` — full syntax highlighting, proper hunk rendering, theme integration. The two surfaces show the *same change* with visibly different fidelity, and the chat surface is where users spend most of their attention. Promoting the rich renderer into chat closes the visual gap without measurable cost, because `ToolCallStep` already lazy-mounts renderers on expand (collapsed by default for Edit) so the heavy tokenizer never runs unless the user opts in.

## What Changes

- Extract a shared `<RichDiff>` component from the diff-rendering core of `DiffPanel.tsx` (build `DiffFile` via `generateDiffFile`, init split/unified lines, mount `<DiffView>` from `@git-diff-view/react` with lowlight syntax highlighting).
- In `EditToolRenderer.tsx`, branch on `useMobile()`:
  - **Mobile**: keep the current homegrown line-colored unified patch (cheap, narrow-viewport friendly, no behavior change).
  - **Desktop**: render `<RichDiff oldText newText filePath mode="unified" />` with chat-friendly defaults — forced unified mode, no toolbar, capped `max-h` with internal scroll.
- `DiffPanel.tsx` is refactored to consume the same shared `<RichDiff>` for its single-file rendering path, retaining its split/unified toggle and toolbar via props.
- No change to `ToolCallStep`'s expand/collapse behavior — the existing `{expanded && <Renderer />}` gate already provides on-demand mounting, so the rich diff only tokenizes when the user clicks the chevron.
- No change to mobile, no change to the FileDiffView surface, no change to the homegrown renderer's output (still used as mobile fallback).

## Capabilities

### New Capabilities
*(none)*

### Modified Capabilities
- `tool-renderers`: `EditToolRenderer` requirement is updated so that the diff rendering on desktop uses the rich syntax-highlighted view, while mobile retains the existing homegrown view. The "stacked per-edit" and "raw JSON fallback" sub-requirements are unchanged.

*(`file-diff-view`'s user-visible behavior does not change — `DiffPanel` is refactored internally to consume the shared `<RichDiff>` component, but its split/unified toggle, syntax highlighting, and expand controls all remain identical. Captured in design.md and tasks.md as an implementation detail.)*

## Impact

**Affected code:**
- `packages/client/src/components/tool-renderers/EditToolRenderer.tsx` — branch on `useMobile()`, swap inner `DiffView` for `<RichDiff>` on desktop.
- `packages/client/src/components/DiffPanel.tsx` — extract its diff-core into `<RichDiff>`, then consume it.
- New file: `packages/client/src/components/RichDiff.tsx` — shared component encapsulating `generateDiffFile` + `<DiffView>` from `@git-diff-view/react` + the lang-extension map.
- The `EXT_LANG_MAP` constant currently in `DiffPanel.tsx` moves into the shared component (or a sibling util) so both call sites stay consistent.

**Dependencies:**
- No new dependencies. `@git-diff-view/react`, `@git-diff-view/file`, `@git-diff-view/lowlight` are already production deps used by `DiffPanel`.

**Bundle:**
- The chat-critical bundle gains an import path to the git-diff-view stack. In practice this stack is already loaded the moment any user opens `FileDiffView` once per session, and chat-rendered Edit cards default to collapsed — the heavy code path is only reached on user-initiated expand. No new code is *eagerly* executed for users who never expand a diff.

**Behavior:**
- Desktop: visually richer Edit/multi-edit diffs in chat, matching `FileDiffView` style.
- Mobile: identical to today.
- Performance: identical to today for collapsed cards; rich-diff tokenization runs only on user-triggered expand.

**Out of scope:**
- WriteToolRenderer (full-file adds) — could benefit from the same treatment but is not part of this change to keep the diff narrow.
- Split-view toggle inside chat — unified-only is intentional; users wanting split view open `FileDiffView` via the existing header button.
- Persisting expand-state across reloads.
