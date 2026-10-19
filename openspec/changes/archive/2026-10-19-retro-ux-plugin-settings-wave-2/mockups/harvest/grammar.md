# Harvest — grammar (`packages/grammar-plugin/src/GrammarSettings.tsx`, 394 lines; i18n `src/i18n.ts`)

## Purpose
Composer grammar/spell-check: enable, auto-check, correction view, capitalisation, LLM model pick (+ recommended list), advanced debounce/length/language.

## Structure
1. `<section data-testid="grammar-settings" class="text-[13px] text-[var(--text-secondary)] pb-4">` — `:164`.
2. Header row: `<h3>` "Grammar & Spelling" 15px semibold + `<span>` literal `grammar` 10px `--text-muted` mono — `:165-170`. DUPLICATES host title + id.
3. Desc `<p>` 11px: "Composer grammar/spell-check behaviour. The check runs server-side via the configured LLM model." — `:172-178`.
4. `<details open>` "General" (`GROUP`/`SUMMARY`/`BODY` consts `:86-94`) — `:181-238`: Enabled, Auto-check, Correction view select, Capitalize.
5. `<details open>` "Model" — `:241-332`: "Model" span label `:247`, hint+link `:248-259`, `ModelSelector` primitive or unavailable text `:261-286`, model-required warning `:288-300`, nested `<details>` "Recommended models" (collapsed) list of 4 + avoid note `:305-330`.
6. `<details>` (closed) "Advanced" — `:335-391`: Debounce, Min chars, Max chars, Language.
Hand-rolled accordions, not kit `SettingsGroup`. Caret "▸" `:183,243,307,337` static — never rotates on open (`CARET` `:89` has no open-state rotate).

## Fields
| label | control | key | hint | unit | validation |
|---|---|---|---|---|---|
| Enabled | native checkbox | `enabled` (dflt false) | none | — | none |
| Auto-check while typing | native checkbox | `autoCheck` (dflt true) | none | — | none |
| Correction view | native select: "Redline (inline)" / "List" | `correctionView` (dflt redline) | none | — | none |
| Capitalize sentence starts | native checkbox | `capitalizeFirstWord` (dflt false) | none | — | none |
| Model (span, not label) | custom `ui:model-selector` primitive, `allowRoles` | `llm` → `{role}` or `{provider,model}` `:269-279` | "Model choice drives grammar quality, latency, and cost." + link "Which models are good?" `:248-258` | — | warning when unset `:288-300` |
| Debounce (ms) | native number min 300 max 10000 | `debounceMs` (1200) | none | ms in label | `num()` NaN→prev `:158-161`; server clamps, re-GET shows `:146` |
| Minimum characters | native number 1–500 | `minChars` (12) | none | — | same |
| Maximum characters | native number 100–20000 | `maxChars` (4000) | none | — | same; no min<max check |
| Language | native text | `language` ("auto") | none | — | none |
"Enabled" overlaps host enable toggle (separate key).

## Status & read-only displays
- Model-required warning `grammar-model-required` `role=status`, `bg-[var(--severity-warning-bg)] border-[var(--severity-warning-border)] text-[var(--severity-warning-fg)]`, mdi alert svg: "Pick a model — the grammar check cannot run until one is set." `:288-300` (on-contract).
- Recommended list `:310-329`: model id `<code>` 10.5px `--text-primary`; badge "recommended" 9.5px uppercase `--severity-success-fg` `:315`; notes `--text-tertiary` ("100% recall, ~2.5s, zero style churn", "balanced — ~4.7s, 100% recall", "fastest/cheapest (~1s), but adds markdown churn + fails code fences", "solid alternative — ~3.5s"); avoid note 10.5px tertiary "Avoid reasoning models (e.g. deepseek-v4-flash, ~11.5s), ministral-8b (78% recall), and the retired gemini-2.0-flash-001/-lite-001 (404)." `:322-327`.
- "Model selector unavailable" `--text-secondary` `:283-285`.

## Actions
- Link "Which models are good?" → `/docs/grammar-model-guidance.md` new tab `:250-258` (`--text-secondary underline`).
- Summary toggles (3 groups + recommended). No buttons.

