# DOX — packages/client/src/lib/gateway

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `gateway-action.ts` | Pure config algebra for the "add gateway URL" action (D12/D13). Exports `validateGatewayDraft` (scheme drives eligibility: `http://` needs a trusted network and can be neither QR-paired nor OAuth; ≥1 auth mode mandatory), `buildGatewayAddPatch` (ONE patch carrying `publicBaseUrls` + `cors.allowedOrigins` + `auth.redirectBaseUrl` iff oauth + `trustedNetworks` iff trusted-network + the `gateways[]` provenance record — atomicity is structural), `buildGatewayRemovePatch` (reverts only recorded values STILL EQUAL in live config), `computeGatewayStatus` (read-only; trusted networks checked against the EFFECTIVE merge, top-level ∪ `auth.bypassHosts`), `buildGatewayFixPatch` (delta only, never re-runs add). No I/O. See change: config-override-oauth-redirect-base. |
| `gateway-api.ts` | Client fetch helpers for the Gateway surfaces. Exports `getBlockEvents`, `runEnrollStep`, `getConfig`,… → see `gateway-api.ts.AGENTS.md` |
| `gateway-config-ops.ts` | Pure config-mutation helpers for the Gateway UI. Exports `isSecureBaseUrl`, `appendPublicBaseUrl`… → see `gateway-config-ops.ts.AGENTS.md` `suggestTrustEntries` now reads the SHARED well-known-range table; the module re-exports the reachability predicate for client callers. See change: warn-unreachable-trusted-networks. |
| `gateway-endpoints.ts` | Two-QR transport split + endpoints fetch. Exports `isPairingEligible` (scheme-authoritative, tls tag… → see `gateway-endpoints.ts.AGENTS.md` |
| `gateway-providers.ts` | Client provider matrix metadata. Exports `GatewayProviderId`, `GATEWAY_PROVIDERS` (zrok/ngrok public;… → see `gateway-providers.ts.AGENTS.md` |
| `gateway-setup.ts` | Per-provider setup-step model (D3 taxonomy). Exports `SetupStepKind`… → see `gateway-setup.ts.AGENTS.md` |
