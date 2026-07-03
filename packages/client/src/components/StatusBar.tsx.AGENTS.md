# StatusBar.tsx — index

Forwards favorites + onToggleFavorite props to ModelSelector. See change: enrich-model-selector-capabilities-favorites. Passes current model `supportedThinkingLevels` to `ThinkingLevelSelector` (lookup by `${provider}/${id}` === model). See change: adopt-pi-071-072-073-features. See change: refresh-model-selector-models — onRefreshModels prop forwarded to ModelSelector onRefresh.
