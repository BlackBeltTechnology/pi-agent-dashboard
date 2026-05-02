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
  the cloned prism style (selectors matching `.token`).
- **Also strip the inner `code[class*="language-"]` wrapper background** so
  that callers' `customStyle.background = 'var(--bg-code)'` (applied only to
  the outer PreTag) actually shows through. Without this, the inner
  `<code>` element paints the prism palette's stock panel color
  (`hsl(220, 13%, 18%)` for `oneDark`) over the customStyle override and
  every simple syntax-highlighted code block in chat / Read / Write tool
  results displays the wrong panel background. Leave
  `pre[class*="language-"]` background intact (it's the safety-net default
  for any caller that doesn't pass `customStyle`).
- Route `DiffPanel`'s "File" view through `getSyntaxTheme(theme, themeName)`
  instead of importing `oneDark` directly, so the same strip applies.
- Strip applies to ALL token classes including semantic ones like
  `.token.deleted` / `.token.inserted` (red/green wash inside fenced ```diff
  blocks) — the panel-level diff hunk highlighting in `DiffView` is unaffected.
- Bind `<DiffView>`'s `diffViewTheme` prop to the active app theme instead of
  the hardcoded `"dark"` so the diff view re-themes when the user toggles
  light / dark.
- Add a unit test asserting no `.token*` selector retains a `background` /
  `backgroundColor` property after `getSyntaxTheme()` returns.
- Add a sibling unit test asserting `code[class*="language-"]` has no
  `background` / `backgroundColor` property after the strip; AND asserting
  `pre[class*="language-"]` retains its background (the outer-pre wrapper
  is the safety-net default and stays).

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `theme-system`: extends the existing "Syntax highlighter background matches
  theme" requirement with sibling clauses that (a) token-level backgrounds
  SHALL be stripped from prism styles before they are applied, and (b) the
  inner `code[class*="language-"]` wrapper background SHALL also be stripped
  so the customStyle override on the outer PreTag wins.

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

Out of scope: lowlight token-background pills inside `<DiffView>` (the
"Diff" view mode of `DiffPanel`). Those tokens are highlighted by
`@git-diff-view/lowlight` and styled via
`@git-diff-view/react/styles/diff-view.css` — a separate mechanism that
would need CSS overrides, not a prism-style transform. The `diffViewTheme`
prop IS in scope (one-line fix); the per-token lowlight CSS is not.
