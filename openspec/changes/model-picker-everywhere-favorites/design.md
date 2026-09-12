## Context

See proposal.md — Why. Relevant current state:

- `ModelSelector` (`packages/client/src/components/settings/ModelSelector.tsx`) takes `favorites?: string[]` and `onToggleFavorite?: (id, makeFavorite) => void` as plain props. The per-row ★ button (`:525`) and the `favs-only-toggle` (`:299`) render **unconditionally**; without the props the stars are inert and `favOnly` (persisted per-browser under one shared `localStorage` key, `:371`) still filters the list (`:424`) — possibly to empty.
- `ModelConfigContext` (`packages/client/src/lib/state/ModelConfigContext.tsx`) exposes `favorites` + `toggleFavorite` (global, not session-scoped — `App.tsx:1338`); `useModelConfigOptional()` returns `undefined` outside a provider (non-throwing). `App.tsx:2398` always provides it; only `models` / `setModel` / `refreshModels` are session-gated.
- `SettingsPanel` renders inside that provider, so the three Settings pickers already have a context in reach — they simply never pass the props.
- Every current caller that passes `favorites` also passes `onToggleFavorite` (`CommandInput`, `useOpenSpecRunConfigRow`, `ModelSelectorPrimitive`); no caller passes one without the other.
- `ModelSelectorPrimitive` (`packages/client/src/lib/plugins/shell-primitives.tsx`) wraps `ModelSelector` for plugins and injects `favorites`, `onToggleFavorite`, `onRefresh`, `onOpenProviderSettings` from context.
- `AutomationSettings` (`packages/automation-plugin/src/client/AutomationSettings.tsx`) renders `<input type="text" data-testid="automation-default-model" placeholder="provider/model-id">` (no test or E2E consumer references that testid today); `CreateAutomationDialog` in the same plugin already uses `useUiPrimitive(UI_PRIMITIVE_KEYS.modelSelector)` with `getPluginConfig("roles").models` as the list — a **non-reactive** read justified there by "the dialog opens after config is populated".
- `dashboard-plugin-runtime` exposes `usePluginConfig()` (own plugin, reactive) and `getPluginConfig(id)` (any plugin, non-reactive). `subscribePluginConfig` exists on the context value but has no public hook.

## Goals / Non-Goals

Goals
- Favorites appear on every selector that renders inside `ModelConfigProvider` without per-call-site wiring.
- Automation default model is a strict pick from the known catalogue.

Non-Goals
- No new picker features, no change to favorites persistence or broadcast.
- No change to what plugins receive from `ui:model-selector` (same props, same behaviour).
- Blackhole `ChainEditor` — owned by `blackhole-model-picker-chains`.

## Decisions

**D1 — Fallback lives in `ModelSelector`, not in each Settings call site.**
`ModelSelector` resolves the pair all-or-nothing: `callerOwns = props.favorites !== undefined || props.onToggleFavorite !== undefined`; when `callerOwns` the props are used as given, else `favorites = ctx?.favorites`, `onToggleFavorite = ctx?.toggleFavorite` from `useModelConfigOptional()`. Per-prop `??` was rejected: a caller passing only `favorites` would pin the display to its own list while ★ clicks fired the context's global handler. It then derives `favoritesEnabled = onToggleFavorite !== undefined` and gates on it: ★ buttons and the Favs toggle render only when enabled, and the `favOnly` filter is applied only when enabled (a stale persisted `favOnly=1` can no longer strand a favorites-less surface on an empty list).
- Alternative A: pass props at the three Settings sites. Rejected — repeats the same wiring and leaves the next new site broken again.
- Alternative B: switch core Settings to `ModelSelectorPrimitive`. Rejected — the primitive is the plugin contract; core using it inverts the shell→plugin direction the docs describe.
- Explicit props win so `CommandInput` / `ModelConfig` callers and tests that pass their own favorites are untouched.

**D2 — `ModelSelectorPrimitive` is left untouched.** Removing its favorites injection was considered (redundant after D1) and rejected: `plugin-ui-primitive-registry` spec explicitly requires the wrapper to supply favorites, so dropping it would need a delta for a purely mechanical gain. The injection is harmless under D1's ownership rule (it passes both props). Note for a later docs pass: that spec's "favorites are session-scoped" clause is already inaccurate (they are global) — out of scope here.

