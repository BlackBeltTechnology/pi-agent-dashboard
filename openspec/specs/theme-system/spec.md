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

### Requirement: Readable text on aligned action surfaces
On the surfaces listed in `message-severity-tokens` "No raw colour literals on aligned action surfaces", section headings, field labels, help text and status words SHALL use `--text-primary` or `--text-secondary` and SHALL measure at least 4.5:1 against their composited background in the default dark and light themes, and at least 3:1 in every named theme. `--text-muted` SHALL be used only in disabled-state variants and on elements hidden from assistive technology (`aria-hidden="true"`). No text SHALL be smaller than 11 px; button, link, label and help text SHALL be at least 12 px.

#### Scenario: Worktree dialog headings readable in light theme
- **WHEN** the worktree dialog opens in the light theme
- **THEN** "Existing worktrees of this repo" and "Create a new worktree" SHALL measure at least 4.5:1 and render at least 12 px

#### Scenario: Automation help text readable
- **WHEN** the automation dialog shows next-run, file-path help or locked-name text
- **THEN** the text SHALL use `--text-secondary`, render at least 12 px and measure at least 4.5:1 in the default dark and light themes

### Requirement: Status colour on shape, not text
Session status colours (`--status-*`) SHALL be applied to status shapes or dots only. Status words (for example "Resuming…", "idle") SHALL render in `--text-secondary` next to the coloured shape.

#### Scenario: Resuming label
- **WHEN** a session card shows the resuming state
- **THEN** a status shape in `--status-working` SHALL precede the word "Resuming…", and the word SHALL use `--text-secondary`

### Requirement: Primary action recipe
Primary actions on the aligned surfaces SHALL render white text on `--accent-solid`, and when disabled SHALL render `--text-secondary` on `--bg-tertiary`. `--accent-solid` is theme-invariant (not part of the per-theme variable set), so primary actions keep the same blue under every named theme.

#### Scenario: Worktree create button
- **WHEN** the worktree dialog's "Create +Session →" button is enabled
- **THEN** it SHALL use `--accent-solid` with white text, measuring at least 4.5:1 in every theme

### Requirement: Target size and focus on aligned action surfaces
Every button on the aligned surfaces SHALL be at least 44×44 px below the `sm` breakpoint and at least 32 px tall from `sm` upward, and SHALL show a visible focus indicator (`focus-ring`) when focused by keyboard.

#### Scenario: Worktree source toggle target
- **WHEN** the worktree dialog renders at 375 px wide
- **THEN** each source toggle button SHALL be at least 44×44 px, and at 1280 px at least 32 px tall

#### Scenario: Goal controls target and focus
- **WHEN** the goal detail page renders at 375 px and the user tabs through the loop controls
- **THEN** each control SHALL be at least 44×44 px and SHALL show the focus ring when focused

### Requirement: Fill accents SHALL NOT be added as text paint
A component SHALL NOT add a text paint that uses a fill / decoration accent `--accent-<hue>` (`<hue>` ∈ purple, blue, green, orange, red, yellow). Coloured text SHALL use the matching `--accent-<hue>-text` token defined per palette by `theme-gallery` "On-surface accent text ramp", which is the only accent family with a text-contrast guarantee on every palette.

A text paint is:
- a Tailwind arbitrary text-colour class `text-[var(--accent-<hue>)]`, including opacity-modified forms such as `text-[var(--accent-<hue>)]/80`;
- an inline style or CSS declaration of `color` whose value is `var(--accent-<hue>)`, in a component source file or a stylesheet under the guard's scanned roots.

Fills, borders, rings, dots, strokes and `background` / `border-color` / `fill` / `stroke` paints are NOT text paints and SHALL NOT be flagged.

