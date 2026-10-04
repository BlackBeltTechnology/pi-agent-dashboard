# theme-gallery Specification

## Purpose

Defines the selectable visual themes: the theme definitions themselves, runtime application, the picker UI, per-theme syntax highlighting, and persistence of the user's choice.

## Requirements

### Requirement: Theme definitions
The client SHALL define 9 named color themes, each with dark and light CSS variable maps: Base, Dracula, Nord, GitHub, Catppuccin, Tokyo Night, Rosé Pine, Solarized, and Gruvbox. Each theme definition SHALL include values for all CSS custom properties used by the application (`--bg-*`, `--text-*`, `--border-*`, `--accent-*`, `--shadow-*`, `--link`, `--link-hover`). The Base theme values SHALL match the existing `:root` and `[data-theme="light"]` CSS values exactly. Themes adapted from palettes that publish only a dark variant (e.g. Dracula) SHALL hand-tune accent colors for the light variant so contrast against light backgrounds remains readable; themes whose source publishes both variants (e.g. Tokyo Night Night/Day, Rosé Pine Main/Dawn, Solarized, Gruvbox) SHALL use the official light variant.

Body-text tokens SHALL additionally meet a measured contrast floor. `--text-tertiary` and `--text-secondary` SHALL each reach **WCAG 2.1 AA 4.5:1** against **both** `--bg-tertiary` (cards, inputs) and `--bg-surface` (badges, buttons) in **every** palette. These two tokens carry 10–11 px body text in the session card, so the AA-large 3:1 allowance does NOT apply.

