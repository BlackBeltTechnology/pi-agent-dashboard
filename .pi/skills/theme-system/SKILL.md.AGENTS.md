# theme-system/SKILL.md — index

CSS custom properties theme architecture for 4 themes (studio default, earth, athlete, gradient) switched via `[data-theme="..."]` attribute. `lib/theme.ts`: `themes` const, `Theme` type, `defaultTheme='studio'`, `isValidTheme()` guard. `ThemeProvider` reads URL `?theme=` then localStorage, sets `data-theme` + syncs URL. `useTheme()` hook. `ThemeSwitcher` (dev-only). Preview via `?theme=<name>`. Gradient theme adds `--gradient-start`/`--gradient-end`.
