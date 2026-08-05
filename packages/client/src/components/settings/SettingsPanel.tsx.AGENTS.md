# SettingsPanel.tsx — index

Settings UI: left-nav rail + page content (general/server/sessions/remote/security/providers/packages/plugins/openspec/developer/instructions). Unified-Save draft registry (`SettingsDraftProvider`), config/provider diff (`computeConfigPartial`), dirty-dot nav, unsaved-changes nav guards, restart via `useAsyncAction` (confirm:"ws"). Exports `SettingsPanel`. Display-prefs section adds `keepReasoningOpenUntilTurnEnds` ToggleField (disabled when `!reasoning`). See change: keep-reasoning-open-until-turn-ends. See change: enhance-tool-call-grouping — adds `toolGroupDefaultCollapsed` global ToggleField ("Keep tool groups collapsed by default").

## fix-popover-pane-bounded-height

- Mounts `PopoverBoundaryProvider value={settingsPaneRef}` so popovers inside the settings pages (e.g. the Default Model `ModelSelector`) measure the pane, not the viewport.
- The two `overflow-y-auto` elements are SIBLING ternary branches, not nested: the resource-grid branch (hosts no popover consumer) and the settings-pages pane (`p-4 space-y-6 max-w-3xl overflow-y-auto`, hosts `ModelSelector`). The ref attaches to the latter.
- Provider wraps all three branches but the ref attaches inside one; on the other branches `.current` is null → viewport fallback. A popover added to those branches must attach the ref to that branch's own pane.
