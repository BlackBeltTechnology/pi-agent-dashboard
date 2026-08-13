## 1. Extension — surface refresh failures (TDD first)

- [x] 1.1 Write `packages/extension/src/__tests__/request-models-refresh-errors.test.ts` (design D6): plain-object registry mock resolving `{ aborted, errors: Map }`, `getAvailable()` returning a non-empty last-known catalogue. Cases: one provider fails, several fail, aborted, clean, refresh resolves `undefined`. Verify the suite FAILS before implementation.
- [x] 1.2 Add a `ProviderRefreshError { provider: string; message: string }` type and extend `models_list` in `packages/shared/src/protocol.ts` + `packages/shared/src/browser-protocol.ts` with optional `refreshErrors?: ProviderRefreshError[]` (omitted, never `[]`, on success).
- [x] 1.3 Route `packages/extension/src/model-list.ts` through `reportRefresh()`; return the provider errors alongside the model list without changing its degraded-not-fatal behavior (last-known catalogue still served).
- [x] 1.4 Attach `refreshErrors` to the `models_list` returned by `request_models` in `packages/extension/src/command-handler.ts`; omit the key entirely when there are none.
- [x] 1.5 Run the 1.1 suite green. Confirm `request-models-refresh-await.test.ts` still passes unmodified (the throw path stays `console.error` + empty list; the errors-map path warns + last-known list — do not unify).

## 2. Client — retire the footer refresh button

- [x] 2.1 Delete the footer refresh button JSX, the `refreshing` state, the `models`-identity clear effect, and the 10s safety-timeout effect from `packages/client/src/components/settings/ModelSelector.tsx`. Keep the open-transition effect and `onRefreshRef`.
- [x] 2.2 Update `packages/client/src/components/__tests__/ModelSelector.test.tsx` (and any StatusBar/composer test asserting the button or busy indicator) to assert the button is absent and that opening the dropdown still fires `onRefresh` exactly once.
- [x] 2.3 Remove now-orphaned i18n keys (`common.refreshingModels` and the refresh-button label) if no other caller uses them.

## 3. Client — render provider refresh failures in the footer

- [x] 3.1 Thread `refreshErrors` from the `models_list` handler into per-session state alongside `modelsMap` (`packages/client/src/App.tsx` + the message handler), clearing it when a later clean `models_list` arrives for that session.
- [x] 3.2 Add an optional `refreshErrors` prop to `ModelSelector` and render a non-blocking footer notice naming every failing provider and stating the last-known list is shown. No notice when the prop is absent/empty. No toast.
- [x] 3.3 Tests: one provider named; multiple providers all named; clean refresh renders no notice; models stay selectable while a notice is shown; no toast is raised.

## 4. Client — extract the neutral `ModelConfigContext`

- [x] 4.1 Rename `packages/client/src/lib/state/OpenSpecRunConfigContext.tsx` → `ModelConfigContext.tsx` (context, provider, hook, and value type renamed accordingly). Leave NO compatibility alias (design D2).
- [x] 4.2 Migrate every consumer: `App.tsx` (provider site), `components/openspec/useOpenSpecRunConfigRow.tsx`, `NewChangeDialog.tsx`, `ProposeDialog.tsx`, `ExploreDialog.tsx`.
- [x] 4.3 Migrate `packages/client/src/test-support/runConfigHarness.tsx` and `components/__tests__/OpenSpecRunConfig.test.tsx`. The suite is the regression guard — its assertions must survive the rename substantively unchanged.
- [x] 4.4 Grep for any remaining `OpenSpecRunConfig` identifier; zero hits outside doc/change history.

## 5. Shared — thinking-level primitive contract

- [x] 5.1 Add `thinkingLevelSelector: "ui:thinking-level-selector"` to `UI_PRIMITIVE_KEYS` and `UiThinkingLevelSelectorProps { current?: string; onSelect: (level: string) => void; supportedLevels?: string[] }` in `packages/shared/src/dashboard-plugin/ui-primitives.ts`, plus the `UiPrimitiveMap` entry.
- [x] 5.2 Add optional `placeholder?: string` to `UiModelSelectorProps`; confirm existing three-prop call sites still type-check.

## 6. Client — shell-bound primitive registrations

- [x] 6.1 Register `ThinkingLevelSelectorPrimitive` in `packages/client/src/main.tsx` — a thin wrapper over the shell's `ThinkingLevelSelector`, forwarding `current`/`onSelect`/`supportedLevels` verbatim. Do NOT derive `supportedLevels` inside the wrapper (design D3).
- [x] 6.2 Replace the bare `ModelSelector` registration with `ModelSelectorPrimitive` — reads `ModelConfigContext` and injects `favorites`, `onToggleFavorite`, `onRefresh`; forwards `current`/`models`/`onSelect`/`placeholder` unchanged.
- [x] 6.3 Guard the no-session case: context absent/undefined → no injected refresh handler, no favorites, dropdown renders the caller's list (spec: "No request without a handler").
- [x] 6.4 Tests: a consumer rendering the primitive with only contract props shows favorite state and fires the shell refresh on open; with no session it renders without error and sends nothing.

## 7. Verify

- [x] 7.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then grep the summary pattern; zero failures.
- [x] 7.2 Typecheck the whole workspace — no plugin call site broken by the contract or context rename.
- [x] 7.3 (manual, worktree — verified `npm run build` clean) Rebuild per the `implement` skill matrix: extension changed → `npm run reload`; shared/server changed → `/api/restart`; client changed → `npm run build` + `/api/restart`.
- [x] 7.4 Manual: open the chat model dropdown — no refresh button, list still refreshes on open. Open a plugin surface consuming `ui:model-selector` (blackhole or automation) — favorite stars present, list refreshes on open.
- [x] 7.5 Manual: with a deliberately broken credential for one provider, open the dropdown — footer names that provider, other models stay selectable, no toast; the extension log names the provider.
- [x] 7.6 Run the `review-code` discipline skill on the diff before commit.

## 8. Docs

- [x] 8.1 Update the directory `AGENTS.md` rows for every touched file (`packages/shared/src/dashboard-plugin/`, `packages/client/src/lib/state/`, `packages/client/src/components/settings/`, `packages/extension/src/`), including the `ModelConfigContext` rename and `See change:` markers.
- [x] 8.2 Delegate any `docs/` prose to the DocScribe subagent in caveman style; main agent applies the returned tree rows.
