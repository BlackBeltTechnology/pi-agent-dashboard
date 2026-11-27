# vault-forwarder.ts — index

`createVaultForwardFilter(masker)`: value-scoped forwarding exception. Masks every `event_forward` on a copy; cumulative snapshots trim a trailing partial value, `assistantMessageEvent.delta` keeps a bounded carry; held tails flush (masked) before any other event; end events supersede. No-op without held values. Installed as `ConnectionManager.outboundFilter`. Tests: `__tests__/vault-forward-exception.test.ts`, `connection-outbound-filter.test.ts` (E28–E30). See change: add-credential-vault.
