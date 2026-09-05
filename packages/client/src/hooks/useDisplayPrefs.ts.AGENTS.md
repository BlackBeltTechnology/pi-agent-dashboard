# useDisplayPrefs.ts — index

`useDisplayPrefs(sessionId?): DisplayPrefs` — reads context, returns `mergeDisplayPrefs(global, getSessionOverride(sessionId))`. Returns `DISPLAY_PRESETS.standard` when global undefined (pre-first-launch). See change: configurable-chat-display.
