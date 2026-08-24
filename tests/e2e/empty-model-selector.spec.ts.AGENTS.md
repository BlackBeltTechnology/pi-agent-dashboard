# empty-model-selector.spec.ts — index

L3 for `open-empty-model-selector`. Proves the harness-feasible slice: composer `model-selector-button` is enabled + opens `model-dropdown` (regression guard for removing `disabled={!hasModels}`), and `/settings/providers` (the empty-state recovery link's destination) renders the `LLM Providers` surface. Genuinely-empty catalogue can't be forced in-harness (populated registry always seeded, per `list-models-registry-ready` V.3) → empty-state body / `awaitingRefresh` gate / reopen-to-retry / thin footer stay unit-proven in `ModelSelector.test.tsx`.