A text-colour class can also colour a non-text graphic through `currentColor` (an icon glyph), where a fill accent is correct (WCAG 1.4.11, 3:1). Syntax cannot tell the two apart. So the guard SHALL carry an enumerated **non-text-paint file allowlist**, whose files are skipped by this arm only. Each entry SHALL carry a written justification. The allowlist SHALL initially contain exactly `packages/client/src/lib/preview/file-icon.ts`, whose icon-colour classes are mandated by `file-extension-icon-lookup`. Icon uses elsewhere SHALL stay in the baseline rather than be allowlisted.

Text paints that exist when this rule lands are grandfathered as baselined debt. That includes paints an existing requirement mandates: `tool-renderers` "DiffView component" names `var(--accent-green|red|blue)` as diff-line text. Such a site SHALL stay baselined until a change migrates it, and that change SHALL carry a MODIFIED delta to the mandating requirement in the same change, so the spec and the code move together.

**The check SHALL be a ratchet, not a sweep**, as a third arm of the same theme-token guard that carries the fallback-form and undeclared-token arms. It scans the same source roots, excludes test files in the same way, counts occurrences per `<file>::<token>` site, and carries an enumerated baseline of the text paints that exist when it lands (about 57 sites under the scanned roots, excluding the allowlisted file). It SHALL fail only on a text paint **added** after that, or on a baselined site whose occurrence count grows. Entries SHALL be removed from the baseline as surfaces adopt `--accent-<hue>-text`. Entries SHALL NOT be added, and the baseline writer SHALL refuse to grow this arm exactly as it refuses for the other two.

#### Scenario: A new fill-accent text paint fails
- **WHEN** a component adds `text-[var(--accent-red)]` at a site absent from the accent-as-text baseline
- **THEN** the guard SHALL fail, naming the token and the file

#### Scenario: A baselined site cannot grow
- **GIVEN** a file baselined with N occurrences of `--accent-blue` as text paint
- **WHEN** an (N+1)th occurrence is added to that file
- **THEN** the guard SHALL fail

#### Scenario: A spec-mandated legacy text paint stays baselined
- **GIVEN** `DiffView`'s `text-[var(--accent-green)]` / `--accent-red` / `--accent-blue` diff-line paints, mandated by `tool-renderers`
- **WHEN** the accent-as-text arm lands
- **THEN** those sites SHALL appear in the arm's baseline
- **AND** the guard SHALL pass with no change to `DiffView`

#### Scenario: The pre-existing text paints do not fail the build
- **GIVEN** the fill-accent text paints that exist when the arm lands are recorded in its baseline
- **WHEN** the guard runs with no source change
- **THEN** it SHALL pass

#### Scenario: Adopting the text ramp is not flagged
- **WHEN** a component paints text with `text-[var(--accent-purple-text)]` or `color: var(--accent-purple-text)`
- **THEN** the accent-as-text arm SHALL NOT record it

#### Scenario: Non-text accent paints are not flagged
- **WHEN** a component uses `bg-[var(--accent-green)]`, `border-[var(--accent-green)]`, `fill: var(--accent-green)` or `stroke: var(--accent-green)`
- **THEN** the accent-as-text arm SHALL NOT record it

#### Scenario: Icon descriptors mandated by file-extension-icon-lookup do not fail
- **WHEN** a new extension mapping with `text-[var(--accent-yellow)]` is added to `packages/client/src/lib/preview/file-icon.ts`
- **THEN** the accent-as-text arm SHALL NOT record it
- **AND** the fallback-form and undeclared-token arms SHALL still scan that file

#### Scenario: The allowlist is explicit
- **WHEN** the guard's non-text-paint allowlist is inspected
- **THEN** every entry SHALL be an exact repo-relative file path with a justification, never a directory or glob

#### Scenario: A repaired site is shrinkable and cannot regress
- **WHEN** a baselined site is migrated to `--accent-<hue>-text`
- **THEN** the guard SHALL report it as a shrinkable repair rather than failing
- **AND** after the baseline is shrunk, reintroducing the fill-accent text paint at that site SHALL fail
