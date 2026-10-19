# Harvest — blackhole (`BlackholeSettings.tsx` 912 + `ChainEditor.tsx` 578 + `field-groups.ts` 191)
(BS = BlackholeSettings.tsx, CE = ChainEditor.tsx, FG = field-groups.ts. MemorySubcard/OmEntryCard/PipelineDetailView are other slots — not rendered here.)

## Purpose
Edits pi-blackhole extension config file (compaction + observational memory): scalar knobs in 5 accordions + per-worker (observer/reflector/dropper) ordered model fallback chains + base model.

## Structure
Claim `settings-section` `tab:"general"`. Root `<div text-[13px] pb-8>` BS:445. No plugin-title header (state-specific h3 only).
1. Intro BS:446-450 "Compaction and observational memory for the `<code>pi-blackhole</code>` extension."
2. File line BS:452-466 mono 11px: "File:" + path chip (green) + "· {n} unmanaged keys preserved" | "· not yet created".
3. Apply note box BS:470-479 "pi-blackhole re-reads this file after every write, so saved changes reach running sessions on its own. Keys this page doesn't manage (including _comment notes) are preserved untouched."
4. 5 `<details>` accordions (closed) BS:481-504, summary = title + "{n} fields": Compaction behaviour(4) · Observational memory(2) · Trigger thresholds(3) · Token budgets(7) · Runtime & diagnostics(4) FG:26-165. Each FieldRow BS:821-839: label 13px + mono key 11px + "DEFAULT" badge + help 11.5px + control + unit.
5. ConfirmDialog primitive (conditional) BS:506-520.
6. "Worker models" `<details open>` BS:579-805: summary title + [Retry] button inside summary + "3 chains"; help BS:604-610; save-error box; registry-unavailable box; registry-empty box; Base Model card BS:660-726; Recommended defaults dashed card BS:729-783; 3× ChainEditor BS:785-802.
7. ChainEditor CE:446-576: header name 13px + role desc 11.5px + "{n} model(s)"; empty dashed box OR `<ol>` EntryRow `<details>` (collapsed): # · PRIMARY badge · id+provider or RoleRef · role-status pill · ↑ ↓ ✕; body: Model picker, detached callout+Reattach, level-drop callout, Thinking row, Cooldown (hours), Context window. Adding panel; [+ Add model to {worker} chain]; tail "then base model · id → session model".

## Fields
| label | control | key | hint (FG) | unit | validation |
|---|---|---|---|---|---|
| Trigger | native `<select>` BS:874 | `compaction` auto/manual/off | "auto — blackhole fires on its own. manual — only /blackhole. off — pi handles auto-compaction and /compact." | — | — |
| Engine | select | `compactionEngine` blackhole/pi-default | "Who produces the summary — …" FG:38 | — | — |
| Tail behaviour | select | `tailBehavior` pi-default/minimal | FG:43 | — | — |
| Mid-run compaction | select | `midRunCompaction` resume/pause/off | FG:48 | — | — |
| Enable memory workers | native checkbox + "On/Off" BS:861-870 | `memory` | FG:58 | — | — |
| Fall back to the session model | checkbox | `sessionFallback` | FG:63 | — | — |
| Observe after / Reflect after / Compact after | native number BS:902 | `observeAfterTokens`/`reflectAfterTokens`/`compactAfterTokens` (int ≥1) | FG:73,79,85 | tokens | client none; empty→NaN→key omitted BS:140; server 400 → saveError |
| Observation pool max/target, Observer chunk max, Observer preamble max (≥0), Reflector input max, Dropper input max | number | `observationsPool{Max,Target}Tokens`, `observerChunkMaxTokens`, `observerPreambleMaxTokens`, `reflectorInputMaxTokens`, `dropperInputMaxTokens` | FG:95-127 | tokens | same |
| Dropper pressure threshold | number step 0.05 BS:891 | `dropperPressureThreshold` | FG:132 | "> 0 and ≤ 1" | same |
| Max agent turns | number | `agentMaxTurns` | FG:145 | turns | same |
| Provider idle timeout | number | `providerIdleTimeoutMs` | FG:151 | "ms · 0 = off" | same |
| Debug output / Debug log file | checkbox | `debug` / `debugLog` | FG:157,162 | — | — |
| Base Model | ModelSelector primitive (allowRoles) BS:681 or read-only mono BS:709 | `model` | "Shared fallback for all workers before the session model." | — | — |
| Model (per entry) | ModelSelector CE:276 / read-only CE:283 | `<worker>Model`, `<worker>FallbackModels[i]` | none | — | — |
| Override thinking level | native checkbox CE:134 + ThinkingLevel primitive CE:152 | entry `.thinking` | none; "(inherit)" / "from {role}" | — | reasoning=false → level dropped notice CE:417-427 |
| Cooldown (hours) | native number CE:334 | entry `.cooldownHours` | none | hours (label) | none; raw string passed CE:339 |
| Context window | native number CE:345 placeholder "inherit from pi" | entry `.contextWindow` | none | — | none |
Labels: FieldRow label is `<span>` + control `aria-label` (no htmlFor, help not describedby) BS:823,834.

