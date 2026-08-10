# DisplayPrefsContext.tsx — index

React context exposing `{ global: DisplayPrefs|undefined, getSessionOverride(id): Partial<DisplayPrefs>|undefined, setDisplayPrefs(next) }`. Hydrated by `App.tsx` from `/api/preferences/display`; updated by `display_prefs_updated` WS arm. See change: configurable-chat-display.
