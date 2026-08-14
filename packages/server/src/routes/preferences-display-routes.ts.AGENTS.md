# preferences-display-routes.ts — index

REST routes `GET /api/preferences/display` (returns `{ global: DisplayPrefs|undefined, sessionOverrides: Record<sessionId, Partial<DisplayPrefs>> }`) + `PATCH /api/preferences/display` (deep-merges `toolCalls` via `preferences-store.setDisplayPrefs`, broadcasts `display_prefs_updated`). Auth-gated. See change: configurable-chat-display.
