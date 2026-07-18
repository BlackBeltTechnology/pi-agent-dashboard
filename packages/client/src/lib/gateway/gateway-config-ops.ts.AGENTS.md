# gateway-config-ops.ts — index

Pure config-mutation helpers for the Gateway UI. Exports `isSecureBaseUrl`, `appendPublicBaseUrl` (full-object write preserving siblings; shallow-overwrite hazard for `pairing`), `addTrustedNetwork`/`removeTrustedNetwork`, `suggestTrustEntries` (exact `/32` default + wider mesh/LAN subnet, `wide` flag). https/wss gate is UX-only; server read-time filter is authoritative. See change: add-tunnel-providers.
