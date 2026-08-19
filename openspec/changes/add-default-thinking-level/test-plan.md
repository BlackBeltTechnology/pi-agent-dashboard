# Test Plan — add-default-thinking-level

Stage: design   Generated: 2026-08-19

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | shared-config: field default | EP | L1 | automated | `config.json` with no `defaultThinkingLevel` key | `loadConfig()` | returns `defaultThinkingLevel === ""` |
| E2 | shared-config: set value round-trips | EP | L1 | automated | `config.json` = `{ "defaultThinkingLevel": "high" }` | `loadConfig()` | returns `defaultThinkingLevel === "high"` |
| E3 | shared-config: non-string rejected | invalid-partition | L1 | automated | `config.json` = `{ "defaultThinkingLevel": 3 }` | `loadConfig()` | returns `defaultThinkingLevel === ""` (fallback) |
| E4 | shared-config: partial-merge preserves siblings | decision-table | L1 | automated | existing config with `port` + `defaultModel` set; partial `{ "defaultThinkingLevel": "low" }` | write via config partial merge | `defaultThinkingLevel === "low"` AND `port`/`defaultModel` unchanged |
| E5 | bridge: empty level → no setThinkingLevel | boundary | L1 | automated | gate passes (brand-new startup, registry captured, `defaultModel` set); `defaultThinkingLevel === ""` | `applyDefaultModel()` success branch runs | `pi.setModel` called; `pi.setThinkingLevel` NOT called |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | settings-panel: control renders in callout | state | L1 | automated | Sessions page, a Default Model selected | render SettingsPanel Sessions page | a thinking-level control is present inside the Default Model `--severity-info-*` callout |
| F2 | settings-panel: levels filter to model | state | L1 | automated | Default Model whose `supportedThinkingLevels` = `["medium","high"]` selected | open thinking-level dropdown | only `medium`+`high` render (no other level) |
| F3 | settings-panel: levels re-derive on model change | state-transition | L1 | automated | model A (levels ⊇ `xhigh`) selected, then switch to model B (levels ⊄ `xhigh`) | change Default Model selector | dropdown level set converges to model B's `supportedThinkingLevels`; `xhigh` no longer offered |
| F4 | settings-panel: locked-off, no persist | state-transition | L1 | automated | Sessions page, NO Default Model selected | render, then interact with thinking control | control displays `off`; only `off` selectable; PUT `/api/config` partial contains NO `defaultThinkingLevel`; persisted value stays `""` |
| F5 | settings-panel: selecting a level persists it | state | L1 | automated | Default Model selected; user picks `high` | select `high` in the control | PUT `/api/config` partial includes `defaultThinkingLevel: "high"` |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | bridge: brand-new startup applies both | state-transition | L1 | automated | gate passes; `defaultThinkingLevel === "high"` | `applyDefaultModel()` success branch | `pi.setModel(found)` called AND `pi.setThinkingLevel("high")` called after model resolves, before `sendModelUpdateIfChanged` |
| X2 | bridge: unsupported level clamped by pi, no throw | fault-injection (bad-value) | L1 | automated | resolved model supports only `["off","medium"]`; `defaultThinkingLevel === "xhigh"` | `applyDefaultModel()` success branch | bridge passes `"xhigh"` unchanged to `pi.setThinkingLevel`; no exception thrown by the bridge |
| X3 | bridge: resumed session does not apply level | state-transition (illegal edge) | L1 | automated | session with non-zero message history; `defaultThinkingLevel === "high"` | session start (gate returns false) | neither `pi.setModel` nor `pi.setThinkingLevel` called for the default |
| X4 | bridge: custom-provider-late applies on resolution | state-transition | L1 | automated | default model on a custom provider not yet available at startup; `defaultThinkingLevel === "high"` | provider models arrive → pending retry `applyDefaultModel()` succeeds | `pi.setThinkingLevel("high")` called at the same success branch as `pi.setModel` |

---

## Coverage summary

- Requirements covered: 3/3 modified capabilities (all requirements + scenarios)
- Scenarios by class: edge 5 · perf 0 · frontend 5 · error 4
- Scenarios by level: L1 14 · L2 0 · L3 0
- Scenarios by disposition: automated 14 · manual-only 0

## New infra needed

- none — E1–E5 extend `packages/shared/src/__tests__/config.test.ts`; F1–F5 extend `packages/client/src/components/__tests__/SettingsPanel.test.tsx` + `ThinkingLevelSelector.test.tsx`; X1–X4 extend `packages/extension/src/__tests__/bridge-thinking-level-select.test.ts` / bridge-default-model-gate tests.
