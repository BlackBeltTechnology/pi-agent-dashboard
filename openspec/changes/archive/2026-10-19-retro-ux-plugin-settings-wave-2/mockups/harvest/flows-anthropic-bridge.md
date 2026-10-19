# Harvest — flows-anthropic-bridge (`packages/flows-anthropic-bridge-plugin/src/FlowsAnthropicBridgeSettings.tsx`, 255 lines; i18n `src/i18n.ts`)

## Purpose
Bridge status across reporting pi sessions (peer probe per PID) + two env-var gate overrides (`PI_ANTHROPIC_MESSAGES_FORCE_CANONICAL` / `_DISABLE_CANONICAL`).

## Structure
1. `<section data-testid="flows-anthropic-bridge-settings">` own bordered card inside host card: padding 12, `border:1px solid rgba(82,82,91,.5)`, radius 6, mb 12 — `:105-113` (card-in-card).
2. Header row: `<h3>` "pi-flows · Anthropic Messages Bridge" 13px/600 + right `<span>` literal `flows-anthropic-bridge` 10px `#71717a` — `:114-119`. DUPLICATES host title + id.
3. Description `<p>` 11px `#a1a1aa`: "Forwards `<code>@pi/anthropic-messages</code>` hooks into every pi-flows agent subprocess. Activates only when both peers (`<code>@pi/anthropic-messages</code>` and `<code>pi-flows</code>`) resolve in the pi process." — stitched from 4 i18n fragments `:121-130`.
4. Status banner row (tone bg/colour) with message + Refresh button — `:132-163`.
5. Per-PID table (only when sessions>0) — `:165-201`.
6. `<fieldset>` borderless, legend "Gate overrides" — `:203-206`; 2 checkbox rows `:208-228`; Save button `:230-251`.

## Fields
| label | control | key | hint | unit | validation |
|---|---|---|---|---|---|
| Force gate open (any anthropic-messages model — sets `<code>PI_ANTHROPIC_MESSAGES_FORCE_CANONICAL</code>`) | native checkbox | `forceCanonical` | none (env var in label) | — | none |
| Disable bridge entirely (sets `<code>PI_ANTHROPIC_MESSAGES_DISABLE_CANONICAL</code>`) | native checkbox | `disableCanonical` | none | — | none; both can be ON simultaneously (contradictory) — no guard |

## Status & read-only displays
- Banner `:76-102,132-145`, 11px, padding 6/8, radius 4:
  - none: "No pi sessions reporting yet. Start a pi session to see status." → bg `rgba(63,63,70,0.5)` color `#a1a1aa` `:102` (live: unreadable in light theme).
  - ok: "Bridge active in all pi sessions." → bg `rgba(16,185,129,0.15)` color `#34d399` `:99`.
  - warn: "One or more peers unavailable. See per-session detail below." → bg `rgba(245,158,11,0.15)` color `#fbbf24` `:101`.
- Table 11px `:166-200`: header colour `#a1a1aa` `:175`; cols "PID" (literal, not i18n) / "Status" / `@pi/anthropic-messages` / `pi-flows`. PID monospace `:185`. Status cell = raw enum `probing|waiting_peers|active|degraded` `:186`, no pill. Peer cells "✓" or "✗ {reason ?? "missing"}" `:187-196` — glyph-only, raw reason, no colour.

## Actions
- Refresh — `flows-anthropic-bridge-refresh`, 10px, `border:1px solid currentColor`, transparent, inherits banner colour; label "…" while refreshing (not i18n), opacity .5, cursor wait — `:146-162`. Re-fetches `/api/flows-anthropic-bridge/status` `:58-70`.
- Save — `flows-anthropic-bridge-save`, 11px, border `rgba(82,82,91,.7)`, bg `rgba(63,63,70,.4)`, color `#e4e4e7` — `:230-251`. Sends `plugin_config_write` with draft. No confirm, no busy, no feedback, not disabled when clean.

## Save model
Explicit own Save button `:230-238`; local `draft` `:46-56` re-synced from config. NO `useSettingsDraftSource` → host Save bar unaware; changes lost silently if user leaves.

## States
- Initial/loading: sessions=[] → shows "No pi sessions reporting yet…" banner even while first fetch in flight (no loading state) `:44,72-74`.
- Fetch error: swallowed, keeps old list `:65-66` — no error text.
- Empty: banner none-tone, table hidden.
- All active: ok banner. Degraded/mixed: warn banner + table.
- Refreshing: button "…" disabled.
- Saved / save-error: nothing shown.

## Protected
testids: `flows-anthropic-bridge-settings`, `flows-anthropic-bridge-refresh`, `flows-anthropic-bridge-session-${pid}`, `flows-anthropic-bridge-force`, `flows-anthropic-bridge-disable`, `flows-anthropic-bridge-save`.
aria: none (banner has no `role=status`). Keyboard: none.
i18n namespace `plugin.flows-anthropic-bridge.*` (zh-CN, hu; en via fallbacks): `heading, descForwards, descHooks, descAnd, descResolve, bannerNoSessions, bannerActive, bannerDegraded, refresh, colStatus, peerMissing, gateOverrides, forceLabel, disableLabel, save`. Untranslated: "PID", "…", peer names, status enum.

## Off-contract
- **Banner unreadable in light theme**: hard-coded rgba/hex tone map `:97-102` (none-tone `rgba(63,63,70,0.5)` + `#a1a1aa`; ok `#34d399`; warn `#fbbf24` on 15% tints — low contrast on light bg). Should be severity tokens / `SettingsNotice`.
- Raw hex/rgba everywhere: `:109` border, `:118` `#71717a`, `:121` `#a1a1aa`, `:175` `#a1a1aa`, `:204` `#a1a1aa`, `:243-246` save button (`#e4e4e7` text on translucent zinc → unreadable light theme).
- Font <11px: id chip 10px `:118`, Refresh 10px `:151`.
- Duplicated title + id header `:114-119`; card-in-card border `:109`.
- Description split into 4 i18n fragments around `<code>` `:121-130` (word order locked; untranslatable cleanly).
- Literal code/env var names in checkbox labels `:216,227`.
- Native checkboxes `:209,220`; labels wrap inputs (no htmlFor); no hints / `aria-describedby`.
- Raw enum status + raw peer reason strings shown `:186-196`; ✓/✗ glyph only (no text/colour pairing).
- No mutual-exclusion between force and disable.
- All inline `style={{}}`, zero theme tokens.

## Kit mapping
- Header row → DELETE (host chrome has title + id).
- Description → plain text; env/peer names in `<code>` via kit hint.
- Banner → `SettingsNotice` tone none→`info`, ok→`success`, warn→`warning` (+ `role=status`); Refresh → secondary button recipe inside notice or group meta.
- Per-PID table → custom (needs read-only status-table recipe: PID mono, status pill, peer ok/missing pill with reason).
- Gate overrides → `SettingsGroup` "Gate overrides"; each checkbox → `ToggleField` with hint "Sets `PI_ANTHROPIC_MESSAGES_…`"; error/notice when both on.
- Save → host Save bar via `useSettingsDraftSource`.
