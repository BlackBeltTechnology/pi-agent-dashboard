# display-prefs.ts — index

`DisplayPrefs` interface gates chat-view chrome (thinking, tool calls per kind, turn separators, debug tools,… → see `display-prefs.ts.AGENTS.md` `customEventGroups: Record<string, boolean>` replaces `customEntryFallback` (shallow field-by-field merge via `mergeCustomEventGroupPrefs`, same as `toolCalls`); presets seed shipped defaults. `migrateLegacyCustomEntryFallback` one-shot: legacy `false` seeds EVERY shipped group hidden + `other`; legacy `true` forces no keys; corrupt value dropped. See changes: render-inline-reasoning-and-custom-entries, add-custom-event-group-filters.

`chatMotion: boolean` (default `true` in all three presets; field-by-field in `mergeDisplayPrefs`) gates arrival-driven chat motion. Effective motion also needs no `prefers-reduced-motion` and a visible document (`useChatMotion`). See change: add-fluid-chat-motion.
