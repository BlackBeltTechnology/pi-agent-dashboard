# protocol.ts — index

Extension↔Server WebSocket protocol. `ExtensionToServerMessage` + `ServerToExtensionMessage` unions. → see `protocol.ts.AGENTS.md` `EventForwardMessage.replay?: true`; `SessionRegisterMessage.leafEntryId?` + `liveTailOpen?`. See change: fix-large-session-resume-replay.

`certValidation?: "enforced"` on `SessionRegisterMessage` + `VaultSyncRequestMessage`; `VaultSnapshotMessage.trustDetail?`. See change: prove-vault-bridge-tls.

`PreferencesUpdateExtensionMessage`: `autoNameSessions?` and `claudeSubscriptionCompat?` both optional; senders send the full snapshot, bridge applies each only when boolean. See change: retire-anthropic-messages-bridge.

`FlowsListMessage` + `RequestFlowsRefreshMessage` removed; `BrowserFlowsListMessage` removed from `browser-protocol.ts`. See change: flows-dock-chip-and-panel-actions.
