# Test Plan — align-grammar-settings-design

Stage: apply   Generated: 2026-08-11

No blocking clarifications — every Triple slot filled.

All automated rows land in the grammar-plugin vitest project (jsdom component
tests). Exemplar for the draft-source harness: `packages/client/src/components/
__tests__/RetrySettingsSection.test.tsx` (mounts the settings-draft provider);
current component harness: `packages/grammar-plugin/src/__tests__/GrammarSettings.test.tsx`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | settings controls → Section registers with the host unified Save Bar | state-transition | L1 | automated | rendered section, loaded config | edit a control away from loaded, then revert | registers `useSettingsDraftSource` id `plugin:grammar`; `isDirty` true after edit, false after revert |
| E2 | settings controls → Save persists via the plugin config endpoint | state-transition | L1 | automated | dirty draft (e.g. debounce 2000) | host commits the `plugin:grammar` source | `POST /api/config/plugins/grammar` fired with the edited body; NOT `PUT /api/config` |
| E3 | settings controls → Section registers … (reset) | state-transition | L1 | automated | edited draft | `reset()` invoked | draft returns to the loaded values (edit discarded) |
| E4 | settings controls → The model picker is always shown and required | decision-table | L1 | automated | `plugins.grammar.llm` unset vs set | render | unset → `grammar-model-required` present; set → absent; both → no backend selector / URL field |
| E5 | settings controls → A persisted LanguageTool config renders as LLM-only | EP | L1 | automated | `plugins.grammar` = `{…, backend:"languagetool", languagetool:{url}}` | mount | no `grammar-backend` / `grammar-lt-url`; LLM controls render |
| E6 | settings controls → Correction view control persists | state-transition | L1 | automated | set **Correction view** = `list` | host commit | POST body carries `correctionView:"list"` |
| E7 | settings controls → Fields are grouped into collapsible accordions | state-transition | L1 | automated | render | inspect DOM | `<details>` group(s) present; surviving testids all present; `grammar-save`/`grammar-reload`/`grammar-dirty` ABSENT |
| E8 | model guidance → recommended-models disclosure lists the top models | decision-table | L1 | automated | render | expand `grammar-recommended-models` | lists `claude-haiku-4-5` (recommended) + others; collapsed by default; the `<details>` is NOT a descendant of a `<label>` |
| E9 | model guidance → hint + link render; target resolves | static-lint | L1 | automated | render (llm section) | inspect + resolve link href | localized hint present; `grammar-model-guidance-link` present; href resolves to an existing `docs/*.md` file |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | settings controls → A failed save keeps the section dirty | fault-injection | L1 | automated | `POST /api/config/plugins/grammar` responds `500` (fetch `res.ok===false`) | host commit | `commit` rejects (promise throws); source stays dirty; no "saved" success path taken |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | theme-token section → No inline style attributes remain on plugin-owned elements | state-invariant | L1 | automated | rendered section | scan `[style]` excluding `[data-testid="grammar-llm-model-selector"]` descendants | zero plugin-owned elements carry an inline `style`; no `#hex`/`rgba()`/`hsl()` literal in the section |
| F2 | theme-token section → No LanguageTool reachability marker is rendered | state-invariant | L1 | automated | rendered section | query | `grammar-lt-health` is null |
| F3 | theme-token section → Interactive controls have a visible focus indicator | state-invariant | L1 | automated | rendered section | inspect controls + `<summary>` elements | each surviving control AND each accordion `<summary>` carries `focus-ring` (or an explicit visible focus style) |
| F4 | theme-token section → adapts across data-theme (token usage) | state-invariant | L1 | automated | rendered section | inspect classes | colors reference `var(--…)` tokens only (no hardcoded literal) — the automatable half of theme adaptation |
| F5 | proposal → matches the blackhole/hermes plugin-settings look & feel | visual/subjective | — | manual-only | the rendered section in Settings ▸ Plugins ▸ Grammar & Spelling | human compares against blackhole/hermes | [judgment: accordion + Save-Bar + spacing read as the same design language — no automatable observable] |

---

## Coverage summary

- Requirements covered: 3/3 (settings controls, model guidance, theme-token section)
- Scenarios by class: edge 9 · perf 0 · frontend 5 · error 1
- Scenarios by level: L1 14 · manual-only 1
- Scenarios by disposition: automated 14 · manual-only 1

## New infra needed

- none — all automated rows are grammar-plugin jsdom component tests. The draft-source cases (E1–E3, E6, X1) require wrapping the render in the settings-draft provider (see `RetrySettingsSection.test.tsx`); no new harness/tier.
