# model-refresh.ts — index

Shared `ModelRegistry.refresh()` handling: `reportRefresh(pending,label)` surfaces abort/per-provider errors and bounds the wait by `REFRESH_TIMEOUT_MS` (10s) so a hung refresh can never block its caller; late rejections swallowed. See change: fix-optimistic-prompt-stuck-sending.

`refreshAfterCredentialsReload(registry,diff)`: touched (added+changed) -> scoped refresh; empty diff (credential-only/removal-only) -> local full `refresh({allowNetwork:false})`. See change: refresh-models-on-provider-change.

`resyncForListModels(registry,{reloadProviders?,signal?})`: `reloadProviders` raced vs `PROVIDERS_RESYNC_TIMEOUT_MS` (5s) + signal (errors warned) → skip refresh if aborted → `reportRefresh(refresh({allowNetwork:false}),"list_models refresh")`. Signal never passed into `refresh`. Never rejects. `toRefreshErrors(result)` → `[{provider,message}]`; `[]` when aborted/absent. See change: list-models-auto-resync.
