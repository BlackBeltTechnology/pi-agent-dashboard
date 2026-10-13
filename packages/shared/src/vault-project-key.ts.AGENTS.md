# vault-project-key.ts — index

`normalizeOrigin` (ssh/scp/https forms → `host[:port]/path`; default ports dropped; path case kept; local origins → none), `SessionProject`, `resolveSessionProject` (realpath + `git remote get-url origin`; undefined when unresolvable). Tests: `packages/server/src/__tests__/vault-project-key.test.ts`. See change: add-credential-vault.
