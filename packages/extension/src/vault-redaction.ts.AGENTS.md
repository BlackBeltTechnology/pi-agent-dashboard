# vault-redaction.ts — index

`createVaultRedaction`: `tool_result` (deep `content`/`details`/`structuredContent` + chunked latin1 rewrite of `details.fullOutputPath`, only pi-named files in tmpdir), `message_end` (masked copy), `user_bash` (wrapped local ops, UTF-8 `StringDecoder`, tail flush). No-op without held values. Tests: `__tests__/vault-redaction.test.ts` (E23–E27, P1). See change: add-credential-vault.
