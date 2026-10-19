# Harvest — cost (`packages/cost-estimator/src/client/CostEstimator.tsx`, 302 lines; settings part `CostSettings` `:229-302`)

Claim: `client/index.tsx` is empty; comment says claims `CostView` (command-route) + `CostSettings` (settings-section) load lazily from `CostEstimator.tsx` via manifest `module`. `CostView` `:81-227` NOT in scope (full-screen view).

## Purpose
Seat-plan config so cost view reports real subscription cash instead of meter price; plus seats count and break-gap threshold for active-hour measurement.

## Structure
1. Root `<div data-testid="cost-settings" style={{fontSize:12}}>` — `:238`. No heading (no title/id dup).
2. Intro `<div style={{...muted, marginBottom:6}}>` "Session cost is recorded as a metered API price. If capacity is bought on a subscription, set the plan here so the dashboard reports real cash rather than a theoretical meter." — `:239-242`.
3. `<label>` "Seat plan" + inline `<select>` — `:244-263`.
4. Conditional (seatPlan==="custom") `<label>` "USD per seat per month" + number input — `:265-276`.
5. `<label>` "Seats" + number input — `:278-287`.
6. `<label>` "Break threshold (minutes)" + number input — `:289-299`.
No groups, no footer, no status, no link to cost view. Label + control inline (`display:block` label, text then control on same line) — not stacked.

## Fields
| label | control | key | hint | unit | validation |
|---|---|---|---|---|---|
| Seat plan | native select, unstyled | `seatPlan` (UI fallback "anthropic-max-20x" `:248`) | none | — | none |
| USD per seat per month | native number min=0, unstyled | `seatMonthlyUsd` (fallback 0) | none | USD in label | `Number(v)` each keystroke; no error `:273` |
| Seats | native number min=1, unstyled | `seats` (fallback 1) | none | — | `Number(v)`; empty → 0 written (below min) `:285` |
| Break threshold (minutes) | native number min=1 max=120, unstyled | `gapCapMinutes` (fallback 15) | none — meaning ("breaks over the configured gap are excluded") only in CostView `:117` | minutes in label | none; min/max attrs only `:294-297` |
Select options `:251-261`: Metered (pay-as-you-go) · Claude Pro — $20 · Claude Max 5× — $100 · Claude Max 20× — $200 · ChatGPT Plus — $20 · ChatGPT Pro 5× — $100 · ChatGPT Pro 20× — $200 · GLM Coding Lite — $18 · GLM Coding Pro — $72 · GLM Coding Max — $160 · Custom…
Config type also has `hoursPerDay` `:68` — NOT editable here.

## Status & read-only displays
None. Intro text uses `muted` = `fontSize:11px, opacity:0.65` `:79`.

## Actions
None.

## Save model
Immediate per-control: every `onChange` calls `write()` → `send({type:"plugin_config_write", id:"cost-estimator", config:{...config, ...partial}})` `:234-235`. Number inputs write on EVERY keystroke (intermediate values persisted). No `useSettingsDraftSource`, no feedback, no error handling (promise ignored).

## States
- Loading: renders with fallbacks (`?? "anthropic-max-20x"`, `?? 1`, `?? 15`) — select can show Max 20× while stored value is unset → displayed≠stored.
- Custom plan: extra USD field appears.
- Error: none surfaced. Disabled/busy: none.
- `config` assumed non-null (`config.seatPlan` `:248,265`) — crashes if hook returns undefined.

## Protected
testids: `cost-settings`, `cost-seat-plan`, `cost-seat-monthly`, `cost-seats`, `cost-gap-cap`.
aria: none. Keyboard: none. i18n: NONE — hard-coded English, no catalog.

## Off-contract
- **No visible border on inputs/select**: controls `:246,268,280,291` carry NO className/style; Tailwind v4 preflight (`@import "tailwindcss"` `packages/client/src/index.css:1`) resets `border:0 solid; background:transparent` → Seats / Break threshold / USD inputs render borderless (live-confirmed). Select same root cause.
- All inline `style={{}}` instead of tokens: `:238,239,244,266,278,289`; root `fontSize:12` `:238`.
- Intro readability via `opacity:0.65` `:79,239` (≈ faint text; not a token).
- Labels wrap controls (implicit assoc OK) but no `htmlFor`/ids, no hints, no `aria-describedby`.
- Native select/number inputs not via kit.
- Inline label+control layout (control trails label text with `{" "}`), no consistent width/alignment.
- Keystroke-level persistence; empty number → 0 written below `min`.
- Meaning of "Break threshold" not explained on page.

## Kit mapping
- Intro → plain text (or `SettingsNotice tone=info`).
- Seat plan → `SelectField` (hint: "Subscription → real cash; Metered → meter figures").
- USD per seat per month → `NumberField` unit "USD", shown when custom.
- Seats → `NumberField` (min 1, error when <1).
- Break threshold → `NumberField` unit "min", hint "Idle gaps longer than this are excluded from active steering hours." (from CostView `:117,222`), min 1 max 120, error out of range.
- Optional `SettingsGroup` "Subscription" / "Measurement".
- Save → host Save bar via `useSettingsDraftSource` (stop keystroke writes).
