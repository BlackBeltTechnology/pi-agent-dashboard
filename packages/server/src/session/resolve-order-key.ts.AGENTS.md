# resolve-order-key.ts — index

Resolves `sessionOrder` map key for a session server-side. Exports `resolveOrderKey(session, pinnedDirectories, platform)` wrapping shared `resolveSessionGroupPath` so every order-map mutation keys worktree sessions by parent-repo path the client reads.
