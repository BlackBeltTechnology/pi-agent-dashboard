# Harvest — quota (`packages/quota-plugin/src/QuotaSettings.tsx`, 342 lines)

## Purpose
Provider-quota tracking: master enable, per-provider opt-in (8 providers), transient-retry policy + backoff preview.

## Structure
1. `<section data-testid="quota-settings">` bordered card, inline style padding 12 — `QuotaSettings.tsx:212-216`.
2. Header row: `<h3>` "Provider Quota" (13px/600) + right `<span>` literal `quota` 10px muted — `:217-220`. DUPLICATES host chrome title + id.
3. Master checkbox "Enable quota tracking" — `:222-230`. Overlaps semantically w/ host plugin enable toggle (separate key `enabled` in config).
4. `<fieldset>` legend "Enable per provider" — `:232-235`; 8 rows from `SUPPORTED_PROVIDERS` (`providers.ts:18-27`): anthropic, github-copilot, kimi-coding, openai-codex, opencode-go, openrouter, synthetic, zai; labels via `PROVIDER_LABELS` (`client.tsx:41-50`): Anthropic, Copilot, Kimi Code, Codex, OpenCode Go, OpenRouter, Synthetic, Z.ai. Order = id order, not label order.
   - Each row: checkbox + label + optional reason span (ticked && unavailable) + Anthropic-only "⚠ Warning" span w/ `title` tooltip — `:240-278`.
5. `<fieldset data-testid="quota-retry">` legend "Retry transient failures" — `:285-291`.
   - checkbox "Retry on HTTP 429/5xx, timeout, or network error" `:292-300`.
   - 3 `RetryNumField` (label span w=130 + number input w=90) `:301-330`.
   - `SchedulePreview` only when retry.enabled `:331-338` (component `:66-104`).
No intro text. No footer. No save button.

## Fields
| label | control | key | hint | unit | validation |
|---|---|---|---|---|---|
| Enable quota tracking | native checkbox | `enabled` | none | — | none |
| <ProviderLabel> ×8 | native checkbox | `providers.<id>.enabled` | none (anthropic: ToS text only in `title` tooltip) | — | none |
| Retry on HTTP 429/5xx, timeout, or network error | native checkbox | `retry.enabled` | none | — | none |
| Max retries | native number | `retry.maxAttempts` (dflt 3) | none | count | min 0 max 5 step 1 attrs only; clamp in preview `:49-53`; no inline error |
| Base delay (ms) | native number | `retry.baseDelayMs` (dflt 1000) | none | ms in label text | min 100 max 10000 step 100; no error |
| Max delay (ms) | native number | `retry.maxDelayMs` (dflt 60000) | none | ms in label text | min 100 max 60000 step 1000; no error |
Number fields disabled (opacity .4) when retry off `:143`.

## Status & read-only displays
- Provider reason (ticked + `/api/quota` unavailable, `client.tsx:188-203`): "not signed in" / "provider refused the request" / "no quota reported" / "not supported" — 10px `var(--text-muted,#71717a)` `:255-261`.
- ToS warning: "⚠ Warning" 10px `color:"#fbbf24"` cursor help, body only via `title` attr: "Quota tracking calls undocumented provider endpoints that may violate provider terms. Personal/local use only." `:264-276`.
- Schedule preview `quota-retry-preview` 10px muted `:78-81`: "Worst-case wait before a provider is marked unavailable:" + bold total (`--text-secondary`) or "no retries"; monospace sequence `a → b → c`; caveat "Includes each attempt's request timeout. A provider that issues multiple calls per attempt (e.g. Copilot) may exceed this."
- Id chip `quota` 10px muted `:219`.

## Actions
None (no buttons/links).

## Save model
Host Save bar: draft state `:180-181`, `isDirty` `:190-195`, `useSettingsDraftSource({ id: "plugin:quota", isDirty, commit, reset })` `:210`; commit sends `plugin_config_write` `:203-205`. Full config spread to round-trip unknown keys `:175-178`.

## States
- Loading: none — `config` undefined → all unchecked defaults.
- Load-error of `/api/quota`: silent, reasons `{}` (`client.tsx:198-199`).
- Retry off: number inputs disabled, no preview. Retry on, maxAttempts 0: total "no retries", no sequence.
- Dirty: host bar only; no per-field Changed pill.

## Protected
- testids: `quota-settings`, `quota-enable`, `quota-provider-${id}` (×8), `quota-provider-${id}-reason`, `quota-tos-warning`, `quota-retry`, `quota-retry-enabled`, `quota-retry-maxAttempts`, `quota-retry-baseDelayMs`, `quota-retry-maxDelayMs`, `quota-retry-preview`, `quota-retry-total`, `quota-retry-sequence`.
- draft source id `plugin:quota`.
- aria: none explicit; labels wrap inputs (implicit). No keyboard shortcuts.
- i18n ns `plugin.quota.*` (`i18n.ts`, zh-CN + hu): heading, tosTitle, tosBody, providersLegend, enableQuota, reasonNoCredential/Rejected/NoData/NoAdapter, retryLegend, retryEnable, retryMaxAttempts, retryBaseDelay, retryMaxDelay, retryPreviewTotal, retryNone, retryMultiCallCaveat.

## Off-contract
- Raw hex `#fbbf24` as warning text `:272` (should be `--severity-warning-fg` / SettingsNotice).
- Hex fallbacks in var(): `#71717a` `:80,:219,:257`; `#a1a1aa` `:84,:126,:233,:289`; `#e4e4e7` `:143`; rgba fallbacks `:139,:140,:215`.
- Font <11px: 10px at `:80` (preview), `:219` (id chip), `:257` (reason), `:272` (warning).
- `--text-muted` for readable text: preview `:80`, reason `:257`.
- Native checkboxes not via kit: `:223,:247,:293`. Native number inputs w/ inline style `:127-145`.
- All inline `style={{}}`, no Tailwind tokens, no `focus-ring`.
- No hints → no `aria-describedby`; ToS content tooltip-only (inaccessible to touch/keyboard).
- Duplicated heading "Provider Quota" + id `quota` `:217-220`.
- Units baked into label "(ms)" instead of unit chip.
- Warning glyph "⚠" as text, not icon.

## Kit mapping
- Header `:217-220` → delete (host chrome).
- Enable quota tracking → `ToggleField` (hint: null or explain vs host toggle).
- Providers fieldset → `SettingsGroup title="Enable per provider"` + 8× `ToggleField`; reason → ToggleField `hint` (or error tone text). ToS → `SettingsNotice tone="warning"` inline on anthropic row / above group (body visible, not tooltip).
- Retry fieldset → `SettingsGroup title="Retry transient failures"`; enable → `ToggleField`; 3× `NumberField` (`unit="ms"`, min/max, disabled); schedule preview → custom (needs recipe: read-only computed summary block, 12px `--text-secondary`, mono sequence).
