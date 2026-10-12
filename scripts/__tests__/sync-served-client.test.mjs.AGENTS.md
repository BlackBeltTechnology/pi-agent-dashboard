# __tests__/sync-served-client.test.mjs — index

E15/E16/X3/X4: the `sync-served-client.mjs` outcome table over temp dirs — no-op (dest == source, source must be described), mirror+verify incl. superseded-asset removal, legacy adopt, API-only success, undescribed/malformed source refusal, non-client-build refusal, EACCES refusal with no partial write, and a post-copy mismatch reported as refusal (injected `copyTree` skips the declaration). See change: add-served-build-coherence-and-hash-parity.
