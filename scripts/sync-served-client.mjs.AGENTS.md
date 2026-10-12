# sync-served-client.mjs — index

Resolves the served destination via the SERVER's `resolveStaticClientDir` (jiti) and mirrors the fresh `packages/client/dist` into it when they differ (superseded assets pruned AFTER the copy), then verifies both declarations equal. Refuses non-zero on an undescribed source, a non-client-build destination, EACCES, or a post-copy mismatch; adopts a legacy declaration-less destination; API-only is an explicit success. See change: add-served-build-coherence-and-hash-parity (design D5).
