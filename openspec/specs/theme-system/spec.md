# theme-system Specification

## Purpose

The CSS-custom-property foundation the themes are built on: theme variables, a three-state theme preference, persistence, and the toggle UI. Also carries the migration contract — components read CSS variables rather than hard-coded colours — and the specific contrast and inheritance rules that break otherwise: sidebar action button contrast, the syntax highlighter stripping token backgrounds, and the diff view inheriting the active syntax theme in both light and dark mode.
## Requirements
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

### Requirement: Accent tokens are declared for every theme
The client SHALL declare a complete accent ramp in `packages/client/src/index.css`
for both the default (dark) `:root` scope and the `[data-theme="light"]` scope.
The ramp SHALL comprise `--accent` (border / ring / focus), `--accent-soft`
(a soft fill painted behind `--text-primary`), `--accent-solid` (a solid fill
painted behind white text) and `--accent-text` (link text on a page background).

`--accent` and `--accent-soft` are currently referenced by component code but
declared nowhere, which is already a violation of "CSS custom properties for
theming". Declaring them SHALL make the existing `var(--accent-soft, …)` call
sites resolve to a theme-aware value instead of their hardcoded fallback.

Each token SHALL meet the contrast floor for the role it serves: `--accent-soft`
against `--text-primary` and `--accent-solid` against white SHALL meet 4.5:1;
`--accent-text` against `--bg-primary` SHALL meet 4.5:1; `--accent` used as a
non-text border or ring SHALL meet 3:1 against the adjacent surface.

#### Scenario: Accent ramp declared in both scopes
- **WHEN** `index.css` is inspected
- **THEN** `--accent`, `--accent-soft`, `--accent-solid` and `--accent-text` SHALL each be declared in `:root` AND in `[data-theme="light"]`

#### Scenario: Soft fill is legible in light mode
- **WHEN** a selected chip or a step action button paints `--accent-soft` behind `--text-primary` under `[data-theme="light"]`
- **THEN** the pair SHALL meet 4.5:1, replacing the 1.52:1 produced by the dark-navy fallback

#### Scenario: Soft fill is legible in dark mode
- **WHEN** the same surface paints `--accent-soft` behind `--text-primary` in the default dark scope
- **THEN** the pair SHALL meet 4.5:1

#### Scenario: Solid fill carries white text in both themes
- **WHEN** a primary action paints `--accent-solid` behind white text in either theme
- **THEN** the pair SHALL meet 4.5:1, because `--accent-primary` measures 3.68:1 against white in BOTH themes and is therefore not a valid solid fill for text

#### Scenario: Selected state is not the least readable element
- **WHEN** a provider or mode chip group is rendered with one chip selected
- **THEN** the selected chip's text SHALL meet a contrast ratio no lower than that of the unselected chips in the same group

### Requirement: Themed paints SHALL NOT rely on an inline fallback literal
A component SHALL NOT paint a themed color through a `var(--token, <literal>)`
fallback. A fallback literal is authored against exactly one theme, so when the
token is undeclared the literal is painted in EVERY theme while the text layered
on it stays theme-aware — the failure is invisible in the theme the literal was
authored for and severe in the other.

This is distinct from an undeclared property with no fallback, which resolves to
the empty string and yields an obviously unset paint. The fallback form fails
silently instead, which is why banning a single token in a single component
(as `shutdown-session-recovery` does for `--accent`) does not address the class.

Every custom property a component references for a color SHALL be declared in
the theme layer.

**The check SHALL be a ratchet, not a sweep — on both of its arms.** The client currently
contains 72 fallback-form color bindings across 19 files (client source, excluding tests),
plus further bindings in the bundled plugins, and separately references
several color properties that are undeclared today (`--border`, `--danger`, `--success`,
`--accent-fg`, `--bg-input`, `--border-focus`). A check that fails on either set fails on
the day it lands and forces exactly the repo-wide reflow this change declares out of scope.

Both the fallback-form rule and the undeclared-token rule SHALL therefore carry an
explicit, enumerated baseline of what exists when the check lands, and SHALL fail only on
a binding **added or modified** thereafter. Entries SHALL be removed from a baseline as
they are repaired; entries SHALL NOT be added. The accent tokens this change declares and
the bindings it repairs SHALL NOT appear in either baseline.

#### Scenario: No NEW fallback literal in a themed paint
- **WHEN** a binding using the `var(--token, #rrggbb)` fallback form for a background, border or text color is added or modified
- **AND** it is not in the recorded baseline
- **THEN** the check SHALL fail, naming the binding and its file

#### Scenario: The pre-existing baseline does not fail the build
- **GIVEN** the 72 fallback-form bindings that exist when the check lands are recorded in the baseline
- **WHEN** the check runs with no source change
- **THEN** it SHALL pass

#### Scenario: The baseline only shrinks
- **WHEN** a baselined binding is repaired and removed from the baseline
- **AND** a later change reintroduces a fallback-form binding at that site
- **THEN** the check SHALL fail

#### Scenario: A NEW undeclared token is caught before it ships
- **WHEN** a component adds or modifies a reference to a color custom property not declared in `index.css`
- **AND** that reference is not in the recorded baseline
- **THEN** the check SHALL fail, naming the property and the referencing file

#### Scenario: Pre-existing undeclared tokens do not fail the build
- **GIVEN** `--border`, `--danger`, `--success`, `--accent-fg`, `--bg-input` and `--border-focus` are referenced but undeclared when the check lands
- **WHEN** the check runs with no source change
- **THEN** it SHALL pass
- **AND** those references SHALL be enumerated in the baseline rather than silently ignored

#### Scenario: Declaring a token repaints its no-fallback references too
- **GIVEN** components reference `var(--accent)` with no fallback, which currently resolves to the empty string
- **WHEN** `--accent` becomes declared
- **THEN** every such reference SHALL be verified to render its intended paint, not merely the previously-unset one

#### Scenario: A solid accent fill under white text uses the solid token
- **GIVEN** a control paints a solid accent background with white text
- **WHEN** the accent ramp is declared
- **THEN** that control SHALL bind `--accent-solid`, NOT `--accent`
- **AND** white on it SHALL meet AA in **both** themes
- **AND** binding `--accent` there SHALL be treated as a defect, since `--accent` carries the 3:1 border/ring role and white on `#3b82f6` measures 3.68:1

#### Scenario: Declaring the token does not by itself clear cause C
- **GIVEN** the four sites reading `bg-[var(--accent,#3b82f6)] … text-white`
- **WHEN** `--accent` is declared and the inline literal removed
- **THEN** those sites SHALL still fail AA until repointed to `--accent-solid`
- **AND** the change SHALL repoint them

#### Scenario: Existing Gateway call sites resolve to theme values
- **WHEN** the Gateway dialog is rendered under `[data-theme="light"]`
- **THEN** the provider chips, mode chips, step action buttons, footer actions and the setup guide link SHALL each resolve their accent paint from a declared token, and each SHALL meet its role's contrast floor

