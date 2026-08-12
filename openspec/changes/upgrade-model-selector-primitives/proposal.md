## Why

The `ui:model-selector` primitive exposes only `{ current, models, onSelect }`, so every plugin surface that uses it (blackhole chain editor, automation editor) gets a degraded selector: no favorites, no star toggle, and — because `onRefresh` is not part of the contract — no model-list refresh at all. There is no thinking-level primitive whatsoever, so plugins that need one fall back to a free-text input that cannot know which levels a model actually supports.

Separately, the shell's model dropdown carries a manual footer refresh button that duplicates the auto-refresh already fired on the open transition, and `refreshAndListModels` discards pi 0.84's `ModelsRefreshResult`, so a provider that failed to refresh is indistinguishable from a clean refresh — the user sees a stale list and no reason why.

## What Changes

- **Add a `ui:thinking-level-selector` primitive key** with contract `{ current, onSelect, supportedLevels? }`, registered to the shell's real `ThinkingLevelSelector` so plugins inherit its per-model level filtering (`max` opt-in, `FALLBACK_LEVELS`) by construction rather than by copy.
- **Register `ui:model-selector` as a shell-bound wrapper** (precedent: `ToolCallStepPrimitive`, `ThinkingBlockPrimitive`) that injects `favorites`, `onToggleFavorite`, and `onRefresh` from shell state. The plugin-facing contract stays `{ current, models, onSelect }` plus an optional `placeholder` — plugin surfaces gain favorites and refresh with no prop drilling and no per-plugin wiring.
- **Remove the model dropdown's footer refresh button** and its `refreshing` spinner state. The open-transition auto-refresh effect is retained and is now the single refresh trigger. No user-visible capability is lost.
- **Surface refresh failures.** `refreshAndListModels` routes through the existing `reportRefresh()` helper so each failing provider is named in the logs, and `models_list` gains an optional `refreshErrors?: Array<{ provider, message }>` rendered in the dropdown footer slot the button vacated ("couldn't reach openai — showing last known list"). Absent on a clean refresh; a failed refresh remains degraded, not fatal — the last-known catalogue is still served.

## Capabilities

### New Capabilities

None. This change extends three existing capabilities.

### Modified Capabilities

- `plugin-ui-primitive-registry`: adds the `ui:thinking-level-selector` key and its contract to the frozen key set and contract map; specifies that a primitive registration MAY be a shell-bound wrapper that supplies session-scoped props absent from the public contract.
- `model-selector`: the dropdown's manual footer refresh control is removed (auto-refresh on open becomes the sole trigger); the footer renders per-provider refresh failures when the bridge reports them.
- `model-refresh`: `request_models` SHALL inspect `ModelsRefreshResult` and report `aborted` plus each provider error rather than discarding the result; `models_list` carries those provider errors to the browser.

## Impact

- `packages/shared/src/dashboard-plugin/ui-primitives.ts` — new key, new `UiThinkingLevelSelectorProps`, `UiPrimitiveMap` entry, optional `placeholder` on `UiModelSelectorProps`.
- `packages/shared/src/protocol.ts`, `packages/shared/src/browser-protocol.ts` — optional `refreshErrors` on `models_list` (additive; absent on success).
- `packages/client/src/main.tsx` — two bound primitive registrations.
- `packages/client/src/components/settings/ModelSelector.tsx` — delete footer button + `refreshing` state; render `refreshErrors`.
- `packages/extension/src/model-list.ts` — route through `reportRefresh()`; propagate provider errors.
- `packages/extension/src/command-handler.ts` — attach `refreshErrors` to the returned `models_list`.
- Consumers that gain parity for free: `packages/blackhole-plugin`, `packages/automation-plugin`.
- No breaking changes: every added prop and protocol field is optional.

## Discipline Skills

- `review-code` — non-trivial change across shared contracts, shell, and extension; run before commit.
- `observability-instrumentation` — the change adds a new runtime-failure surface (provider refresh errors) that must be legible in both logs and UI.