Fidelity to an upstream palette SHALL NOT override the contrast floor. Where a published value (e.g. Dracula's comment colour `#6272a4`) fails, the theme SHALL adjust lightness while preserving hue and saturation, so the theme keeps its identity.

The text hierarchy SHALL be preserved after remediation: `--text-tertiary` SHALL NOT measure a higher contrast than `--text-secondary` against each background (`--bg-tertiary` and `--bg-surface`). Raising tertiary to the floor while leaving secondary below it inverts the hierarchy — the token meant to recede becomes the most legible — which is a regression even though both numbers improved.

#### Scenario: All themes define all variables
- **WHEN** a theme is loaded
- **THEN** it SHALL provide values for every CSS custom property used in the application

#### Scenario: Base theme matches existing CSS
- **WHEN** the Base theme is active
- **THEN** the rendered colors SHALL be identical to the current application appearance
- **AND** any remediated token value SHALL be applied to BOTH `themes.ts` and the `index.css` `:root` / `[data-theme="light"]` blocks, so the two sources cannot drift

#### Scenario: Theme dark/light variants
- **WHEN** any theme is selected
- **THEN** it SHALL have both a dark and light variant that the System/Light/Dark toggle can switch between

#### Scenario: Every palette meets the body-text contrast floor

- **GIVEN** all 18 palettes (9 themes × dark/light)
- **WHEN** contrast is computed for `--text-tertiary` and `--text-secondary` against `--bg-tertiary` and `--bg-surface`
- **THEN** every one of those ratios SHALL be ≥ 4.5:1
- **AND** a test SHALL fail if any palette regresses below the floor

#### Scenario: Hierarchy survives remediation

- **GIVEN** a palette whose `--text-tertiary` was raised to meet the floor
- **WHEN** both tokens are measured against each of `--bg-tertiary` and `--bg-surface`
- **THEN** `--text-secondary` SHALL measure at least as high as `--text-tertiary`
- **AND** a palette where lifting tertiary alone would invert the order SHALL have its `--text-secondary` lifted in the same change

#### Scenario: Remediation preserves theme identity

- **GIVEN** an upstream palette value that fails the floor
- **WHEN** it is remediated
- **THEN** the replacement SHALL preserve the original hue and saturation, adjusting lightness only
- **AND** SHALL NOT be replaced with a neutral grey

### Requirement: Theme application at runtime
The `useTheme` hook SHALL manage both theme name and mode preference. For the Base theme, CSS variables SHALL come from the stylesheet (no runtime overrides). For non-Base themes, the hook SHALL apply CSS variables to `document.documentElement.style`. When switching back to Base, all inline style overrides SHALL be removed.

#### Scenario: Switch to Dracula dark
- **WHEN** the user selects Dracula theme with dark mode
- **THEN** all CSS variables SHALL update to Dracula dark values and the UI SHALL re-render with the new colors

#### Scenario: Switch back to Base
- **WHEN** the user switches from a non-Base theme back to Base
- **THEN** all inline CSS variable overrides SHALL be removed and the stylesheet defaults SHALL apply

#### Scenario: Theme persisted across reload
- **WHEN** the user selects Nord theme and reloads the page
- **THEN** the Nord theme SHALL be restored from localStorage

#### Scenario: Mode toggle within theme
- **WHEN** the user is on Catppuccin dark and toggles to light mode
- **THEN** the CSS variables SHALL update to Catppuccin light values

### Requirement: Theme picker UI
The client SHALL display a theme picker dropdown in the sidebar header area, alongside the existing System/Light/Dark toggle. The dropdown SHALL show each theme name with a color swatch preview (small circles showing the theme's primary background and accent colors). The currently selected theme SHALL have a visual indicator (checkmark).

#### Scenario: Open theme picker
- **WHEN** the user clicks the theme picker button (palette icon)
- **THEN** a dropdown SHALL appear listing all available themes with color swatches

#### Scenario: Select theme
- **WHEN** the user clicks a theme in the dropdown
- **THEN** the theme SHALL be applied immediately and the dropdown SHALL close

#### Scenario: Current theme indicated
- **WHEN** the theme picker dropdown is open
- **THEN** the currently active theme SHALL show a checkmark or highlight

#### Scenario: Close dropdown
- **WHEN** the user clicks outside the theme picker dropdown
- **THEN** the dropdown SHALL close

### Requirement: Syntax highlighting per theme
Each theme SHALL map to an appropriate syntax highlighting style from `react-syntax-highlighter` for code blocks. The `getSyntaxTheme` function SHALL accept both the resolved mode and the theme name to return the correct highlighter style.

#### Scenario: Dracula theme code blocks
- **WHEN** the Dracula theme is active in dark mode
- **THEN** code blocks SHALL use the Dracula syntax highlighting style

#### Scenario: GitHub theme code blocks
- **WHEN** the GitHub theme is active
- **THEN** code blocks SHALL use the GitHub Colors syntax highlighting style

#### Scenario: Fallback for unmapped themes
- **WHEN** a theme has no exact syntax highlighter match
- **THEN** code blocks SHALL fall back to `oneDark` (dark) or `oneLight` (light)

#### Scenario: Solarized and Gruvbox dual-mode syntax
- **WHEN** Solarized or Gruvbox is active
- **THEN** code blocks SHALL use the matching dual-mode prism style (`solarizedDarkAtom` / `solarizedlight` and `gruvboxDark` / `gruvboxLight` respectively) so the syntax palette tracks the chosen mode

#### Scenario: Tokyo Night dark syntax
- **WHEN** Tokyo Night is active in dark mode
- **THEN** code blocks SHALL use the `nightOwl` prism style as the closest available match

### Requirement: Theme state persistence
The selected theme name SHALL be stored in `localStorage` under `dashboard:theme-name`. The default theme SHALL be `"base"`. The theme name and mode preference SHALL be independent settings.

#### Scenario: Default theme on first visit
- **WHEN** no theme has been previously selected
- **THEN** the Base theme SHALL be active

#### Scenario: Independent mode and theme persistence
- **WHEN** the user selects Nord theme and dark mode, then changes to light mode
- **THEN** the theme SHALL remain Nord and only the mode SHALL change

### Requirement: On-surface accent text ramp
Every palette (9 themes × dark/light = 18) SHALL define an on-surface text accent ramp of six tokens: `--accent-purple-text`, `--accent-blue-text`, `--accent-green-text`, `--accent-orange-text`, `--accent-red-text` and `--accent-yellow-text`. The ramp SHALL be part of the set of CSS custom properties every theme defines, and the Base palette's values SHALL be mirrored per mode: Base dark's in `index.css` `:root` and Base light's in `[data-theme="light"]`, each identical to its `themes.ts` counterpart for that mode.

The token name SHALL encode the role contract:
- `--accent-<hue>` is a fill / decoration token (status dots, borders, chart series, diagram strokes). It carries **no** contrast guarantee as text.
- `--accent-<hue>-text` is the token for coloured text. Each SHALL reach **WCAG 2.1 AA 4.5:1** against every one of its palette's four text backdrops: `--bg-surface`, `--bg-tertiary`, `--bg-primary`, and the card fill `color-mix(in srgb, var(--bg-secondary), var(--bg-tertiary))`.

This ramp is separate from the theme-invariant link token `--accent-text`, which `theme-system` owns and guarantees only against `--bg-primary`. The two SHALL NOT be treated as interchangeable.

An absolute AA floor is achievable here, unlike for the derived `--tint-*` / `--severity-*` tokens in `message-severity-tokens`, because each value is a literal chosen per palette rather than a fixed `color-mix` recipe.

Each `--accent-<hue>-text` value SHALL derive from the same palette's `--accent-<hue>` by adjusting **lightness only**, preserving hue and saturation, as for the body-text remediation in "Theme definitions". Where the source accent already meets the floor on all four backdrops, the text token SHALL equal the source accent unchanged.

Adding the ramp SHALL NOT change any existing `--accent-<hue>` value, so no shipped surface repaints.

#### Scenario: Every palette defines the full ramp
- **GIVEN** any of the 18 palettes
- **WHEN** its token map is inspected
- **THEN** all six `--accent-<hue>-text` tokens SHALL be present as opaque `#rrggbb` values

#### Scenario: Every accent-text token meets AA on every text backdrop
- **GIVEN** all 18 palettes and all six hues (108 tokens)
- **WHEN** each `--accent-<hue>-text` is measured against that palette's `--bg-surface`, `--bg-tertiary`, `--bg-primary` and card fill
- **THEN** every ratio SHALL be ≥ 4.5:1
- **AND** a test SHALL fail if any palette regresses below the floor

#### Scenario: Default palette purple is legible as text
- **GIVEN** the Base dark palette, whose `--accent-purple` `#a855f7` measures 3.63:1 on `--bg-surface`
- **WHEN** `--accent-purple-text` is measured on `--bg-surface`
- **THEN** it SHALL measure ≥ 4.5:1

#### Scenario: Remediation preserves hue and saturation
- **GIVEN** a palette's `--accent-<hue>` and its `--accent-<hue>-text`
- **WHEN** both are compared
- **THEN** the text token SHALL keep the source's hue and saturation within the tolerance used for the body-text tokens
- **AND** SHALL NOT be replaced by a neutral grey or by `--text-primary`

#### Scenario: Already-passing accents are adopted unchanged
- **GIVEN** a source `--accent-<hue>` that already meets 4.5:1 on all four backdrops of its palette
- **WHEN** the ramp is defined
- **THEN** `--accent-<hue>-text` SHALL equal `--accent-<hue>` exactly

#### Scenario: Base palette sources cannot drift
- **WHEN** the Base dark and light palettes are compared between `themes.ts` and `index.css`
- **THEN** each of the six `--accent-<hue>-text` tokens SHALL be declared explicitly in both `:root` and `[data-theme="light"]`, with no reliance on inheritance from `:root`
- **AND** each `:root` value SHALL equal `themes.ts` Base dark, and each `[data-theme="light"]` value SHALL equal `themes.ts` Base light
- **AND** each source `--accent-<hue>` value that Base light inherits from `:root` SHALL equal the `themes.ts` Base light value

#### Scenario: Source accents are untouched
- **WHEN** the change that adds the ramp is diffed
- **THEN** no `--accent-<hue>` value in any palette SHALL differ from its value before the change

### Requirement: Accent-text hue is a secondary cue
Hue in the `--accent-<hue>-text` ramp SHALL be treated as a secondary cue only. A surface that adopts an accent-text token SHALL carry its meaning in a word, icon or shape as well, so the meaning survives if two hues look alike. Each adopting change is responsible for showing this for its own surface.

The ramp SHALL NOT guarantee that its six hues can be told apart from each other in every palette. Lightness-only remediation against a mid-luminance surface pushes several hues toward the same near-white or near-black. Solarized dark is the recorded case: its `--bg-surface` (`#586e75`) forces orange, red, blue and purple to near-white pastels that are legible but hard to tell apart. This SHALL be recorded as an accepted, known identity loss, consistent with the Solarized body-text precedent. It SHALL NOT be fixed by exempting Solarized from the AA floor or by breaking the lightness-only rule.

"Hard to tell apart" is defined as: the minimum pairwise CIE76 ΔE between a palette's six `--accent-<hue>-text` values is below 8.

#### Scenario: Known-indistinguishable palettes are recorded, not hidden
- **GIVEN** the accent-text contrast test
- **WHEN** it runs
- **THEN** it SHALL hold an explicit list of palettes whose accent-text hues are hard to tell apart, containing `solarized:dark`
- **AND** each listed palette SHALL still pass the AA floor and the hue/saturation-preservation checks

#### Scenario: The recorded list cannot go stale silently
- **GIVEN** a palette on the known-indistinguishable list
- **WHEN** its minimum pairwise ΔE rises to 8 or above
- **THEN** the test SHALL fail, prompting removal of the palette from the list

#### Scenario: A new collision is caught
- **GIVEN** a palette not on the known-indistinguishable list
- **WHEN** its minimum pairwise ΔE falls below 8
- **THEN** the test SHALL fail, naming the palette and the closest hue pair
