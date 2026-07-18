# DOX — packages/client/src/components/settings

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `CanvasTypesSettingsSection.tsx` | Canvas-type registry settings: 8 per-kind checkboxes + global/project scope switch. Toggle PATCHes the full 8-key map for the scope then refreshes. Project scope needs a session cwd (disabled with hint when none). See change: auto-canvas. |
| `DiagnosticsSection.tsx` | Settings → Diagnostics. Fetches `/api/doctor`. Groups by section in fixed order, omits empty sections (no n/a… → see `DiagnosticsSection.tsx.AGENTS.md` |
| `FirstLaunchDisplayModal.tsx` | One-shot preset picker (simple / standard / everything) shown when `/api/preferences/display.global ===… → see `FirstLaunchDisplayModal.tsx.AGENTS.md` |
| `ModelProxySection.tsx` | Settings panel section for model proxy. Exports `ModelProxySection`, `ModelProxyConfig`. → see `ModelProxySection.tsx.AGENTS.md` |
| `ModelSelector.tsx` | Variant C: grouped by provider, pinned ★ Favorites group, per-row star toggle, capability badges (🧠/👁… → see `ModelSelector.tsx.AGENTS.md` |
| `ProviderAuthSection.tsx` | Settings section for LLM provider auth. Exports `ProviderAuthSection`. → see `ProviderAuthSection.tsx.AGENTS.md` |
| `SettingsPanel.tsx` | Settings UI: left-nav rail + page content… → see `SettingsPanel.tsx.AGENTS.md` |
| `ThemePicker.tsx` | Palette dropdown for theme selection. Lists `THEMES` with color swatches, flip-aware (`usePopoverFlip`), outside-click close. Reads/writes `useThemeContext`. Exports `ThemePicker`. |
| `ThemeProvider.tsx` | React context provider wrapping `useTheme` hook. Exports `ThemeProvider`, `useThemeContext` (throws outside provider). |
| `ThemeToggle.tsx` | Exports `ThemeToggle`. Three-button light/system/dark switcher; reads `preference`/`setPreference` from `useThemeContext`. Renders mdi icons, `data-testid="theme-toggle"`. |
| `ThinkingLevelSelector.tsx` | Thinking-level picker. Optional prop `supportedLevels` filters `THINKING_LEVELS` to supported set (canonical… → see `ThinkingLevelSelector.tsx.AGENTS.md` |
| `ToolsSection.tsx` | Settings → General → **Tools** section. One row per registered tool: status badge, source, truncated path,… → see `ToolsSection.tsx.AGENTS.md` |
