## 1. Shared config: `defaultThinkingLevel` field

- [x] 1.1 Add `defaultThinkingLevel: string` to the config type in `packages/shared/src/config.ts`, with default `""` in the defaults object, mirroring the `defaultModel` field placement and doc comment.
- [x] 1.2 In the config parser (`packages/shared/src/config.ts`), read `defaultThinkingLevel` with a `typeof parsed.defaultThinkingLevel === "string" ? … : defaults.defaultThinkingLevel` guard — exactly the pattern used for `defaultModel` (:1065) so a non-string falls back to `""`. Ensure the sanitizer (:891) passes it through only when a string.

## 2. Bridge: apply the level alongside the default model

- [x] 2.1 In `packages/extension/src/bridge.ts` `applyDefaultModel()`, inside the `setModel(found).then(...)` success callback, read `freshConfig.defaultThinkingLevel` and, when non-empty, call `(pi as any).setThinkingLevel?.(level)` BEFORE `sendModelUpdateIfChanged()`. `pi.setThinkingLevel` is synchronous, so no await ordering is needed. Applying it at this single site covers both the gate call site (:2619) and the pending-provider retry (:2915).

## 3. Settings UI: thinking-level control paired with Default Model

- [x] 3.1 In `packages/client/src/components/settings/SettingsPanel.tsx`, render `ThinkingLevelSelector` inside the Default Model `--severity-info-*` callout beside the Default Model selector; bind `current` to `defaultThinkingLevel` and include `defaultThinkingLevel` in the `PUT /api/config` partial on change (follow the existing `defaultModel` partial wiring).
- [x] 3.2 Derive `supportedLevels` from the selected Default Model's `supportedThinkingLevels` (same lookup as `packages/client/src/components/chat/CommandInput.tsx:847`); when no Default Model is selected, pass `["off"]` so only `off` renders, and make the locked-state `onSelect` a no-op that does NOT add `defaultThinkingLevel` to the partial and does NOT write `"off"` (persisted value stays `""`).

## 4. Tests — folded from test-plan.md (all automated)

- [x] 4.1 L1: `defaultThinkingLevel` defaults to `""` when key absent. Triple: config.json without the key (input) · `loadConfig()` (trigger) · returns `""` (observable). See `packages/shared/src/__tests__/config.test.ts` defaultModel-default test. (test-plan #E1)
- [x] 4.2 L1: set value round-trips. Triple: `{ "defaultThinkingLevel": "high" }` (input) · `loadConfig()` (trigger) · returns `"high"` (observable). See `packages/shared/src/__tests__/config.test.ts:149`. (test-plan #E2)
- [x] 4.3 L1: non-string falls back to `""`. Triple: `{ "defaultThinkingLevel": 3 }` (input) · `loadConfig()` (trigger) · returns `""` (observable). See `packages/shared/src/__tests__/config.test.ts:161`. (test-plan #E3)
- [x] 4.4 L1: partial-merge preserves siblings. Triple: existing config with `port`+`defaultModel`, partial `{ "defaultThinkingLevel": "low" }` (input) · partial merge (trigger) · `defaultThinkingLevel==="low"` AND `port`/`defaultModel` unchanged (observable). See `packages/shared/src/__tests__/config.test.ts:718`. (test-plan #E4)
- [x] 4.5 L1: empty level → bridge does not call setThinkingLevel. Triple: gate passes with `defaultThinkingLevel===""` (input) · `applyDefaultModel()` success (trigger) · `setModel` called, `setThinkingLevel` NOT called (observable). See `packages/extension/src/__tests__/bridge-thinking-level-select.test.ts`. (test-plan #E5)
- [x] 4.6 L1: control renders inside the Default Model callout. Triple: Sessions page with a Default Model selected (input) · render (trigger) · thinking-level control present in the info callout (observable). See `packages/client/src/components/__tests__/SettingsPanel.test.tsx`. (test-plan #F1)
- [x] 4.7 L1: levels filter to the selected model. Triple: model with `supportedThinkingLevels=["medium","high"]` selected (input) · open dropdown (trigger) · only `medium`+`high` render (observable). See `packages/client/src/__tests__/ThinkingLevelSelector.test.tsx`. (test-plan #F2)
- [x] 4.8 L1: levels re-derive when the model changes. Triple: model A (has `xhigh`) → model B (no `xhigh`) (input) · change Default Model selector (trigger) · dropdown converges to model B's levels, `xhigh` gone (observable). See `packages/client/src/components/__tests__/SettingsPanel.test.tsx`. (test-plan #F3)
- [x] 4.9 L1: locked-off with no model persists nothing. Triple: no Default Model selected (input) · render + interact with control (trigger) · displays `off`, only `off` selectable, PUT partial has NO `defaultThinkingLevel`, persisted stays `""` (observable). See `packages/client/src/components/__tests__/SettingsPanel.test.tsx`. (test-plan #F4)
- [x] 4.10 L1: selecting a level persists it. Triple: Default Model selected, pick `high` (input) · select in control (trigger) · PUT partial includes `defaultThinkingLevel:"high"` (observable). See `packages/client/src/components/__tests__/SettingsPanel.test.tsx:418`. (test-plan #F5)
- [x] 4.11 L1: brand-new startup applies both model and level. Triple: gate passes, `defaultThinkingLevel==="high"` (input) · `applyDefaultModel()` success (trigger) · `setModel(found)` then `setThinkingLevel("high")` called before `sendModelUpdateIfChanged` (observable). See `packages/extension/src/__tests__/bridge-thinking-level-select.test.ts`. (test-plan #X1)
- [x] 4.12 L1: unsupported level clamped by pi, bridge does not throw. Triple: model supports `["off","medium"]`, `defaultThinkingLevel==="xhigh"` (input) · `applyDefaultModel()` success (trigger) · bridge passes `"xhigh"` unchanged to `setThinkingLevel`, no bridge exception (observable). See `packages/extension/src/__tests__/bridge-thinking-level-select.test.ts`. (test-plan #X2)
- [x] 4.13 L1: resumed session applies neither model nor level. Triple: non-zero message history, `defaultThinkingLevel==="high"` (input) · session start, gate false (trigger) · neither `setModel` nor `setThinkingLevel` called for the default (observable). See bridge-default-model-gate tests. (test-plan #X3)
- [x] 4.14 L1: custom-provider-late applies level on resolution. Triple: default model on a not-yet-available custom provider, `defaultThinkingLevel==="high"` (input) · provider models arrive, pending retry `applyDefaultModel()` succeeds (trigger) · `setThinkingLevel("high")` called at the same success branch as `setModel` (observable). See `packages/extension/src/__tests__/bridge-thinking-level-select.test.ts`. (test-plan #X4)

## 5. Docs

- [x] 5.1 Update the affected directory `AGENTS.md` rows (`packages/shared/src`, `packages/extension/src`, `packages/client/src/components/settings`) per the Documentation Update Protocol, noting the new `defaultThinkingLevel` field and its bridge/UI wiring with a `See change:` marker.
