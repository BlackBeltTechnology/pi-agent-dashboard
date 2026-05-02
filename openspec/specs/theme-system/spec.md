## ADDED Requirements

### Requirement: CSS custom properties for theming
The dashboard SHALL define CSS custom properties on `:root` for all color values used across components. Dark values SHALL be the default. Light values SHALL be defined under `[data-theme="light"]`.

#### Scenario: Dark mode colors applied by default
- **WHEN** no `data-theme` attribute is set on `<html>`
- **THEN** all components use dark palette colors via CSS variables

#### Scenario: Light mode colors applied
- **WHEN** `data-theme="light"` is set on `<html>`
- **THEN** all components use light palette colors via CSS variables

### Requirement: Three-state theme preference
The dashboard SHALL support three theme preferences: System, Light, and Dark.

#### Scenario: System mode follows OS preference
- **WHEN** theme is set to "system" and OS is in light mode
- **THEN** the dashboard uses light theme

#### Scenario: System mode follows OS dark preference
- **WHEN** theme is set to "system" and OS is in dark mode
- **THEN** the dashboard uses dark theme

#### Scenario: Light mode override
- **WHEN** theme is set to "light"
- **THEN** the dashboard uses light theme regardless of OS preference

#### Scenario: Dark mode override
- **WHEN** theme is set to "dark"
- **THEN** the dashboard uses dark theme regardless of OS preference

### Requirement: Theme persistence
The theme preference SHALL be persisted to `localStorage` and restored on page reload.

#### Scenario: Preference persisted
- **WHEN** user selects "light" theme and reloads the page
- **THEN** the dashboard loads in light theme

#### Scenario: Default preference
- **WHEN** no preference is stored in localStorage
- **THEN** the dashboard defaults to "system" mode

### Requirement: Theme toggle UI
A three-state toggle (System / Light / Dark) SHALL be displayed in the session list header area.

#### Scenario: Toggle changes theme
- **WHEN** user clicks the Light option in the toggle
- **THEN** the theme switches to light mode immediately

### Requirement: Component migration to CSS variables
All hardcoded Tailwind color classes in client components SHALL be replaced with CSS variable references. Syntax-highlighted code blocks SHALL use `var(--bg-code)` as their background color, overriding the syntax theme's embedded background.

#### Scenario: No hardcoded dark-only colors remain
- **WHEN** any component renders
- **THEN** it uses `var(--*)` CSS variables for backgrounds, text, and borders instead of hardcoded gray/black classes

#### Scenario: Syntax highlighter background matches theme
- **WHEN** a syntax-highlighted code block renders under any named theme
- **THEN** the code block background SHALL be `var(--bg-code)` from the active theme, not the syntax theme's embedded background color

### Requirement: Sidebar action button contrast
Sidebar action button icons (Pin directory, Install PWA, Tunnel, Settings) SHALL use `--text-tertiary` for their default color and `--text-secondary` for their hover color, ensuring a minimum WCAG AA non-text contrast ratio of 3:1 against the sidebar background in both light and dark themes.

#### Scenario: Light mode icon visibility
- **WHEN** the theme is light and the sidebar renders action buttons
- **THEN** each icon has a contrast ratio of at least 3:1 against `--bg-primary`

#### Scenario: Dark mode icon visibility
- **WHEN** the theme is dark and the sidebar renders action buttons
- **THEN** each icon has a contrast ratio of at least 3:1 against `--bg-primary`

#### Scenario: Hover state contrast
- **WHEN** the user hovers over a sidebar action button in any theme
- **THEN** the icon color changes to `--text-secondary`

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
