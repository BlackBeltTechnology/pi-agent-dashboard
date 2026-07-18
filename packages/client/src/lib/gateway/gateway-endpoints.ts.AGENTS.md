# gateway-endpoints.ts — index

Two-QR transport split + endpoints fetch. Exports `isPairingEligible` (scheme-authoritative, tls tag advisory), `splitEndpoints` (pairing=TLS / link=no-TLS), `guardPairingUrls` (throws on non-TLS in payload, task 8.3), `getGatewayEndpoints`, `GatewayEndpoint`. See change: add-tunnel-providers.
