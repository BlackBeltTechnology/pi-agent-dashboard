## Why

The code/diff payload inside chat tool-call cards renders at inconsistent font sizes across renderers. Most visibly: `Read` output is `0.7rem ≈ 11.2px` (forced via SyntaxHighlighter `customStyle`) while desktop `Edit` output (via `RichDiff` / `@git-diff-view`) has no font-size constraint and inherits **~14px** from the surrounding chat bubble. The user perceives a jarring size jump when scanning a `Read(foo.ts)` block followed by an `Edit(foo.ts)` block.

Measured sizes today:

| Surface | Computed font-size |
|---|---|
| `ReadToolRenderer` content | ≈11.2 px (`0.7rem`) |
| `WriteToolRenderer` content | ≈11.2 px (`0.7rem`) |
| `EditToolRenderer` desktop (`RichDiff`) | ~14 px (inherited — no override) |
| `EditToolRenderer` mobile fallback | 12 px (`text-xs`) |
| `BashToolRenderer` output | 12 px (`text-xs`) |
| `GenericToolRenderer` output | 12 px (`text-xs`) |

Decision (from exploration):

1. Target one shared size for code/diff payload in tool renderers: **12 px** (matches `text-xs`, no fractional pixels, smaller than 14 px chat prose by design).
2. Extract a single shared utility class so future renderers cannot drift.
3. Out of scope: `DiffPanel` (full-screen diff viewer — separate surface, keeps 13 px), markdown code blocks inside assistant prose (`MarkdownContent`), and any non-code chrome (filename labels, status text, button labels).

## What Changes

- Add a single shared utility class `.text-code` in `packages/client/src/index.css` (via `@layer utilities`) that sets `font-size: 12px` and a sensible line-height for monospace code.
- Replace inline `fontSize: "0.7rem"` overrides in `ReadToolRenderer` and `WriteToolRenderer` SyntaxHighlighter `customStyle` with `fontSize: "12px"` (or pass via the utility class on a wrapper — whichever the library supports cleanly).
- Apply `.text-code` to the desktop `RichDiff` wrapper inside `EditToolRenderer` so its inherited 14 px is overridden down to 12 px. (This is the most visible fix.)
- Replace `text-xs` with `text-code` on:
  - the mobile `DiffView` fallback inside `EditToolRenderer`
  - the `<pre>` output block in `BashToolRenderer`
  - the `<pre>` output block in `GenericToolRenderer`
- Leave filename headers, "Running…" status text, "Open in editor" buttons, and `AskUserToolRenderer` chrome at their existing `text-xs` size — they are not code payload.

After the change, every code/diff payload in a tool card renders at 12 px on both mobile and desktop. No more visual jump between Read and Edit.

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `tool-renderers`: Add a uniform font-size requirement for the code/diff payload region of `ReadToolRenderer`, `WriteToolRenderer`, `EditToolRenderer`, `BashToolRenderer`, and `GenericToolRenderer`. The payload SHALL render at 12 px (via shared `.text-code` utility) on both mobile and desktop. Non-payload chrome is unaffected.

## Impact

- **Code**:
  - `packages/client/src/index.css` — add `.text-code` utility in `@layer utilities`.
  - `packages/client/src/components/tool-renderers/ReadToolRenderer.tsx` — replace `0.7rem` with `12px`.
  - `packages/client/src/components/tool-renderers/WriteToolRenderer.tsx` — replace `0.7rem` with `12px`.
  - `packages/client/src/components/tool-renderers/EditToolRenderer.tsx` — add `text-code` to the `RichDiff` wrapper and to the mobile `DiffView` root.
  - `packages/client/src/components/tool-renderers/BashToolRenderer.tsx` — `text-xs` → `text-code` on the output `<pre>`.
  - `packages/client/src/components/tool-renderers/GenericToolRenderer.tsx` — `text-xs` → `text-code` on the output `<pre>`.
- **Tests**: No existing tests assert font-size on these renderers. A single visual sanity check (computed `font-size: 12px` on each renderer's payload root) is enough; no behavior change.
- **Out of scope**:
  - `DiffPanel.tsx` keeps its `13px` SyntaxHighlighter setting.
  - `MarkdownContent` code blocks (assistant prose) keep their 14 px inherited size. This means inline ``` fences in assistant text still render larger than the same code shown inside a tool card — accepted asymmetry: chat prose code is part of the explanation, tool-card code is the payload.
- **UX**: `Edit` cards on desktop will shrink from ~14 px to 12 px — a visible change for current users, intentional and the point of the proposal.
- **Risk**: Low. Pure CSS / className changes. No data, protocol, or state-machine impact.
