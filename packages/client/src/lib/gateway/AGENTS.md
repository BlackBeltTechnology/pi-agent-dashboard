# DOX — packages/client/src/lib/gateway

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `gateway-api.ts` | Client fetch helpers for the Gateway surfaces. Exports `getBlockEvents`, `runEnrollStep`, `getConfig`,… → see `gateway-api.ts.AGENTS.md` |
| `gateway-config-ops.ts` | Pure config-mutation helpers for the Gateway UI. Exports `isSecureBaseUrl`, `appendPublicBaseUrl`… → see `gateway-config-ops.ts.AGENTS.md` |
| `gateway-endpoints.ts` | Two-QR transport split + endpoints fetch. Exports `isPairingEligible` (scheme-authoritative, tls tag… → see `gateway-endpoints.ts.AGENTS.md` |
| `gateway-providers.ts` | Client provider matrix metadata. Exports `GatewayProviderId`, `GATEWAY_PROVIDERS` (zrok/ngrok public;… → see `gateway-providers.ts.AGENTS.md` |
| `gateway-setup.ts` | Per-provider setup-step model (D3 taxonomy). Exports `SetupStepKind`… → see `gateway-setup.ts.AGENTS.md` |
