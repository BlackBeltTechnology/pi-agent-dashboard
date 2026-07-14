# Design

## Context

Both the chat view and the editor-pane "content view" render through one
component, `MarkdownContent` (`packages/client/src/components/MarkdownContent.tsx`,
plain `<table>{children}</table>`), styled by a single CSS block:

```css
/* packages/client/src/index.css:190-193 (current) */
.markdown-content table { border-collapse: collapse; margin: .5em 0; width: 100%; }
.markdown-content th, .markdown-content td { border: 1px solid var(--border-secondary); padding: .3em .6em; text-align: left; }
.markdown-content th { background-color: var(--bg-tertiary); font-weight: 600; }
```

The theme system (`packages/client/src/lib/themes.ts`) defines 9 themes
(base, dracula, nord, github, catppuccin, tokyo-night, rose-pine, solarized,
gruvbox) × dark/light = 18 palettes. Non-`base` themes apply their tokens as
inline `document.documentElement.style` overrides via `applyThemeVars`; `base`
strips inline overrides and falls back to the CSS `:root` / `[data-theme=light]`
values.

## Goals

- One shared CSS block fixes every surface and every theme.
- No hand-tuned per-theme table colors beyond a single overridable token.

## Decisions

### D1 — Two knobs, both theme-adaptive

- **Header** = each theme's existing `var(--bg-surface)` (the "elevated" token,
  one step lighter/darker than `--bg-tertiary`). No new token; every theme
  already defines it with adequate contrast against its bubble background.
- **Stripe** = one new token `--table-stripe`. Value is a subtle translucent
  overlay (dark `rgba(255,255,255,0.045)`, light `rgba(0,0,0,0.035)`) so it reads
  correctly regardless of the container background the table sits on (chat
  bubble, editor pane, KB) — the table is not always on `--bg-secondary`.

Alternative considered: opaque `--bg-tertiary` stripe (pure token reuse, no new
token). Rejected — it assumes the row's default background is `--bg-secondary`;
on an editor-pane container that is itself `--bg-tertiary`, opaque stripes would
disappear. The translucent token is container-independent.

### D2 — Token registration path

`--table-stripe` is added to `CSS_VAR_KEYS` and merged into each theme's
`dark`/`light` map, following the existing `statusVars` merge idiom. Because the
value differs by mode, use two shared consts:

```ts
const darkTableVars  = { "--table-stripe": "rgba(255,255,255,0.045)" };
const lightTableVars = { "--table-stripe": "rgba(0,0,0,0.035)" };
```

merged into `dark` and `light` respectively for every theme. It is ALSO added to
`:root` and `[data-theme="light"]` in `index.css` so the `base` theme (inline
vars stripped) still resolves it. Each theme keeps the ability to override with a
palette-tinted value later.

### D3 — border-collapse: separate (tradeoff)

Rounded corners that clip zebra fills require `border-collapse: separate` +
`border-spacing: 0` + `overflow: hidden` on the `<table>`, replacing the current
`collapse`. Cell borders move to per-side (`thead th` bottom border, `tbody td`
bottom border, `:not(:last-child)` right border for column separators) so the
grid still looks collapsed. Risk is low: the only consumer is markdown-generated
tables through the shared component; no code depends on collapsed-border
geometry.

### D4 — Keep column separators

Faint vertical dividers (`th/td:not(:last-child) { border-right }`) are kept per
review preference — they aid wide two-column tables like the mockup's
Concern/Resolution layout. Horizontal row borders use `--border-primary`
(subtler than the outer `--border-secondary` frame).

## Proposed CSS

```css
.markdown-content table {
  border-collapse: separate; border-spacing: 0; margin: .6em 0; width: 100%;
  border: 1px solid var(--border-secondary); border-radius: 8px; overflow: hidden;
}
.markdown-content thead th {
  background: var(--bg-surface); color: var(--text-primary); font-weight: 600;
  text-align: left; padding: .5em .7em; border-bottom: 1px solid var(--border-secondary);
}
.markdown-content tbody td {
  padding: .45em .7em; border-bottom: 1px solid var(--border-primary); vertical-align: top;
}
.markdown-content tbody tr:last-child td { border-bottom: none; }
.markdown-content tbody tr:nth-child(even) { background: var(--table-stripe); }
.markdown-content tbody tr:hover { background: var(--bg-hover); }
.markdown-content th:not(:last-child),
.markdown-content td:not(:last-child) { border-right: 1px solid var(--border-primary); }
```

## Verification

- `mockup/index.html` — every theme × mode renders a legible striped table with a
  separated header (spot-checked base/dark, solarized/dark, github/light).
- Unit: `--table-stripe` present in `CSS_VAR_KEYS` and in every `THEMES[i].dark`
  and `.light` map.
- Existing GFM-table render test stays green (markup unchanged).