## Save model
Host Save bar: `useSettingsDraftSource({id:"plugin:grammar", isDirty, commit, reset})` `:149-156`; `isDirty` JSON compare `:132`; commit POSTs `/api/config/plugins/grammar`, throws `grammar config save failed (${status})` on non-OK `:136-147`, then re-GET. Reset re-GETs.

## States
- Loading: FALLBACK_GRAMMAR rendered (enabled=false) until GET resolves `:46-55,98-99`; no indicator.
- Load error: `load()` has NO try/catch `:117-126` → unhandled rejection, fallback stays silently.
- Models fetch fail → `[]` `:103-115`, selector empty, no message.
- No model: warning notice. Primitive missing: "Model selector unavailable".
- Save error: host shows thrown raw text "grammar config save failed (NNN)".

## Protected
testids: `grammar-settings`, `grammar-enabled`, `grammar-autocheck`, `grammar-correction-view`, `grammar-capitalize`, `grammar-model-hint`, `grammar-model-guidance-link`, `grammar-llm-model-selector`, `grammar-llm-model-selector-unavailable`, `grammar-model-required`, `grammar-recommended-models`, `grammar-debounce`, `grammar-minchars`, `grammar-maxchars`, `grammar-language`.
aria: `role="status"` `:291`; svg `aria-hidden` `:295`. Keyboard: native details/summary. Draft source id `plugin:grammar`.
i18n `plugin.grammar.*` keys used: `heading, desc, groupGeneral, enabled, autoCheck, correctionView, correctionViewRedline, correctionViewList, capitalizeFirstWord, groupModel, llmModel, modelHint, modelHintLink, modelSelectorUnavailable, modelRequired, recommendedModels, recBadge, recNano, recQwen30, recNova, recMini, recAvoid, groupAdvanced, debounceMs, minChars, maxChars, language`.

## Off-contract
- **Group content flush on left border**: `packages/grammar-plugin` NOT in `@source` list `packages/client/src/index.css:16-31` → `px-3.5` never generated (absent from built `dist/assets/index-*.css`) → `BODY` `:90` and `SUMMARY` `:88` lose horizontal padding (also recommended `<ul>` `:310`). `motion-safe:transition-transform` `:89` also missing. Other classes render only because core uses them.
- Duplicated title + id header `:165-170`.
- Font <11px: id chip `text-[10px]` `:169`; model hint `text-[10px]` `:248`; code `text-[10.5px]` `:313`; badge `text-[9.5px]` `:315`; avoid note `text-[10.5px]` `:322`.
- `--text-muted` on readable text: model hint `:248`, id chip `:169`. `--text-tertiary` for notes `:319,322`.
- "Model" label is a `<span>` `:247` — not associated with selector; hint `grammar-model-hint` not linked via `aria-describedby`.
- Native checkboxes `:188,199,228`, native select `:211`, native number/text `:343,356,369,382` (local `CONTROL` const `:93-94`, not kit).
- Labels wrap controls (implicit) but no hints/`aria-describedby` for any field.
- Hand-rolled `<details>`: `list-none` without `::-webkit-details-marker` hide → possible double marker (Safari); static caret.
- Raw error string `:143` surfaced by host.
- Group radius `rounded-[10px]` `:86` vs kit `rounded-lg`; summary height ~py-2.5 vs kit `min-h-[44px]`.

## Kit mapping
- Header row → DELETE.
- Desc → plain text.
- Groups → `SettingsGroup` "General" / "Model" / "Advanced" (Advanced collapsed).
- Enabled / Auto-check / Capitalize → `ToggleField`.
- Correction view → `SelectField`.
- Model → `FieldShell` wrapping `ModelSelector` (custom control; `hint` = modelHint + link).
- Model-required → `SettingsNotice tone=warning`.
- Recommended models → custom (needs nested disclosure / reference-list recipe).
- Debounce → `NumberField` unit "ms"; Min/Max chars → `NumberField` (error when min≥max); Language → `TextField` hint "auto or BCP-47 code".
- Save already host bar — keep.
