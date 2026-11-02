# vault-delivery.ts — index

Vault delivery constants shared by hub + bridge: `VAULT_DELIVERY_FEATURE`, `VAULT_DELIVERED_MARKER_ENV`, `clampVaultGraceHours` (1–168 h, default 24), `VaultDeliveryOutcome`, and the one env-name rule `isDeliverableEnvName`/`isReservedEnvName`. Tests: `__tests__/vault-delivery-protocol.test.ts`. See change: add-credential-vault.

Adds `VaultTrustDetail` (8 trust causes) for the denied-delivery detail. See change: prove-vault-bridge-tls.
