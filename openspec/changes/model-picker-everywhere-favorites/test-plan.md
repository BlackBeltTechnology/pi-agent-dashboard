# Test Plan — model-picker-everywhere-favorites

Stage: design   Generated: 2026-05-19

---

## Scenarios

Requirement refs: **MS** = `specs/model-selector` "Selector SHALL provide a favorites filter and star toggles" (MODIFIED); **AC** = `specs/automation-content-view` "Default model is chosen through the shared model picker" (ADDED); **D3** = design D3 `usePluginConfigOf`.

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | MS | decision-table (props absent, ctx present) | L1 | automated | `ModelConfigProvider` value `{favorites:["anthropic/a"], toggleFavorite: spy}`; `<ModelSelector models=[a,b]>` with no favorites props | open dropdown | row `a` has `model-fav-toggle[aria-pressed=true]`; row `b` `aria-pressed=false`; `favs-only-toggle` present; clicking `a`'s star calls spy with `("anthropic/a", false)` |
| E2 | MS | decision-table (both props explicit, ctx present) | L1 | automated | ctx favorites `["anthropic/a"]` + ctx spy; props `favorites=["anthropic/b"] onToggleFavorite=propSpy` | open dropdown, click star on `b` | only `b` `aria-pressed=true`; `propSpy` called once, ctx spy never called |
| E3 | MS | decision-table (partial props: favorites only) | L1 | automated | ctx toggle spy present; props `favorites=["anthropic/a"]`, no `onToggleFavorite` | open dropdown | zero `model-fav-toggle` elements; no `favs-only-toggle`; ctx spy never called |
| E4 | MS | decision-table (partial props: handler only) | L1 | automated | ctx favorites `["anthropic/a"]`; props `onToggleFavorite=propSpy`, no `favorites` | open dropdown | stars render, none `aria-pressed=true` (caller owns pair, ctx favorites not read); clicking calls `propSpy` |
| E5 | MS | decision-table (no props, no ctx) | L1 | automated | `<ModelSelector models=[a,b]>` rendered with no provider | open dropdown | zero `model-fav-toggle`; no `favs-only-toggle`; both rows listed |
| E6 | MS | BVA (persisted favOnly × no favorites source) | L1 | automated | `localStorage` favs-only key = `"1"`; no provider, no props; models `[a,b]` | open dropdown | both `a` and `b` listed (no "No models match") |
| E7 | MS | BVA (persisted favOnly × ctx present, zero favorites) | L1 | automated | favs-only key `"1"`; ctx favorites `[]`; models `[a,b]` | open dropdown | `favs-only-toggle[aria-pressed=true]` visible; list empty with the existing empty-match message (filter honoured because a source exists) |
| E8 | AC | EP (valid pick) | L1 | automated | `AutomationSettings` under `PluginContextProvider`+`CurrentPluginLayer`+`withUiPrimitiveProvider` (stub picker exposing `onSelect`); roles cfg `models=[{provider:"anthropic",id:"x"}]`; config `defaultModel:""` | stub emits `onSelect("anthropic/x")`, host Save commits | `plugin_config_write` payload `defaultModel === "anthropic/x"`; `isDirty` true before save |
| E9 | AC | EP (invalid: free text impossible) | L1 | automated | same harness | query DOM inside `[data-testid=automation-default-model]` | no `input[type=text]`; stub picker present |
| E10 | AC | state (clear) | L1 | automated | config `defaultModel:"anthropic/x"` | click `automation-default-model-clear`, Save | written `defaultModel === ""`; picker `current` prop becomes `undefined` (placeholder path), not `""` |
| E11 | AC | EP (stale value) | L1 | automated | config loaded with `defaultModel:"gone/model"`; roles `models=[anthropic/x]` | render | stub picker receives `current="gone/model"` |
| E12 | AC | EP (legacy `:level` value) | L1 | automated | config `defaultModel:"anthropic/x:high"`; catalogue `[anthropic/x]` | render, no interaction, Save not pressed | picker `current="anthropic/x:high"`; `isDirty` false (value preserved untouched) |
| E13 | D3 | BVA (never-set plugin id) | L1 | automated | module config store has no entry for `"nope"` | `renderHook(() => usePluginConfigOf("nope"))`, re-render 3× | same object identity each render (`Object.is`); no React "getSnapshot should be cached" warning; result `{}` |
| E14 | D3 | state-transition (update after mount) | L1 | automated | hook mounted for `"roles"` with empty store | `applyPluginConfigUpdate({id:"roles", config:{models:[…]}})` | hook result updates to new config within the same `act` |

### Performance

_None — no latency/throughput requirement in the spec; nothing invented._

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | MS | state-convergence (Settings picker star) | L1 | automated | `SettingsPanel` Sessions page inside `ModelConfigProvider` with favorites `["anthropic/a"]` + `toggleFavorite` spy; models `[a,b]` | open Default Model picker | `a` star `aria-pressed=true`; click → spy `("anthropic/a", false)`; no `SettingsPanel` source change needed |
| F2 | MS | state-convergence (Model Proxy pickers) | L1 | automated | `ModelProxySection` inside `ModelConfigProvider` favorites `["anthropic/a"]`; `availableModels=[a,b]` | open add-model picker; open alias-target picker | in each, `a` `aria-pressed=true` and `favs-only-toggle` present |
| F3 | MS | cross-surface convergence | L3 | automated | harness dashboard, one live session, Settings → Sessions open | star model `M` in Default Model picker; navigate to session composer; open its selector | composer row `M` `model-fav-toggle[aria-pressed=true]`; reload page → still pressed (server-persisted) |
| F4 | AC | state-convergence (late catalogue) | L1 | automated | `AutomationSettings` mounted with roles store empty | `applyPluginConfigUpdate({id:"roles", config:{models:[anthropic/x]}})` | stub picker re-renders with `models` length 1, no remount |
| F5 | AC | DOM structure (label/control) | L1 | automated | rendered `AutomationSettings` | inspect `[data-testid=automation-default-model]` ancestors | no `<label>` ancestor wraps the picker trigger (caption is a sibling) |
| F6 | AC | visual/subjective | — | manual-only | Settings → Automation page in browser | human looks | [judgment: picker + clear button align with the other controls on the page; placeholder copy reads naturally in en/zh-CN/hu] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | AC | fault (empty catalogue) | L1 | automated | roles cfg has no `models` key | render `AutomationSettings` | picker receives `models=[]` (not `undefined`); no throw; clear button still operable |
| X2 | AC | fault (roles config never arrives) | L1 | automated | store never updated for `"roles"` | render, wait 0 ticks | component renders once and stays stable (no update loop; render-count spy ≤ 2) |

---

## Coverage summary

- Requirements covered: 3/3 (MS, AC, D3 hook)
- Scenarios by class: edge 14 · perf 0 · frontend 6 · error 2
- Scenarios by level: L1 20 · L2 0 · L3 1
- Scenarios by disposition: automated 21 · manual-only 1

## New infra needed

- none — L1 harness exemplars exist (`packages/client/src/components/__tests__/ModelSelector.test.tsx`, `SettingsPanel.test.tsx`, `packages/automation-plugin/src/__tests__/CreateAutomationDialog.wiring.test.tsx`), L3 via existing docker harness (`tests/e2e/`).
