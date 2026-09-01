# Theme bridge

MUI's control plane is the **theme object**, not utility classes. Widgets read
all colour, typography and spacing from the active theme and carry **no literal
colour or spacing values** (a token-lint test enforces this). One form therefore
inherits any project's design system unchanged.

## Inheriting a host theme (preferred)

Render `OpenFormsMui` inside your app's `ThemeProvider` and pass **no** `theme`
prop — the component inherits the host theme:

```tsx
<ThemeProvider theme={appTheme}>
  <OpenFormsMui schema={schema} />
</ThemeProvider>
```

## Building a theme from design tokens

Map a DTCG `ui-contract.tokens.json` into a MUI theme and pass it explicitly:

```tsx
import { themeFromTokens } from "openforms-mui/theme";
import tokens from "./ui-contract.tokens.json";

<OpenFormsMui schema={schema} theme={themeFromTokens(tokens)} />
```

Recognised token paths (all optional; missing values fall back to the default
theme, so a partial file still yields a complete theme):

```jsonc
{
  "color": {
    "mode":      { "$value": "light" | "dark" },
    "primary":   { "$value": "#..." },
    "secondary": { "$value": "#..." },
    "error":     { "$value": "#..." },
    "warning":   { "$value": "#..." },
    "success":   { "$value": "#..." },
    "background": { "default": { "$value": "#..." }, "paper": { "$value": "#..." } },
    "text":      { "primary": { "$value": "#..." } }
  },
  "radius":  { "base": { "$value": 8 } },
  "font":    { "family": { "base": { "$value": "Roboto, ..." } } },
  "spacing": { "unit": { "$value": 8 } }
}
```

`themeFromTokensJson(string)` and `defaultTheme()` are also exported. When no
token file is present, `defaultTheme()` is the documented fallback.

## The approved token layer

`tools/mockups/tokens.css` is the reviewed design source, and
`tools/mockups/ui-contract.tokens.json` expresses the same values in DTCG form.
`src/theme/from-tokens.ts` ports them 1:1 into its default theme; a test
(`tests/a11y.test.ts` / `tests/theme.test.ts`) asserts the port has not drifted.
Keep the three in sync when changing a token.

## Fonts

The component bundles the **Roboto** webfont (400/500/700) via
`src/fonts.ts`, so typography does not silently fall back to a system face.
