## Why

Two model-picking gaps remain after `upgrade-model-selector-primitives`. The Automation plugin's settings page still takes its default model (the fallback for unresolved `@role` refs) as a free-text `provider/model-id` input, so typos are silently accepted and only surface as a failed run. And the three pickers on the core Settings pages (Sessions → Default Model, Model Proxy → add model, Model Proxy → alias target) render the raw `ModelSelector` without `favorites` / `onToggleFavorite`, so a user who has starred models in the composer sees only inert outline stars there (nothing filled, clicking does nothing, **★ Favs** yields an empty list) — even though those pages already sit inside `ModelConfigProvider`, where favorites are global (not session-scoped) state.

## What Changes

- **Favorites become the `ModelSelector` default, not an opt-in.** When a caller passes neither `favorites` nor `onToggleFavorite`, the component reads both from `useModelConfigOptional()`. If a caller passes either, it owns the pair (no mixing with context). When neither props nor context resolve a toggle handler, the selector hides the ★ buttons and the **★ Favs** filter and ignores a persisted favs-only state (today it renders inert stars and can filter to an empty list). All three core Settings pickers gain working favorites with no call-site edits.
- `ModelSelectorPrimitive` is unchanged — it keeps injecting favorites per the `plugin-ui-primitive-registry` spec (the injection is now redundant but harmless).
- **Automation settings default model uses the picker.** `AutomationSettings` replaces the `<input type="text">` with the `ui:model-selector` primitive over the roles plugin's `models` config — the same source `CreateAutomationDialog` already uses — read reactively so the list fills in when the roles config arrives after mount. Strict picker plus a clear (×) affordance so `""` ("no default model") stays reachable. A stored value not in the catalogue (including a legacy `provider/id:level` typed in free text) still displays as `current` until re-picked or cleared; the picker itself cannot emit a `:level` suffix (accepted — the fallback's thinking level is not otherwise exposed). With an empty catalogue the default model cannot be set until models load (accepted regression vs free text). `data-testid="automation-default-model"` wraps the picker (no current consumers; kept as the stable hook).
- **Runtime gains `usePluginConfigOf(pluginId)`** — a reactive read of another plugin's config (`useSyncExternalStore` over the module config store; works anywhere, never throws — unlike `usePluginConfig`). Needed because the roles catalogue lives in the roles plugin's config and only a non-reactive `getPluginConfig` is public today.
- Blackhole `ChainEditor` free-text `provider` / `id` is **not** in scope — owned by `blackhole-model-picker-chains`.
- No server, shared-package, or extension changes; no persisted-shape change (`defaultModel` stays a `provider/model-id` string).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `model-selector`: MODIFIED "Selector SHALL provide a favorites filter and star toggles" — favorites SHALL be sourced from the model-config context when not passed as props, so every in-provider surface (including the Settings pages) shows working star toggles; explicit props override; no resolvable favorites → no stars, no Favs filter, favs-only state ignored.
- `automation-content-view`: ADDED "Default model is chosen through the shared model picker" — sits beside the existing "Default run visibility setting" requirement for the same settings section; strict picker, clearable, reactive to the catalogue arriving. (`automation-run-lifecycle` "Model resolution at spawn time" is untouched.)

## Impact

- `packages/client/src/components/settings/ModelSelector.tsx` — context fallback for `favorites` / `onToggleFavorite`; gate ★ / Favs / favs-only filtering on a resolved toggle handler.
- `packages/dashboard-plugin-runtime/src/plugin-context.tsx` (+ `index.ts` export) — new `usePluginConfigOf(pluginId)`.
- `packages/automation-plugin/src/client/AutomationSettings.tsx` — primitive picker replaces text input; i18n `defaultModelPlaceholder` copy becomes a picker placeholder (`zh-CN` / `hu` parity).
- Tests: `ModelSelector.test.tsx` (fallback, ownership, no-source gating, favs-only ignored), new `AutomationSettings.test.tsx` (wrap in `withUiPrimitiveProvider`, picker emits `provider/id`), runtime test for `usePluginConfigOf`.
- Docs: `docs/plugin-ui-primitives.md` "Shell-bound registrations" block for `ui:model-selector` (favorites now inherited by the component itself; drop the stale "context absent without a session" framing — `App.tsx` always provides `modelConfig`, only `models`/`setModel`/`refreshModels` are session-gated); `AGENTS.md` rows for the touched files.
- Depends on existing `useModelConfigOptional`, `ui:model-selector`, and the roles plugin's `models` config payload.

## Discipline Skills

- `review-code` — non-trivial client change before commit.
- Not triggered: `security-hardening` (no new untrusted input; the picker narrows input), `performance-optimization`, `observability-instrumentation`, `doubt-driven-review` (reversible UI change, no migration or public API).
