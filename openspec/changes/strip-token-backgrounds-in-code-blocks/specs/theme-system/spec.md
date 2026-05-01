## ADDED Requirements

### Requirement: Syntax highlighter strips token backgrounds
Prism styles returned by `getSyntaxTheme()` SHALL have `background` and
`backgroundColor` properties removed from every selector that targets
Prism tokens (selectors containing `.token`). Wrapper selectors
(`pre[class*="language-"]`, `code[class*="language-"]`) SHALL be left
untouched so the dashboard's `customStyle.background = 'var(--bg-code)'`
override continues to drive the code panel background.

#### Scenario: Token foreground colors preserved
- **WHEN** the syntax theme returned by `getSyntaxTheme()` is inspected
- **THEN** every selector containing `.token` retains its `color` property
- **AND** every such selector has no `background` or `backgroundColor` property

#### Scenario: Wrapper background untouched
- **WHEN** the syntax theme returned by `getSyntaxTheme()` is inspected
- **THEN** `pre[class*="language-"]` retains the prism style's original
  `background` property (so it can be overridden by `customStyle`, not stripped)

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
