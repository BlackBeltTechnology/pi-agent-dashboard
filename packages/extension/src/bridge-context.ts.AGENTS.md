# bridge-context.ts — index

Shared mutable bridge state + pure predicates. Exports `BridgeContext`, `DASHBOARD_NATIVE_COMMANDS`, `filterHiddenCommands`, `isExtensionSlashCommand`, `hasDispatchCommand`, `isHeadlessRpcSession`, `extractFirstMessage`, `extractFirstAssistantReply` (first assistant text, ≤2000 chars, for the auto-name transcript window; see change: add-auto-session-naming), `getCurrentModelString`. Stops 14+ closure vars passing to every extracted fn.
