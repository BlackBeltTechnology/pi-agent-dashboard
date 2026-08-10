# chat-display-preferences.md — index

`DisplayPrefs` gate chat chrome (thinking, tool cards, results, separators, stats bars). Global `~/.pi/dashboard/preferences.json#displayPrefs`; per-session sparse override `.meta.json#displayPrefsOverride`; `mergeDisplayPrefs` deep-merges. Transport REST + WS `display_prefs_updated`. `ask_user` always renders. First-launch preset modal. See change: configurable-chat-display.