## Status & read-only displays
- File path chip `text-[var(--accent-green)]` border BS:455; "{n} unmanaged keys preserved" tertiary 11px.
- "DEFAULT" badge `text-[10px] uppercase` tertiary bordered BS:826-831 (literal "default", not i18n).
- Group meta "{n} fields" / "3 chains" 11px tertiary BS:489,599.
- "On"/"Off" beside checkbox BS:869 (not i18n).
- Base model key `model` `font-mono text-[10px]` BS:669.
- Staged notice `text-[var(--accent-blue)]` 11px "Staged {n} of 3 recommended models from available candidates." BS:765-771.
- Entry: index num 11px; "PRIMARY" `text-[10px] uppercase` CE:200; role-status pill WARNING_PILL severity-warning tokens CE:60-61 ("Detached" / "Role unassigned, keeps its last model"); "{n} model(s)" CE:457 (not i18n).
- Tail CE:559-575 11px tertiary: "then base model · {id}" / "(unset)" → "session model" / "(excluded)" line-through opacity-60 (not i18n).

## Actions
| label | kind | does | confirm |
|---|---|---|---|
| Re-check file | secondary BS:417 | `load()` | no |
| Save (disabled) | disabled secondary BS:425-432 | none — parse-error explicit blocked | — |
| Retry (in summary) | small secondary BS:586-598 | refetch registry (preventDefault toggle) | no |
| Retry (banner) | small secondary BS:634 | same | no |
| Clear (base model) | small secondary BS:716-724 disabled if null | baseModel=null | no |
| Use recommended defaults | secondary BS:774-782 disabled `!hasCandidate` | stages chains ×3 + `debug`/`debugLog`=true | ConfirmDialog only if any chain non-empty BS:347-357; confirm "Apply Defaults" |
| ↑ / ↓ | icon buttons CE:230-249 disabled at bounds | move entry | no |
| ✕ remove | icon `text-[var(--accent-red)]` CE:250-259; hidden when 1 entry | remove | no |
| Reattach to {role} | secondary min-h 44/36 CE:303-310 | `reattachBinding` + reload (IMMEDIATE, bypasses Save bar) | no |
| + Add model to {worker} chain | secondary CE:546-555 disabled registry≠ok | open adding panel | — |
| ✕ cancel adding | icon CE:505-512; Esc closes CE:495-499 | close panel | — |

## Save model
Host Save bar via `useSettingsDraftSource({id:"plugin:blackhole"})` BS:298-316; dirty = payload JSON ≠ baseline. commit → `putConfig(payload)` + reload; error → `saveError` box + rethrow. reset → reload. Exception: Reattach writes immediately BS:278-289. Recommended defaults only stages into draft.

## States
- loading: "Loading…" `text-[var(--text-muted)]` BS:391,439.
- load-error: "Failed to load config: {error}" `text-[var(--accent-red)]` BS:361-363.
- not-installed: h3 15px "pi-blackhole isn't installed" + body + `<code>` "pi install npm:pi-blackhole" BS:367-387 (no copy button).
- parse-error: red h3 "Config file can't be parsed — editing is disabled", body, path, `<pre>` raw parser message red, [Re-check file] [Save disabled] BS:394-435.
- form (file missing → "not yet created").
- registry pending: pickers replaced by read-only mono values; Add disabled; defaults hint "Registry unavailable. Staging defaults is disabled." (shown for pending too BS:744).
- registry unavailable: error box "✕ Model registry unavailable ({reason\|\|"503"})." + Retry BS:621-643.
- registry empty: warning box "⚠️ No credentialed models in registry. Configure provider API keys in Settings > Providers to enable model selection." BS:645-657.
- no candidate: "No flash, haiku, or mini models found in registry." BS:754-762.
- save error: severity-error box w/ raw message BS:612-619 (inside Worker models only).
- chain empty: "Worker currently resolves to base / session tail only." CE:466.

