# Harvest — goal (`packages/goal-plugin/src/client/GoalPluginSettings.tsx`, 47 lines)

## Purpose
Explains goal loop is owned by the `@ricoyudog/pi-goal-hermes` pi extension; one per-browser preference: auto-restart new goals by default.

## Structure
1. Root `<div>` 13px `--text-secondary` space-y-2 `GoalPluginSettings.tsx:19`. No heading (good, no duplicate).
2. Intro `<p>`: "The autonomous goal loop, judge model, and turn budget are owned by the" + `<code>@ricoyudog/pi-goal-hermes</code>` + "pi extension. This plugin surfaces its status as a session-card chip." `:20-24` (sentence split across 2 i18n keys).
3. Install `<p>` `--text-muted`: "Install the extension into pi to activate. Set or control a goal from a session using" + `<code>/goal <objective></code>` + "." `:25-28`.
4. Checkbox row `<label>` wrapping checkbox + label + help span `:29-44`.
No extension-installed status despite docstring "Minimal status panel" `:4-6` — text is static regardless of install state.

## Fields
| label | control | key | hint | unit | validation |
|---|---|---|---|---|---|
| Auto-restart new goals by default | native checkbox (wrapped in label, no htmlFor) `:30-37` | localStorage `pi-dashboard.goal.autoRespawnDefault` ("1"/"0") `goal-settings.ts:10-28` — NOT plugin config | "When a goal's driver session dies, the dashboard starts a new one to keep pursuing — bounded by the turn budget and a crash-loop breaker. Off by default; each goal can override." 11px muted `:40-42` (inside label; not aria-describedby) | — | none; storage failures swallowed `goal-settings.ts:16-17,:25-27` |

## Status & read-only displays
None (no live status, no install detection).

## Actions
None.

## Save model
Immediate per-control: `onChange` → `setAutoRespawnDefault` writes localStorage `:33-36`. Not a host Save-bar source (no `useSettingsDraftSource`) — inconsistent with siblings; per-browser, not synced to server.

## States
- Only one state. No loading/error/not-installed/installed variants.
- Storage failure: silent.

## Protected
- testid: `goal-settings-auto-respawn-default` (on the `<label>`, not the input) `:29`.
- localStorage key `pi-dashboard.goal.autoRespawnDefault`.
- i18n ns `plugin.goal.*` (`src/i18n.ts`): `settingsIntro1`, `settingsIntro2`, `settingsInstall`, `autoRespawnDefaultLabel`, `autoRespawnHelp`.
- aria: none. No shortcuts.

## Off-contract
- `--text-muted` for readable text: install para `:25`, help text `:40`.
- 11px help ok-threshold but muted colour fails contrast intent `:40`.
- Native checkbox not via kit `:30`; label wraps (no `htmlFor`); hint not `aria-describedby`.
- Sentence fragmented across i18n keys around `<code>` (`settingsIntro1/2`) — translation-hostile.
- Persistence scope (this browser only) not disclosed in UI.
- No hex/palette classes; no literal backticks (uses `<code>` correctly).

## Kit mapping
- Intro + install paras → intro text (custom; `--text-secondary`, `<code>` chips) or `SettingsNotice tone="info"` for the "requires extension" message.
- Checkbox → `ToggleField` label "Auto-restart new goals by default", hint = help text (+ "Saved in this browser"), immediate save (or migrate to draft source).
- Optional: extension status → status pill recipe (needs data source; none exists).
