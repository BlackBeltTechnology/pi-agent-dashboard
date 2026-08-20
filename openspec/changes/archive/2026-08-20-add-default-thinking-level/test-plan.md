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

### Roles — level encoded in the role ref

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| R1 | roles-settings-ui: suffix split/join round-trip | EP + boundary | L1 | automated | refs `"p/m"`, `"p/m:high"`, and a base id containing `:` | `splitRefLevel` then `joinRefLevel` | output === input; only a canonical-level tail is split off |
| R2 | roles-settings-ui: control renders + filters | state | L1 | automated | role picker open; picked model `supportedThinkingLevels` = `["medium","high"]` | render the picker | thinking control present beside the selector; only `medium`+`high` offered |
| R3 | roles-settings-ui: level encoded as suffix | state | L1 | automated | `@planning`, model `anthropic/claude-sonnet-4-5`, level `high` | select the level | pending value === `"anthropic/claude-sonnet-4-5:high"`; no separate level field written |
| R4 | roles-settings-ui: no-override strips suffix | state-transition | L1 | automated | staged `"p/m:high"` | select the no-override option | staged value === `"p/m"` |
| R5 | roles-settings-ui: suffixed ref splits for display | state | L1 | automated | persisted `"anthropic/claude-sonnet-4-5:high"` | render | selector shows the base, control shows `high`, pill NOT dirty |
| R6 | roles-settings-ui: level dropped on unsupporting model | state-transition (illegal edge) | L1 | automated | staged `"p/a:xhigh"`; pick `p/b` whose levels omit `xhigh` | select the model | staged value === `"p/b"` (no suffix) |
| R7 | roles-settings-ui: deferred persistence | state-transition | L1 | automated | role with a persisted model | change ONLY the level | pill dirty AND no `role_set` dispatched until host Save |

### Automation — level suffixed on the `model` field

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| A1 | automation-content-view: direct branch writes suffix | state | L1 | automated | model `anthropic/claude-sonnet-4-5` + level `high` | submit the create dialog | written `model` === `"anthropic/claude-sonnet-4-5:high"` |
| A2 | automation-content-view: role branch has no control | state | L1 | automated | dialog switched to the `@role` branch | render + submit | no thinking control rendered; written `model` is the bare `@role` token |
| A3 | automation-folder-format: resolver passthrough | EP | L1 | automated | `"anthropic/claude-sonnet-4-5:high"`, and `"@planning"` → role ref `"anthropic/claude-sonnet-4-5:high"` | `resolveModel()` | suffixed ref returned verbatim in both cases |
| A4 | automation-folder-format: suffix reaches argv | boundary | L1 | automated | `SessionFlags.model === "p/m:high"` | `sessionFlagsToArgv()` | argv contains `["--model","p/m:high"]` unchanged (fails-on-revert guard for D8) |

---

## Coverage summary

- Requirements covered: 5/5 modified capabilities (all requirements + scenarios)
- Scenarios by class: edge 5 · perf 0 · frontend 5 · error 4 · roles 7 · automation 4
- Scenarios by level: L1 25 · L2 0 · L3 0
- Scenarios by disposition: automated 25 · manual-only 0

## New infra needed

- none — E1–E5 extend `packages/shared/src/__tests__/config.test.ts`; F1–F5 extend `packages/client/src/components/__tests__/SettingsPanel.test.tsx` + `ThinkingLevelSelector.test.tsx`; X1–X4 extend `packages/extension/src/__tests__/bridge-thinking-level-select.test.ts` / bridge-default-model-gate tests; R1–R7 extend `packages/roles-plugin/src/__tests__/RolesSettingsSection.test.tsx`; A1–A2 extend `packages/automation-plugin/src/__tests__/CreateAutomationDialog.test.tsx`; A3 extends the automation model-resolver tests; A4 extends the existing `sessionFlagsToArgv` tests in `packages/shared`.
