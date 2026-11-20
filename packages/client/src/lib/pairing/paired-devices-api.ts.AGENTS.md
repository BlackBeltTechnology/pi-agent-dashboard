# paired-devices-api.ts — index

Client fetch helpers for the paired-devices registry. Exports `listPairedDevices()`, `revokePairedDevice(id)`, `createPairedDevice(label)` (`POST /api/paired-devices` → `MintedDeviceToken` = `{device, token}` unwrapped from `data`; plaintext-once), `PairedDeviceView` (carries `source: "pairing" | "manual"`). Hits `GET` + `POST` + `DELETE /api/paired-devices*`. See change: add-server-keypair-pairing, mcp-legacy-clients-and-token-issuance.

`createPairedDevice(label, tier, purpose?)`. See change: prove-vault-bridge-tls.

`PairedDeviceView.keyId?`/`companions?`; `RevokedDeviceView`; `listRevokedDevices()` (`{operator:false}` on 401/403 — the viewer-is-operator signal), `restorePairedDevice(id)` / `deleteRevokedDevice(id)` (`404`/`409` ⇒ `unavailable`), `removeCompanion(deviceId, companionId)`, `daysUntilPurge(revokedAt, now)` (ceil, min 1), `REVOKED_RETENTION_DAYS=90`. See change: device-key-mutual-check.
