## Why

Syntax-highlighted code blocks paint per-token background pills (`.token.deleted`,
`.token.inserted`, `.token.selector`, etc.) baked into the prebuilt prism styles
shipped by `react-syntax-highlighter`. Those pills were designed to harmonize
with each prism style's own panel background, but the dashboard overrides the
panel background to `var(--bg-code)` so the active app theme drives it. The
result is colored character-level backgrounds that no longer relate to the
surrounding panel — visually noisy, and especially jarring for the bundled
"Base" theme that ships with pi-dashboard.

The panel background is fine and should stay distinct (it identifies code
regions). What needs to go is the **per-token** background, so characters
render colored on the panel cleanly without their own pills.

## What Changes

- Extend `getSyntaxTheme()` in `packages/client/src/lib/syntax-theme.ts` to
  strip `background` and `backgroundColor` from every token-level selector in
  the cloned prism style (selectors matching `.token`), while leaving the
  wrapper selectors (`pre[class*="language-"]`, `code[class*="language-"]`)
  untouched so the panel background remains overridable to `var(--bg-code)`.
- Route `DiffPanel`'s "File" view through `getSyntaxTheme(theme, themeName)`
  instead of importing `oneDark` directly, so the same strip applies.
- Strip applies to ALL token classes including semantic ones like
  `.token.deleted` / `.token.inserted` (red/green wash inside fenced ```diff
  blocks) — the panel-level diff hunk highlighting in `DiffView` is unaffected.
- Add a unit test asserting no `.token*` selector retains a `background` /
  `backgroundColor` property after `getSyntaxTheme()` returns.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `theme-system`: extends the existing "Syntax highlighter background matches
  theme" requirement with a sibling clause that token-level backgrounds SHALL
  be stripped from prism styles before they are applied.

## Impact

- `packages/client/src/lib/syntax-theme.ts` — helper grows ~10 lines for the
  clone-and-strip pass. Pure function, no I/O.
- `packages/client/src/components/DiffPanel.tsx` — swap raw `oneDark` import
  for `getSyntaxTheme(theme, themeName)`; +2 lines (theme context hook),
  -1 line (import), 1 prop change. No behavior change beyond inheriting the
  strip.
- `packages/client/src/lib/__tests__/syntax-theme.test.ts` (new or extend
  existing) — token-strip assertion.
- No server-side changes. No protocol changes. No persistence changes.

Out of scope: `<DiffView>` from `@git-diff-view/react` (used in DiffPanel's
"Diff" view mode). Its tokens are highlighted by `@git-diff-view/lowlight`
and styled via `@git-diff-view/react/styles/diff-view.css` — a separate
mechanism that would need CSS overrides, not a prism-style transform.
