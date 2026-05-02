## Context

Code blocks in the dashboard are rendered by `react-syntax-highlighter` (Prism
flavor) using prebuilt token-color palettes (`oneDark`, `oneLight`, `dracula`,
`nord`, `ghcolors`). These palettes are JS objects shaped like a CSS-in-JS
style sheet:

```ts
{
  'pre[class*="language-"]':  { color: '#abb2bf', background: '#282c34', ... },
  'code[class*="language-"]': { background: '#282c34', ... },
  '.token.comment':           { color: '#5c6370', fontStyle: 'italic' },
  '.token.deleted':           { color: '#e06c75', background: 'rgba(...)' },
  '.token.inserted':          { color: '#98c379', background: 'rgba(...)' },
  '.token.selector':          { color: '#d19a66', backgroundColor: '...'   },
  ...
}
```

Two sets of background declarations live in here:

1. **Wrapper backgrounds** — on `pre[class*="language-"]` and
   `code[class*="language-"]`. **Correction (post-implementation):** the
   dashboard's `customStyle.background = 'var(--bg-code)'` is applied only
   to the outer PreTag (a `<div>` in `MarkdownContent` due to
   `PreTag="div"`). The inner `<code class="language-xxx">` element is
   styled by react-syntax-highlighter from the prism style's
   `code[class*="language-"]` selector, which still carries the prism
   palette's stock panel color (`hsl(220, 13%, 18%)` for `oneDark`). That
   inner background paints _over_ the customStyle override on the outer
   div, so simple syntax-highlighted code blocks display the wrong panel
   background even after the token-strip lands.
2. **Token backgrounds** — on `.token.*` selectors. Designed to harmonize
   with the wrapper background that the prism style ships with. When the
   wrapper bg is overridden but the token bgs aren't, those pills render
   against an unrelated panel color and look like decoration noise.

The fix removes the second set entirely AND strips the inner-code wrapper
background (`code[class*="language-"]`) so the customStyle override on the
outer PreTag finally shows through. The outer `pre[class*="language-"]`
background is left intact as a safety-net default for any future caller
that does not pass `customStyle`.

## Goals

- Token characters render colored on the panel without their own background
  pills.
- Panel background continues to follow `var(--bg-code)` from the active theme.
- One central transform; every `<SyntaxHighlighter>` site inherits it.

## Non-Goals

- Replacing prebuilt prism styles with custom palettes.
- Overriding the lowlight token CSS inside `<DiffView>` from
  `@git-diff-view/react` — that's a different highlighter (lowlight) and a
  different styling system (CSS file from the library). Deferred.
