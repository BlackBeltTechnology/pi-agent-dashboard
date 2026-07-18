# StatusBar.tsx — index

Working-status label ONLY. Renders `Thinking…` / `Generating…` / `Running <tool>…` while `status === "streaming"`; returns null otherwise (keeps resting composer footprint lean, design D4). Props: `{ status, currentTool, streamingText }`.

Retired in change: redesign-prompt-input — the standalone model row (ModelSelector + ThinkingLevelSelector + `actions` slot + `leading` slot) was removed. Model + thinking now render inside the composer toolbar (`CommandInput`); the OpenSpec/Git session-action strip + OpenSpec refresh + View menu relocated to a context strip ABOVE the composer card (App wiring). All model/favorites/thinking/roles props dropped.

Prior history: forwarded favorites + onToggleFavorite to ModelSelector (enrich-model-selector-capabilities-favorites); passed `supportedThinkingLevels` to ThinkingLevelSelector (adopt-pi-071-072-073-features); forwarded onRefreshModels (refresh-model-selector-models) — all now handled by CommandInput.
