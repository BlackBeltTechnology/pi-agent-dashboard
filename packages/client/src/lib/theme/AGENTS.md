# DOX — packages/client/src/lib/theme

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `context-gradient.ts` | Exports `contextGradientColor(percent)` — HSL interpolation green(0%)→yellow(50%)→red(100%) for context-usage bar. Clamps 0–100. |
| `monaco-theme.ts` | `buildMonacoTheme(themeName, resolved)` derives Monaco `IStandaloneThemeData` from `THEMES` token map. → see `monaco-theme.ts.AGENTS.md` |
| `syntax-theme.ts` | Single source of truth for prism syntax styles in client. → see `syntax-theme.ts.AGENTS.md` |
| `themes.ts` | Theme token definitions. CSS_VAR_KEYS includes --status-needs-you/working/idle/error/notice. → see `themes.ts.AGENTS.md` |
