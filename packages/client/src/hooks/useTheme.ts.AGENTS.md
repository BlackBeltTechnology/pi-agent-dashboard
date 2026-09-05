# useTheme.ts — index

Theme mode + named-theme state. Reads `dashboard:theme`/`dashboard:theme-name` from `localStorage`, resolves system pref via `prefers-color-scheme`, applies `data-theme` attr + CSS var overrides. Listens for OS changes. Exports `useTheme`, `ThemeState`, `applyThemeVars`, `ThemePreference`, `ResolvedTheme`, `STORAGE_KEY`, `THEME_NAME_KEY`.
