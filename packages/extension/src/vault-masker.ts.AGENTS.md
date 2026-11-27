# vault-masker.ts — index

`createMasker(getState)`: exact-occurrence `[REDACTED:<NAME>]` masker. `mask`, `maskAndHold` (splits a trailing proper prefix of a value), `maskDeep` (copy, unchanged subtrees keep identity, `skipKeys`, `hold`). Rebuilds when `version` moves; set only grows. Tests: `__tests__/vault-redaction.test.ts`. See change: add-credential-vault.