- Removing token-level **foreground** colors (e.g. red text for
  `.token.deleted` inside ```diff fences). Only backgrounds go.
- Changing inline `<code>` styling (still uses `--bg-surface` pill).

## In Scope (DiffPanel theme integrity)

- DiffPanel's **File** view: migrate from raw `oneDark` to
  `getSyntaxTheme(theme, themeName)` so it inherits the strip and tracks
  the active theme.
- DiffPanel's **Diff** view: bind `<DiffView>`'s `diffViewTheme` prop
  (`"light" | "dark"`) to the resolved app theme instead of the hardcoded
  `"dark"`. The library reacts to `diffViewTheme` changes (effect deps
  include it) so the diff view re-renders on toggle without further work.

## Decisions

### Decision 1: Strip rule covers `.token*` AND the inner `code` wrapper

The clone-and-strip pass walks the cloned style object's keys. For each key
it deletes `background` and `backgroundColor` when EITHER:

1. The key contains the substring `".token"` (token-level fix), OR
2. The key matches the inner-code wrapper exactly:
   `code[class*="language-"]` (panel-bg fix).

Keys without `.token` and that are not the inner-code wrapper (i.e.
`pre[class*="language-"]`, `::selection`-style global rules, toolbar / line-
highlight / previewer rules) are left alone.

```ts
const INNER_CODE_KEY = 'code[class*="language-"]';

function stripTokenBackgrounds(style: SyntaxStyle): SyntaxStyle {
  const out: SyntaxStyle = {};
  for (const [selector, props] of Object.entries(style)) {
    const isToken = selector.includes(".token");
    const isInnerCode = selector === INNER_CODE_KEY;
    if (isToken || isInnerCode) {
      const { background, backgroundColor, ...rest } = props as Record<string, unknown>;
      out[selector] = rest as CSSProperties;
    } else {
      out[selector] = props;
    }
  }
  return out;
}
```

**Why selector-substring for tokens but exact-match for the inner code?** The
prism styles bundle ~30+ token selectors with various prefixes
(`code[class*="language-"] .token.string`). A substring match catches them
all without enumerating every Prism token class. The inner-code wrapper
is a single, well-defined selector — exact-match keeps the rule narrow and
avoids accidentally stripping background from other `code[...]` selectors
(toolbar / diff-highlight / previewer) that legitimately carry one.

**Why keep `pre[class*="language-"]` background?** Safety net for any
caller that omits `customStyle`. All four current call sites in the
dashboard pass `customStyle.background`, so this is theoretical — but
leaving it intact preserves the prism contract for any future caller and
costs nothing visually (the outer pre's background is hidden by the inner
code's solid bg before this fix; after this fix the inner code is
transparent and the outer customStyle wins).

**Why delete instead of overwrite to `transparent`?** Avoids accidentally
masking inherited values from neighboring selectors and keeps the style
object minimal — purer transformation.

### Decision 2: Apply the strip inside `getSyntaxTheme()`, not at every call site

`getSyntaxTheme()` is already the single point of truth for "give me the
prism style for the current app theme". Wrapping it with the strip means
every existing caller (`MarkdownContent`, `ReadToolRenderer`,
`WriteToolRenderer`) inherits the fix free, and any new caller does too as
long as it routes through this helper.

### Decision 3: DiffPanel "File" view migrates onto `getSyntaxTheme()`

DiffPanel currently imports `oneDark` directly and uses it unconditionally,
which (a) bypasses the new strip and (b) pins the diff file viewer to a
single palette regardless of active theme. The migration kills two birds:
the strip is applied AND the panel respects the active theme just like
chat/Read/Write code blocks already do.

### Decision 4: DiffPanel "Diff" view binds `diffViewTheme` to the app theme

`<DiffView>` from `@git-diff-view/react` accepts
`diffViewTheme?: "light" | "dark"` and reacts to changes (the library's
effect deps include the prop, so it re-themes on toggle). The current
`diffViewTheme="dark"` literal pins the diff view to dark even when the
user is in light mode. The fix:

```tsx
const { resolved: theme } = useThemeContext();
// ...
<DiffView
  ...
  diffViewTheme={theme === "light" ? "light" : "dark"}
  ...
/>
```

`useThemeContext().resolved` is already typed `"light" | "dark"`, so the
ternary is a defensive narrowing in case the type ever widens. The same
`theme` value is reused for `getSyntaxTheme(theme, themeName)` in
Decision 3, so we capture the hook once and feed both consumers.

### Decision 4: Diff color washes (`.token.deleted` / `.token.inserted`) go too

The user explicitly asked for these. Inside fenced ```diff blocks the red
and green washes are decorative — the leading `-` / `+` characters and
their token foreground colors already convey delete/insert. The panel-level
hunk highlighting in `<DiffView>` (the "Diff" mode of `DiffPanel`) is a
separate system and unaffected.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| A future prism style introduces a token selector that legitimately needs a background (e.g. function-call hover hint) | Re-evaluate per-style. The strip rule is centralized, so an opt-out token list can be added in one place if needed. |
| `react-syntax-highlighter` updates the shape of style objects (e.g. nested selectors) | Unit test pins the contract. CI catches regressions. |
| Cloning every style object on every render | The clone is shallow + the helper is called once per `MarkdownContent` render. Negligible. Memoization is possible but premature. |

## Migration Plan

Pure additive change. No data migration. No feature flag — the visual
difference is small (token pills disappear) and matches the user's intent.
Rollback is reverting the helper's transform body.

## Open Questions

None. Out-of-scope items (DiffView lowlight tokens, inline-code pill,
custom per-theme token palettes) are explicitly deferred and tracked in
`proposal.md` Impact / Out-of-scope.
