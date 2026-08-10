# Markdown table styling

## Why

GFM tables in the chat view read as a flat block of text: the header barely
separates from the message and rows have no banding, so scanning wide tables is
hard. Root cause is not two competing renderers — chat view and the editor-pane
content view both render the **same** `MarkdownContent` component, styled by a
single CSS block (`packages/client/src/index.css:190-193`). That block gives the
header `background: var(--bg-tertiary)`, which is only ~10 luma from the chat
bubble's `var(--bg-secondary)` background, and it has **no zebra striping at all**
(no `nth-child` rule exists anywhere in the repo). Against the darker bubble the
header vanishes and rows blur together.

A live mockup across all 9 themes × dark/light (`mockup/index.html`) confirms a
single CSS block plus one theme token fixes every palette at once.

## What Changes

- Restyle `.markdown-content table` (one CSS block) so tables render with a
  clearly-elevated header, zebra-striped body rows, rounded clipped corners, a
  row-hover highlight, and kept column separators. Scope stays
  `.markdown-content`, so the fix applies uniformly to every surface that renders
  markdown (chat view, editor-pane content view, KB, resources) — no per-surface
  divergence.
- Header background switches from `var(--bg-tertiary)` to `var(--bg-surface)`
  (each theme's existing "elevated" token), so the header separates in every
  theme without new tuning.
- Add one theme-driven token `--table-stripe` for the zebra banding, defined in
  every theme (dark + light) so each theme controls its own banding and can later
  override with a palette-tinted value.
- Table geometry changes from `border-collapse: collapse` to
  `border-collapse: separate` + `overflow: hidden`, required to clip the stripes
  to the rounded corners.

## Impact

- Affected specs: `markdown-rendering` (ADDED requirement: GFM table visual
  styling).
- Affected code:
  - `packages/client/src/index.css` — replace the `.markdown-content table`
    block; add `--table-stripe` to `:root` and `[data-theme="light"]` for the
    `base` theme (which strips inline vars).
  - `packages/client/src/lib/themes.ts` — add `--table-stripe` to
    `CSS_VAR_KEYS` and merge a per-mode value into every theme's `dark`/`light`
    map (mirrors the existing `statusVars` merge pattern).
- No component/API change; `MarkdownContent` markup is untouched. Purely visual.
- Verification: existing `MarkdownContent` GFM-table test stays green; add a
  test asserting `--table-stripe` is a defined key for every theme.

## Discipline Skills

None. Pure presentational CSS + one theme token; no auth/untrusted-input,
performance-budget, observability, or migration surface.
