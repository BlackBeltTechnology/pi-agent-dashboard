## 1. Tests first (TDD — red before implementation)

- [x] 1.1 Client unit `packages/client/src/components/__tests__/ModelSelector.test.tsx`: trigger is NOT `disabled` and opens with `models: []`; chevron rendered in the empty state.
- [x] 1.2 Open-transition refresh: opening with `models: []` + an `onRefresh` fires exactly one `request_models` (once per open, not per render); no fire + no throw when `onRefresh` is absent.
- [x] 1.3 `awaitingRefresh` gate: after open (refresh in flight) the popover shows the refreshing body and NO recovery link; after a post-open empty `models_list` the `Open provider settings` link renders.
- [x] 1.4 Reopen-to-retry (D5-B): a post-open empty `models_list` carrying `refreshErrors` shows the `Providers` link and NO inline Retry; close→reopen sends a fresh `request_models`.
- [x] 1.5 Thin partial-failure footer (D1-B): a non-empty list + `refreshErrors` renders `⚠ N provider unavailable` + `Providers` link, names NOT shown; clean refresh renders no footer.
- [x] 1.6 Recovery link activation calls the settings-open navigation callback (mock).
- [x] 1.7 Confirm 1.1–1.6 RED against unmodified source for the right reason (disabled trigger / no link gate / per-provider footer text).

## 2. Client: openable empty selector (specs: model-selector)

- [x] 2.1 `ModelSelector.tsx`: remove `disabled={!hasModels}` and the `hasModels &&` open guard on the trigger; always render the chevron.
- [x] 2.2 Ensure the `reload-models-on-selector-open` open-transition `request_models` fires when `models.length === 0` (it should already; add a test-guarded assertion, no new fire path).
- [x] 2.3 Add an `awaitingRefresh` flag: set true when the open-transition `request_models` is sent; clear on the next `models_list` for the selected session (and on the existing safety timeout).

## 3. Client: empty-state body + recovery link (specs: model-selector)

- [x] 3.1 Empty-state body: while `awaitingRefresh` show the refreshing body; once cleared with an empty list show `No models available` + the `⚙ Open provider settings` link (gear icon, no arrow).
- [x] 3.2 Empty + `refreshErrors` (D5-B): same `⚙ Providers` link, no inline Retry; hint copy notes reopen-to-retry.
- [x] 3.3 Wire the link to the Settings → Providers open path (reuse existing settings-open callback/route; no new route if one exists).

## 4. Client: thin partial-failure footer (specs: model-selector, D1-B)

- [x] 4.1 Replace the per-provider `refreshErrors` footer message with `⚠ {count} provider(s) unavailable` + the `⚙ Providers` link; render only when the list is non-empty AND `refreshErrors` is present.
- [x] 4.2 Remove the provider-name join / per-message rendering from the footer (detail moves to Settings → Providers via `surface-provider-health-in-settings`).

## 5. Verify, review, rebuild

- [x] 5.1 Verify 1.1–1.6 GREEN (`vitest run … ModelSelector.test.tsx`).
- [x] 5.2 Full unit suite green; Biome clean on changed files (`--error-on-warnings`); tsc clean on touched files.
- [x] 5.3 `review-code` pass on the diff (client component change) before commit.
- [x] 5.4 Deploy per rebuild matrix — client `npm run build` DONE (production build green). `POST /api/restart` is a deploy of the shared production instance, left to the operator.
- [x] 5.5 E2E instead of a manual human smoke: `tests/e2e/empty-model-selector.spec.ts` (opt-in `npm run test:e2e` vs the docker harness) proves the harness-feasible slice — the composer trigger is openable + opens the dropdown (regression guard for removing `disabled={!hasModels}`), and the recovery link's destination `/settings/providers` renders the LLM Providers surface. The genuinely-empty catalogue can't be forced in-harness (harness always seeds a populated registry, per `list-models-registry-ready` V.3), so the empty-state body / `awaitingRefresh` gate / reopen-to-retry / thin footer stay unit-proven in `ModelSelector.test.tsx` (20 cases).