## Protected
data-testid BS: `blackhole-load-error`, `blackhole-not-installed`, `blackhole-install-command`, `blackhole-parse-error`, `blackhole-file-path` (×2 states), `blackhole-parse-message`, `blackhole-recheck`, `blackhole-save-blocked`, `blackhole-settings`, `blackhole-apply-note`, `blackhole-group-${title}` (title has spaces), `blackhole-group-chains`, `blackhole-registry-retry`, `blackhole-save-error`, `blackhole-registry-unavailable`, `blackhole-registry-retry-banner`, `blackhole-registry-empty`, `blackhole-base-model-card`, `blackhole-base-model-value`, `blackhole-base-model-clear`, `blackhole-recommended-defaults-card`, `blackhole-recommended-defaults-btn`, `blackhole-default-badge-${key}`, `blackhole-input-${key}`.
CE: `blackhole-entry-${i}-thinking-from-role`, `blackhole-chain-${w}-entry-${i}`, `…-entry-${i}-role`, `…-entry-${i}-role-status` (+`data-status`), `blackhole-chain-${w}-up-${i}`/`-down-${i}`/`-remove-${i}`, `blackhole-chain-${w}-${i}-model`, `blackhole-chain-${w}-reattach-${i}`, `blackhole-chain-${w}-${i}-level-drop`, `blackhole-chain-${w}`, `…-empty`, `…-adding`, `…-add`, `…-tail`, `…-tail-base`, `…-tail-session` (+`data-excluded`).
aria: control `aria-label={meta.label}`; move/remove/add/cooldown/context aria-labels naming model CE:233,243,253,338,350,549; `role="group"` model row CE:265; `role="status"` callouts CE:294,317; `aria-labelledby` section CE:448. Keyboard: Esc closes adding CE:495; reorder button-driven (WCAG 2.1.1, keep). i18n `plugin.blackhole.*` (`src/i18n.ts`); FG labels/help NOT i18n (data). Tests: BlackholeSettings/ChainEditor tests (696/489 lines).

## Off-contract
- `var(--accent-red)` as TEXT: BS:361, BS:397, BS:411, CE:255. `var(--accent-green)` text BS:455. `var(--accent-blue)` text BS:765.
- `--text-muted` readable text: BS:391, BS:439.
- Font < 11px: `text-[10px]` BS:669, BS:827, CE:200. Off-scale sizes `text-[12.5px]` BS:373,400,844; `text-[11.5px]` BS:604,736,779,834, CE:115,131,146,159,271,332,343,455; `text-[15px]` BS:370,397.
- Native `<select>` BS:874, number inputs BS:890,902, CE:334,345, checkboxes BS:862, CE:134 — not via kit; custom `controlCls`/`inputCls` BS:843, CE:35.
- Labels `<span>` + aria-label; help `<p>` not `aria-describedby` BS:823-834.
- Interactive `<button>` nested in `<summary>` BS:586 (nested interactive).
- Emoji/glyph as status icons "✕" BS:627, "⚠️" BS:650; ✕ remove CE:258.
- Raw error code fallback "503" BS:630; raw parser message in `<pre>` BS:414; raw `saveError` message BS:617.
- Non-i18n literals: "default" BS:830, "On"/"Off" BS:869, "model" key BS:669, "model(s)" CE:457, tail copy CE:563-573, "inherit from pi" CE:348, aria-labels CE:136,233,243,253,338,350,549.
- Help copy from FG renders literal tokens ("/blackhole", "/compact", "_comment") as plain text, no code styling.
- Duplicate "Retry" control (summary + banner); `--text-tertiary` for all help (OK token, low weight).
- Groups closed by default — 20 scalars hidden; DEFAULT badge appears on almost every field.

## Kit mapping
- Intro/file line/apply note → `SettingsNotice tone="info"` (file path = custom mono chip, needs recipe).
- Accordions → `SettingsGroup title meta="{n} fields"`.
- enum → `SelectField`; boolean → `ToggleField` (onLabel/offLabel replaces "On/Off"); integer/fraction → `NumberField` (`decimal`, `allowEmpty`, unit, error); help → `hint`. DEFAULT badge → custom (needs recipe) or FieldShell label suffix.
- not-installed → `SettingsNotice tone="info"` + copyable command (recipe); parse-error → `SettingsNotice tone="error"` + `<pre>` + buttons; load-error → `SettingsNotice tone="error" role="alert"`.
- registry unavailable/empty, save error → `SettingsNotice` error/warning/error.
- Worker models → `SettingsGroup`; Base Model card, Recommended defaults card, ChainEditor (ordered list, reorder, role pills, per-entry thinking/cooldown/context) → custom (needs recipe): no kit list/reorder/model-picker field. Entry cooldown/context → `NumberField`; thinking override → `ToggleField` + primitive.
