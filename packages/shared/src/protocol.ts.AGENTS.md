# protocol.ts — index

Extension↔Server WebSocket protocol. `ExtensionToServerMessage` + `ServerToExtensionMessage` unions. → see `protocol.ts.AGENTS.md` `EventForwardMessage.replay?: true`; `SessionRegisterMessage.leafEntryId?` + `liveTailOpen?`. See change: fix-large-session-resume-replay.

`certValidation?: "enforced"` on `SessionRegisterMessage` + `VaultSyncRequestMessage`; `VaultSnapshotMessage.trustDetail?`. See change: prove-vault-bridge-tls.
