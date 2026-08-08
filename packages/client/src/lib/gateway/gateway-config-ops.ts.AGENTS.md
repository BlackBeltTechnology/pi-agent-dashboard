# gateway-config-ops.ts — index

Pure config-mutation helpers for the Gateway UI. Exports `isSecureBaseUrl`, `resolvePublicBaseUrls` (top-level `publicBaseUrls` first, legacy `pairing.publicBaseUrls` fallback), `appendPublicBaseUrl(config, url, {allowInsecure})` (writes the TOP-LEVEL list, seeded from the legacy key on first write; the SINGLE writer of that list — the gateway action opts out of the https/wss gate for an `http://` gateway so the two callers cannot drift), `addTrustedNetwork`/`removeTrustedNetwork`, `suggestTrustEntries` (exact `/32` default + wider mesh/LAN subnet, `wide` flag). https/wss gate is UX-only; server read-time filter is authoritative. See change: add-tunnel-providers.

See change: config-override-oauth-redirect-base (D7/D12 — key promotion + single writer).
