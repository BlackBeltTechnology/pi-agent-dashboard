# Host design for plugin UI

Derived from root `ui-contract.md`; update together. This is the
plugin-author subset of the dashboard's design contract. The full contract
lives in the dashboard repo root and is not published to npm; this file is.

A plugin renders inside the dashboard shell (slots, content views, settings
sections). It must look like part of the host in every theme the host ships.

## The one rule: paint through host tokens

The dashboard ships 9 themes × dark/light = 18 palettes. The `base` theme is
declared in `packages/client/src/index.css`; the other 8 palettes overwrite
the **same token names** at runtime. Paint with the tokens below and your UI
follows every palette. A raw colour literal (`#hex`, `rgb(`, `hsl(`, or a
Tailwind palette class like `text-green-400`) is correct in at most one of
the 18.

Use them as CSS variables: `color: var(--text-primary)`, or in Tailwind as
arbitrary values: `text-[var(--text-primary)]`, `bg-[var(--bg-secondary)]`,
`border-[var(--border-secondary)]`.

## Surfaces, text, borders

| Role | Token |
|---|---|
| page surface | `--bg-primary` |
| raised surface / card | `--bg-secondary` |
| inset surface / chip | `--bg-tertiary` |
| control surface | `--bg-surface` |
| hover wash | `--bg-hover` |
| code surface | `--bg-code` |
| modal scrim | `--bg-overlay` |
| primary text | `--text-primary` |
| secondary text (labels, timestamps, counts) | `--text-secondary` |
| tertiary text | `--text-tertiary` |
| decoration only (disabled, `aria-hidden`) | `--text-muted` |
| hairline / divider | `--border-primary`, `--border-secondary`, `--border-subtle` |
| strong border | `--border-strong` |
| primary action | `--accent-primary` |
| link | `--link`, `--link-hover` |
| focus ring | `--focus-ring` |

## Severity and status

- Any state message, badge or callout uses the severity family
  `--severity-<level>-{bg,fg,border}` with level = error, warning, success,
  info, neutral. Example: `--severity-error-bg`, `--severity-error-fg`,
  `--severity-error-border`.
- Session lifecycle state uses `--status-working`, `--status-idle`,
  `--status-error`, `--status-needs-you` on **shapes and dots only**, never as
  text colour. Put the status word in `--text-secondary` beside an
  `aria-hidden` dot.
- A tint fg (`--tint-blue-fg`) is only painted on its own tint bg
  (`--tint-blue-bg`), as a filled chip or button, never on a card surface.

## Coloured text

- When text must carry a hue, use the accent-text tokens
  `--accent-<hue>-text` (hue = purple, blue, green, orange, red, yellow), e.g.
  `--accent-blue-text`, `--accent-red-text`. They hold WCAG-AA 4.5:1 on the
  host surfaces.
- Never paint text with the fill accents `--accent-<hue>`: they carry no
  contrast guarantee.
- Hue is a secondary cue. Back it with a word, icon or shape.

## Both modes

Every plugin surface works in dark and light. Check both, plus one non-`base`
palette, before shipping. Never branch on the theme in code to pick colours;
the tokens already switch.

## What a plugin must not add

- No own theme, palette, or `data-theme` handling.
- No own font stack or `@font-face`; inherit the host's.
- No global styles: no `:root`, `html`, `body` or bare element selectors, no
  CSS resets. Scope any CSS to your plugin's root element.
- No new CSS custom properties that shadow a host token name.

## Anti-slop profile

Plugin UI is product UI. If the anti-slop suite
(`@blackbelt-technology/anti-slop-frontend`) is installed, review plugin
surfaces with the `product-ui` profile: universal tells apply, marketing tells
and layout discipline do not, redesigns default to `preserve`, and image
direction is forbidden.
