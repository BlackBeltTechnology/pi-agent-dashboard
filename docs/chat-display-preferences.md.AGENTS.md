# chat-display-preferences.md — index

`DisplayPrefs` gates chat chrome: thinking, tool cards, results, separators, stats bars, notify rows by level. Global `~/.pi/dashboard/preferences.json#displayPrefs`; per-session sparse override `.meta.json#displayPrefsOverride`; `mergeDisplayPrefs` deep-merges. Transport REST + WS `display_prefs_updated`. Blocking asks always render. Notify rows gated by `notifyMinLevel`, default `all`. First-launch preset modal. See change: configurable-chat-display, gate-notify-rows-by-level.
