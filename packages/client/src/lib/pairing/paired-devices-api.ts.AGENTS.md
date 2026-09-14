# paired-devices-api.ts — index

Client fetch helpers for the paired-devices registry. Exports `listPairedDevices()`, `revokePairedDevice(id)`, `createPairedDevice(label)` (`POST /api/paired-devices` → `MintedDeviceToken` = `{device, token}` unwrapped from `data`; plaintext-once), `PairedDeviceView` (carries `source: "pairing" | "manual"`). Hits `GET` + `POST` + `DELETE /api/paired-devices*`. See change: add-server-keypair-pairing, mcp-legacy-clients-and-token-issuance.