**D3 — Automation reuses the `CreateAutomationDialog` pattern, but reads the roles catalogue reactively.** Same primitive, same `roles.models` list source, same `provider/id` value shape. Unlike the dialog, a settings page can mount before `models_list` / `/api/config` hydration lands, and `AutomationSettings` only re-renders on its *own* config — a one-shot `getPluginConfig("roles")` could leave the picker empty until an unrelated re-render. So the runtime gains `usePluginConfigOf<T>(pluginId)` built on `useSyncExternalStore(subscribePluginConfig(pluginId, …), () => getPluginConfig(pluginId))` — the pattern the runtime already uses (`plugin-context.tsx:331,350`); `getConfig` (`plugin-context.tsx:468`) returns `pluginConfigs.get(id) ?? {}` — a **fresh** `{}` whenever the id has never been set (fresh install before the first `roles_list`/`models_list`, i.e. exactly the cold-load case), which would make `useSyncExternalStore` loop on an unstable snapshot. The hook therefore reads through a frozen module-level `EMPTY_CONFIG` sentinel for the unset case (either by changing `getConfig`'s fallback to that constant — harmless for existing callers — or in the hook's own snapshot). The runtime test MUST cover the never-hydrated id. The hook never throws and needs no provider (module store), unlike `usePluginConfig`. (The seed-then-subscribe shape of `usePluginConfig` was rejected: a broadcast between first render and the passive effect would be missed.) `AutomationSettings` uses it for the catalogue.
- Alternative: keep the non-reactive read and accept the race. Rejected — the fix is ~10 lines and the race is user-visible on cold load.
- `CreateAutomationDialog` is left as-is (surgical); it may adopt the hook later.
- Strict picker: the component has no free-text path, so an unknown stored id simply shows as `current` (`ModelSelector.tsx:584` renders `current ?? placeholder`).
- `data-testid="automation-default-model"` goes on a wrapper `div` around the picker (`ModelSelector` hardcodes its own root testid and exposes no prop). The current `<label className="block">` wrapping (`AutomationSettings.tsx:142`) becomes caption + control **siblings** (as `SettingsPanel.tsx:1567`): a `<button>` trigger inside a `<label>` would open the dropdown on caption click.
- Wire `current={defaultModel || undefined}` — `ModelSelector` renders `current ?? placeholder`, and `""` is not nullish (same normalisation `SettingsPanel.tsx:1570` / `ModelProxySection.tsx:201` use), so the cleared state shows the placeholder.
- A clear (×) button beside the picker sets `defaultModel` to `""` — `resolveModel` treats empty as "no default model configured", a designed state the picker alone cannot reach. `data-testid="automation-default-model-clear"`.
- `:level` suffixes: the picker emits bare `provider/id`. A legacy stored `provider/id:level` still shows as current until re-picked. Pairing a thinking-level control (as the dialog does) was rejected as scope creep — the fallback's level was never surfaced in UI, only reachable by typing.

**D4 — Keep prop names; no new context API.** No `favorites`-specific hook is added; `useModelConfigOptional()` is already the sanctioned optional accessor.

## Risks / Trade-offs

- [Existing tests render `ModelSelector` bare and query `model-fav-toggle` / `favs-only-toggle` without passing `onToggleFavorite`] → with D1 gating those elements vanish; run the suite and pass the handler in tests that exercise favorites. Tests wrapping in `ModelConfigProvider` and expecting inert stars are asserting the old bug — update them.
- [A surface that relied on inert stars being visible] → sweep: only the three Settings pickers omit props today; all are desired targets and will now show *working* stars.
- [Empty roles catalogue (roles plugin off, or before `models_list`) → automation default model cannot be set at all] → accepted regression vs free text; the reactive read (D3) closes the cold-load window, and the selector's empty-catalogue path (refresh + recovery link) covers the rest. Note the recovery link navigates to Settings → Providers, which may drop an uncommitted automation draft — acceptable, same as any navigation away.
- [`AutomationSettings` seeds every field's local state once from `config` (`:48`) and never re-syncs on hydration] → pre-existing for all fields on that page: on a cold mount before hydration the local value stays `""`, the page flips dirty when config arrives, and a Save would commit `""` — wiping the stored fallback. Not introduced here and not fixed here (would need a page-wide re-seed rule); flagged for a follow-up. The "stale value remains visible" scenario is scoped to hydrated config.
- [Model Proxy pickers list only registry-available models] → a favorited model already added to the proxy may not be in that list; the spec scenario is scoped to models present in the picker.
- [Existing automation configs with a typo'd default model] → still displayed as current; user re-picks. No migration needed.

## Migration Plan

Client-only. `npm run build && curl -X POST http://localhost:8000/api/restart`. Rollback = revert the commit; no persisted-shape change.
