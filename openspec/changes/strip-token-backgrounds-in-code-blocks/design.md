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
   `code[class*="language-"]`. The dashboard already overrides these via
   `customStyle.background = 'var(--bg-code)'` so the panel follows the active
   theme.
2. **Token backgrounds** — on `.token.*` selectors. Designed to harmonize
   with the wrapper background that the prism style ships with. When the
   wrapper bg is overridden but the token bgs aren't, those pills render
   against an unrelated panel color and look like decoration noise.

The fix removes the second set without touching the first.

## Goals

- Token characters render colored on the panel without their own background
  pills.
- Panel background continues to follow `var(--bg-code)` from the active theme.
- One central transform; every `<SyntaxHighlighter>` site inherits it.

## Non-Goals

- Replacing prebuilt prism styles with custom palettes.
- Touching `<DiffView>` from `@git-diff-view/react` — different highlighter
  (lowlight) and different styling system (CSS file). Deferred.
- Removing token-level **foreground** colors (e.g. red text for
  `.token.deleted` inside ```diff fences). Only backgrounds go.
- Changing inline `<code>` styling (still uses `--bg-surface` pill).

## Decisions

### Decision 1: Strip rule scoped to "any selector containing `.token`"

The clone-and-strip pass walks the cloned style object's keys. For each key
that contains the substring `".token"`, delete `background` and
`backgroundColor` from its value. Keys without `.token` (i.e. the two
wrapper selectors and `::selection`-style global rules) are left alone.

```ts
function stripTokenBackgrounds(style: SyntaxStyle): SyntaxStyle {
  const out: SyntaxStyle = {};
  for (const [selector, props] of Object.entries(style)) {
    if (selector.includes(".token")) {
      const { background, backgroundColor, ...rest } = props as Record<string, unknown>;
      out[selector] = rest as CSSProperties;
    } else {
      out[selector] = props;
    }
  }
  return out;
}
```

**Why selector-substring instead of an allowlist of token classes?** The
prism styles bundle ~30+ token selectors, sometimes with prefixes
(`code[class*="language-"] .token.string`). A substring match catches them
all without the maintenance burden of enumerating every Prism token class
that does or doesn't currently carry a background.

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
