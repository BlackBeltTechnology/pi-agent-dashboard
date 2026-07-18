# session-sync.ts — index

Session register/replay/switch lifecycle. Exports `sendStateSync`, `replaySessionEntries`, `handleSessionChange`. First register tagged `registerReason:"spawn"` (scrubs single-use `PI_DASHBOARD_SPAWN_TOKEN`); reconnects tagged `"reattach"`. Sends commands_list, flows_list, models_list, providers_list, git_info_update. Delegates to `detectSessionSource`, `gatherGitInfo`, `buildProviderCatalogue`.
