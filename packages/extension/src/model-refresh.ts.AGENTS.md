# model-refresh.ts — index

Shared `ModelRegistry.refresh()` handling: `reportRefresh(pending,label)` surfaces abort/per-provider errors and bounds the wait by `REFRESH_TIMEOUT_MS` (10s) so a hung refresh can never block its caller; late rejections swallowed. See change: fix-optimistic-prompt-stuck-sending.
