## ADDED Requirements

### Requirement: Theme definitions
The client SHALL define 9 named color themes, each with dark and light CSS variable maps: Base, Dracula, Nord, GitHub, Catppuccin, Tokyo Night, Rosé Pine, Solarized, and Gruvbox. Each theme definition SHALL include values for all CSS custom properties used by the application (`--bg-*`, `--text-*`, `--border-*`, `--accent-*`, `--shadow-*`, `--link`, `--link-hover`). The Base theme values SHALL match the existing `:root` and `[data-theme="light"]` CSS values exactly. Themes adapted from palettes that publish only a dark variant (e.g. Dracula) SHALL hand-tune accent colors for the light variant so contrast against light backgrounds remains readable; themes whose source publishes both variants (e.g. Tokyo Night Night/Day, Rosé Pine Main/Dawn, Solarized, Gruvbox) SHALL use the official light variant.

#### Scenario: All themes define all variables
- **WHEN** a theme is loaded
- **THEN** it SHALL provide values for every CSS custom property used in the application

#### Scenario: Base theme matches existing CSS
- **WHEN** the Base theme is active
- **THEN** the rendered colors SHALL be identical to the current application appearance

#### Scenario: Theme dark/light variants
- **WHEN** any theme is selected
- **THEN** it SHALL have both a dark and light variant that the System/Light/Dark toggle can switch between

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
