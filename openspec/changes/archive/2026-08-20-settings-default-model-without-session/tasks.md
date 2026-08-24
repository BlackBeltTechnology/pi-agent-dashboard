# Tasks — settings-default-model-without-session

Test tasks are folded from `test-plan.md`; the manifest is the source of truth for
automated-vs-manual. Exemplar pointers name the nearest existing test to copy harness glue from.

## 1. Shared mapper

- [x] Add a pure `catalogueRowToModelInfo` mapper in `packages/shared/src/`, beside `ModelInfo` in `types.ts`: take `provider` from the row's `provider` field, derive bare `id` by stripping the `"<provider>/"` prefix, set `vision` to `input?.includes("image")` preserving `undefined`, pass `reasoning` + `contextWindow` through, omit `metadataSource`, drop `thinkingLevelMap`/`maxTokens`/`cost`, derive no `supportedThinkingLevels`
- [x] Author mapper unit tests — see `packages/shared/src/__tests__/model-id.test.ts` for harness shape (test-plan #E6): row `{provider:"openrouter", id:"openrouter/meta-llama/llama-3-70b"}` · map row · result is `{provider:"openrouter", id:"meta-llama/llama-3-70b"}`
- [x] Mapper test for a provider name containing a slash — same file (test-plan #E7): row `{provider:"my/proxy", id:"my/proxy/some-model"}` · map row · result is `{provider:"my/proxy", id:"some-model"}`, not split on the first slash
- [x] Mapper test for vision true — same file (test-plan #E8): row `input:["text","image"]` · map row · `vision === true`
- [x] Mapper test for vision false — same file (test-plan #E9): row `input:["text"]` · map row · `vision === false`
- [x] Mapper test for an absent `input` slot — same file (test-plan #E10): row with no `input` property · map row · returns normally with `vision === undefined` and does not throw
- [x] Mapper test for field projection — same file (test-plan #E11): row carrying `thinkingLevelMap`, `maxTokens`, `cost`, `reasoning`, `contextWindow` · map row · result keeps `reasoning` + `contextWindow` and carries no `metadataSource`, `supportedThinkingLevels`, `thinkingLevelMap`, `maxTokens`, or `cost`

## 2. Client catalogue API

- [x] Add `packages/client/src/lib/api/models-api.ts` with `fetchModelCatalogue()` returning a discriminated result (`ok` | `unavailable`) so non-2xx, network failure, and a successful empty list are distinguishable; follow the fetch-helper shape in `packages/client/src/lib/api/providers-api.ts`
- [x] Bound the catalogue request with a 10s client timeout that resolves to the `unavailable` result
- [x] Author the 503 fault test — see `packages/client/src/components/__tests__/SettingsPanel.test.tsx` for harness shape (test-plan #X1): `GET /api/models` returns `503 {code:"MODEL_PROXY_RUNTIME_MISSING"}` · render the Sessions settings page · the catalogue-unavailable callout is rendered
- [x] Author the network-failure test — same file (test-plan #X2): fetch rejects with a network error · render page · the unavailable callout is rendered, not the empty state
- [x] Author the non-503 status test — same file (test-plan #X3): `GET /api/models` returns `500` · render page · the unavailable callout is rendered
- [x] Author the empty-is-not-an-error test — same file (test-plan #X4): `200 {object:"list", data:[]}` · render page · the empty state is rendered and the unavailable callout is not
- [x] Author the timeout test with fake timers — same file (test-plan #X6): fetch never settles · 10s elapse · the unavailable callout is rendered and the loading state is cleared
- [x] Author the timeout-threshold test with fake timers — same file (test-plan #P1): fetch stub that never resolves · advance timers · the unavailable callout appears at ≤10s plus scheduler tolerance

## 3. Union + two-prop split in App

- [x] Replace the `availableModels` IIFE at `packages/client/src/App.tsx:2350` with two values: `defaultModelOptions` (catalogue ∪ every `modelsMap` list, deduped by `"provider/id"`, session entry winning on collision) and `catalogueModels` (catalogue alone); pass both to `SettingsPanel`
- [x] Author the zero-session union test — see `packages/client/src/components/__tests__/SettingsPanel.test.tsx` (test-plan #E1): catalogue `[A]` with no sessions · build default-model options · options equal `[A]`
- [x] Author the superset union test — same file (test-plan #E2): catalogue `[A]`, session s1 `[B]` · build options · options equal `[A,B]` with length 2 and no duplicate fqid
- [x] Author the collision-precedence test — same file (test-plan #E3): catalogue row `openai/gpt-5` without `name`, session row `openai/gpt-5` with `name:"GPT-5"` and `metadataSource:"catalog"` · build options · exactly one `openai/gpt-5` carrying `name "GPT-5"` and `metadataSource "catalog"`
- [x] Author the env-credentialed reachability test — same file (test-plan #E4): catalogue `[]`, session s1 `[B]` · build options · options equal `[B]`
- [x] Author the multi-session dedupe test — same file (test-plan #E5): catalogue `[A]`, sessions s1 `[A]` and s2 `[A]` · build options · exactly one `A`
- [x] Author the two-prop divergence test — same file (test-plan #E12): catalogue `[A]`, session s1 `[B]` · build both values · proxy options equal `[A]` while default-model options equal `[A,B]`
- [x] Author the union-build perf test — see `packages/client/src/components/__tests__/` timed-test shape (test-plan #P2): catalogue 500 rows × 10 sessions × 200 rows · run the union build 100 times · p95 under 50ms with Set-keyed dedupe and no quadratic blowup

## 4. SettingsPanel wiring

- [x] Accept both props in `packages/client/src/components/settings/SettingsPanel.tsx`; feed the union to the Default Model selector (`:1201`) and the catalogue to `ModelProxySection` (`:1503`)
- [x] Consume the catalogue prop in `packages/client/src/components/settings/ModelProxySection.tsx` at `:133`, `:203`, and the availability pills at `:403`
- [x] Render the catalogue-unavailable callout as a sibling above the Default Model control; do NOT modify `ModelSelector.tsx` (owned by the concurrent `open-empty-model-selector` change)
- [x] Render a loading state for the Default Model control while a catalogue request is in flight, distinct from both the empty state and the unavailable callout
- [x] Author the loading-state test — see `packages/client/src/components/__tests__/SettingsPanel.test.tsx` (test-plan #F1): fetch pending · render the Sessions settings page · the loading state is present and neither the empty state nor the unavailable callout is shown
- [x] Author the loading-clears test — same file (test-plan #F2): fetch pending then resolving `200` non-empty · response arrives · the view converges to rendered options with the loading state gone
- [x] Author the degradation test — same file (test-plan #X5): catalogue fetch fails while session s1 has `models_list` `[B]` · render the Default Model control · options equal `[B]` and the control stays usable

## 5. Refetch triggers

- [x] Hoist a `refetchCatalogue` callback in `SettingsPanel` and thread it into `ProviderAuthSection` (currently rendered with no props at `:1472`) and the custom-provider card; fire it on API-key save, custom-provider save/removal, and OAuth / device-code completion
- [x] Apply last-response-wins when multiple catalogue requests are in flight: the most recently received response replaces the rendered catalogue regardless of request order
- [x] Author the API-key refetch test — see `packages/client/src/components/__tests__/SettingsPanel.test.tsx` (test-plan #X7): API-key save resolves `200` while the registry is still pre-refresh · save succeeds · exactly one new `GET /api/models` is issued from the save response, with no fixed delay or `setTimeout` in the trigger path
- [x] Author the OAuth refetch test — same file (test-plan #X8): OAuth or device-code authorization completes successfully · completion callback fires · a new `GET /api/models` is issued
- [x] Author the provider-removal refetch test — same file (test-plan #X9): custom provider `Q` removed and the save resolves `200` · save succeeds · a new `GET /api/models` is issued and `Q`'s models are absent unless a live session still reports them
- [x] Author the out-of-order response test — same file (test-plan #F3): refetch R1 issued then R2 issued, R2 resolving first and R1 second · both responses land · the rendered catalogue is R1's payload

## 6. End-to-end

- [x] Author the zero-session e2e — see `tests/e2e/settings-field-descriptions.spec.ts` for settings-page harness glue, reading the harness port from `.pi-test-harness.json` (test-plan #F4): docker harness up with no pi session connected · open `/settings/sessions` and the Default Model control · the control is populated, a model can be selected and saved, and a reload shows the saved `defaultModel`
- [x] Author the session-arrives-while-open e2e — same exemplar (test-plan #F5): Settings open with zero sessions, then a pi session connects and pushes `models_list` · session connects · options converge to the union with catalogue rows retained, session rows added, and no duplicate rows

## 7. Manual verification

- [x] Verify the catalogue-unavailable callout reads clearly and sits sensibly beside the Default Model control (test-plan: manual-only)

## 8. Validate

- [x] Run `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` and confirm no failures
- [x] Run `npm run quality:changed` and clear new findings
- [x] Update the nearest directory `AGENTS.md` rows for every new and modified file
