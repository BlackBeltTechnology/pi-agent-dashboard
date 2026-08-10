# SettingsPanel.tsx — index

Settings UI: left-nav rail + page content (general/server/sessions/remote/security/providers/packages/plugins/openspec/developer/instructions). Unified-Save draft registry (`SettingsDraftProvider`), config/provider diff (`computeConfigPartial`), dirty-dot nav, unsaved-changes nav guards, restart via `useAsyncAction` (confirm:"ws"). Exports `SettingsPanel`. Display-prefs section adds `keepReasoningOpenUntilTurnEnds` ToggleField (disabled when `!reasoning`). See change: keep-reasoning-open-until-turn-ends. See change: enhance-tool-call-grouping — adds `toolGroupDefaultCollapsed` global ToggleField ("Keep tool groups collapsed by default").

## fix-popover-pane-bounded-height

- Mounts `PopoverBoundaryProvider value={settingsPaneRef}` so popovers inside the settings pages (e.g. the Default Model `ModelSelector`) measure the pane, not the viewport.
- The two `overflow-y-auto` elements are SIBLING ternary branches, not nested: the resource-grid branch (hosts no popover consumer) and the settings-pages pane (`p-4 space-y-6 max-w-3xl overflow-y-auto`, hosts `ModelSelector`). The ref attaches to the latter.
- Provider wraps all three branches but the ref attaches inside one; on the other branches `.current` is null → viewport fallback. A popover added to those branches must attach the ref to that branch's own pane.

## reorganize-settings-pages-and-descriptions

- **Field contract.** `NumberField`/`ToggleField`/`SelectField`/`TextField` are now EXPORTED and share `FieldShell`. Each takes a REQUIRED `hint: React.ReactNode` and optional `unit?: string`. `useId()` generates the control id; `<label htmlFor>` gives the accessible name; `aria-describedby` points at the hint. `hint={null}` suppresses both the hint element and the attribute.
- **The compiler is the gate (D1).** `hint` is required so omitting it is a type error — `tsc` enumerated exactly 52 call sites. There is NO allowlist file and NO source-scanning test; both were considered and rejected.
- `unit` renders INSIDE the `<label>`, so it forms part of the accessible name. Units were stripped from the label text of 10 keys across en / zh-CN / hu — the translated strings embedded the unit, so English-only stripping would double it in those locales. Guarded by `__tests__/settings-unit-i18n.test.tsx`.
- `hint={null}` is reserved for terms of art from an external spec: OAuth `Client ID` / `Client Secret` / `Issuer URL`, plus provider `Base URL` / `API Key`.
- **`GatedGroup`** indents a control beneath the control that gates it (presentational only, no gating logic changed — D9). Used for `shutdownIdleSeconds`, the reasoning dependents, and the four OpenSpec knobs.
- **`DebugToolsToggle` is DELETED** with the Developer "Chat Display" section (D7). `DisplayPrefsSection` already owned `displayPrefs.debugTools` via the buffered `display-prefs` draft source; the deleted toggle PATCHed immediately through the `@deprecated` `useDebugToolsVisible` hook, so the two desynced until reload. The hook module stays — `ChatView` imports `isDebugTool`. Consequence: that preference is now Save-Bar-buffered, not instant-apply.
- `dashboardName` moved Sessions → General ▸ Interface; its `CONFIG_FIELD_PAGE` entry moved with it so the Save Bar chip follows. Still a bespoke input (D3 forbids swapping bespoke controls for shared ones here).
- `tunnel.watchdog.*` deliberately STAYS on Server (D2): `computeConfigPartial` emits `partial.tunnel` as ONE top-level key and `dirtyPages` attributes per top-level key, so the chip would read Server wherever the JSX lived. A test guards the reversal.
- Sessions regrouped into New session defaults / Session list / Lifecycle & recovery / Worktrees (Retry last, `RetrySettingsSection` untouched). `defaultModel` leads the page in a `--severity-info-*` callout stating it applies only to brand-new sessions.
- `DisplayPrefsSection` splits into three visual sub-sections but keeps its SINGLE `display-prefs` draft source (D8) — three registrations would triple the dirty-chip noise for one blob.
- `spawnRegisterTimeoutMs` stays bespoke: its bounds check blocks the write AND disables Save. Shared `NumberField` is `parseInt(…) || 0` with no bounds, so converting it would delete an enforced constraint. Pinned by `__tests__/settings-bespoke-validation.test.tsx`.
