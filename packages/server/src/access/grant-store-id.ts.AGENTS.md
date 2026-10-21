# grant-store-id.ts — index

`~/.pi/dashboard/grant-store-id` token naming the grant store. `ensureGrantStoreId` exclusive-create (`O_EXCL`, 0600, 128-bit hex, never overwritten); `readGrantStoreId` re-read on every `dashboard_identity` announce (event-wiring `onSessionRegistered`); `announceableGrantStoreId(env)` withholds it when `PI_ACCESS_GRANTS_STORE` is set (the bridge would not read that store). Bridge offers Always allow only when its local copy equals. See change: ask-agent-file-access-in-chat.
