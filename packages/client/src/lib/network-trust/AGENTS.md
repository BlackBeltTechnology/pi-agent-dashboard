# DOX — packages/client/src/lib/network-trust

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `trust-posture.ts` | `GET /api/health` `trustPosture` read model: `TrustPosture`, `parseTrustPosture(health)` (tolerant; undisclosed/malformed ⇒ `null`), `useTrustPosture()` (one read on mount), browser-safe mirror of shared `resolveTrustMode` (`resolveClientTrustMode`; value import of `shared/config.ts` pulls `node:fs`), `displayTrustMode(config, posture)` (stored → health → `legacy`). See change: retire-trusted-networks-bypass. |
