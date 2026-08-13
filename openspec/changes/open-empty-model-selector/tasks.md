## 1. Tests first (TDD — red before implementation)

- [ ] 1.1 Client unit `packages/client/src/components/__tests__/ModelSelector.test.tsx`: trigger is NOT `disabled` and opens with `models: []`; chevron rendered in the empty state.
- [ ] 1.2 Open-transition refresh: opening with `models: []` + an `onRefresh` fires exactly one `request_models` (once per open, not per render); no fire + no throw when `onRefresh` is absent.
- [ ] 1.3 `awaitingRefresh` gate: after open (refresh in flight) the popover shows the refreshing body and NO recovery link; after a post-open empty `models_list` the `Open provider settings` link renders.
- [ ] 1.4 Reopen-to-retry (D5-B): a post-open empty `models_list` carrying `refreshErrors` shows the `Providers` link and NO inline Retry; close→reopen sends a fresh `request_models`.
- [ ] 1.5 Thin partial-failure footer (D1-B): a non-empty list + `refreshErrors` renders `⚠ N provider unavailable` + `Providers` link, names NOT shown; clean refresh renders no footer.
- [ ] 1.6 Recovery link activation calls the settings-open navigation callback (mock).
- [ ] 1.7 Confirm 1.1–1.6 RED against unmodified source for the right reason (disabled trigger / no link gate / per-provider footer text).

## 2. Client: openable empty selector (specs: model-selector)

- [ ] 2.1 `ModelSelector.tsx`: remove `disabled={!hasModels}` and the `hasModels &&` open guard on the trigger; always render the chevron.
- [ ] 2.2 Ensure the `reload-models-on-selector-open` open-transition `request_models` fires when `models.length === 0` (it should already; add a test-guarded assertion, no new fire path).
- [ ] 2.3 Add an `awaitingRefresh` flag: set true when the open-transition `request_models` is sent; clear on the next `models_list` for the selected session (and on the existing safety timeout).

## 3. Client: empty-state body + recovery link (specs: model-selector)

- [ ] 3.1 Empty-state body: while `awaitingRefresh` show the refreshing body; once cleared with an empty list show `No models available` + the `⚙ Open provider settings` link (gear icon, no arrow).
- [ ] 3.2 Empty + `refreshErrors` (D5-B): same `⚙ Providers` link, no inline Retry; hint copy notes reopen-to-retry.
- [ ] 3.3 Wire the link to the Settings → Providers open path (reuse existing settings-open callback/route; no new route if one exists).

## 4. Client: thin partial-failure footer (specs: model-selector, D1-B)

- [ ] 4.1 Replace the per-provider `refreshErrors` footer message with `⚠ {count} provider(s) unavailable` + the `⚙ Providers` link; render only when the list is non-empty AND `refreshErrors` is present.
- [ ] 4.2 Remove the provider-name join / per-message rendering from the footer (detail moves to Settings → Providers via `surface-provider-health-in-settings`).

## 5. Verify, review, rebuild

- [ ] 5.1 Verify 1.1–1.6 GREEN (`vitest run … ModelSelector.test.tsx`).
- [ ] 5.2 Full unit suite green; Biome clean on changed files (`--error-on-warnings`); tsc clean on touched files.
- [ ] 5.3 `review-code` pass on the diff (client component change) before commit.
- [ ] 5.4 Deploy per rebuild matrix — client → `npm run build` + `POST /api/restart`. Manual smoke: start a session with no provider, open the selector (refreshing → empty + link), add a provider in Settings → Providers, reopen the selector, confirm models appear with no respawn.
