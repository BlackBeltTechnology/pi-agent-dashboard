## ADDED Requirements

### Requirement: Syntax highlighter strips token backgrounds
Prism styles returned by `getSyntaxTheme()` SHALL have `background` and
`backgroundColor` properties removed from every selector that targets
Prism tokens (selectors containing `.token`). Additionally, the inner
`code[class*="language-"]` wrapper selector SHALL also be stripped so
that the dashboard's `customStyle.background = 'var(--bg-code)'` (applied
only to the outer PreTag) is no longer obscured by the prism palette's
stock inner-code background. The outer `pre[class*="language-"]` wrapper
background SHALL be left intact as a safety-net default for callers that
do not pass a `customStyle` override.

#### Scenario: Token foreground colors preserved
- **WHEN** the syntax theme returned by `getSyntaxTheme()` is inspected
- **THEN** every selector containing `.token` retains its `color` property
- **AND** every such selector has no `background` or `backgroundColor` property

#### Scenario: Outer pre wrapper background untouched
- **WHEN** the syntax theme returned by `getSyntaxTheme()` is inspected
- **THEN** `pre[class*="language-"]` retains the prism style's original
  `background` property (so it remains the safety-net default for callers
  that do not pass `customStyle`)

#### Scenario: Inner code wrapper background stripped
- **WHEN** the syntax theme returned by `getSyntaxTheme()` is inspected
- **THEN** `code[class*="language-"]` has no `background` or
  `backgroundColor` property
- **AND** any caller that wraps `<SyntaxHighlighter>` and passes
  `customStyle={{ background: 'var(--bg-code)' }}` to the outer PreTag
  SHALL see the customStyle background paint behind every token (the
  inner `<code>` is now transparent and does not paint over it)

#### Scenario: Diff token washes stripped
- **WHEN** the syntax theme returned by `getSyntaxTheme()` is inspected
  for any active theme
- **THEN** `.token.deleted` and `.token.inserted` have no `background` or
  `backgroundColor` property

#### Scenario: Code characters render without per-character backgrounds
- **WHEN** a fenced code block ```ts containing a string literal, a
  comment, and a keyword is rendered in chat under any active theme
- **THEN** none of the tokens display a colored background pill behind
  their characters
- **AND** the surrounding `--bg-code` panel remains visible behind every
  token

### Requirement: Diff file view inherits active syntax theme
The "File" view of `DiffPanel` SHALL render code using the prism style
returned by `getSyntaxTheme(resolved, themeName)` for the active theme,
not a hardcoded `oneDark` import. This is required so the token-background
strip applies to the file-content viewer and so the file viewer's token
colors track theme switches like chat code blocks already do.

#### Scenario: File view tracks theme switch
- **WHEN** the active theme changes from "base" dark to "dracula" dark
  while a `DiffPanel` is open in "File" view mode
- **THEN** the rendered code re-renders with the dracula prism palette
  (or the dracula theme's configured `syntaxDark` switch)

#### Scenario: File view tokens have no background pills
- **WHEN** a file is rendered in `DiffPanel`'s "File" view under any
  active theme
- **THEN** no token character displays a colored background pill

### Requirement: Diff view tracks light and dark mode
The `diffViewTheme` prop passed to `<DiffView>` SHALL be derived from the active app theme and SHALL NOT be hardcoded. When the resolved theme is `"light"` the prop SHALL be `"light"`; otherwise the prop SHALL be `"dark"`.

#### Scenario: Switching to light mode re-themes the diff view
- **WHEN** a `DiffPanel` is open in "Diff" view mode under a dark theme
- **AND** the user switches the app theme to light
- **THEN** the `<DiffView>` re-renders with `diffViewTheme="light"` and
  the panel chrome (background, gutter, hunk headers) follows the
  library's light palette

#### Scenario: Switching to dark mode re-themes the diff view
- **WHEN** a `DiffPanel` is open in "Diff" view mode under a light theme
- **AND** the user switches the app theme to dark
- **THEN** the `<DiffView>` re-renders with `diffViewTheme="dark"`
