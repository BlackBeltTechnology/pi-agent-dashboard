# DOX — packages/client/src/lib/pairing

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
| `__tests__/paired-devices-api.test.ts` | F5 (test-plan, mcp-legacy-clients-and-token-issuance): `createPairedDevice("cli")` POSTs once to `/api/paired-devices` with body `{label:"cli"}` and unwraps `{device, token}` from `data`; non-success envelope throws. Mocked `fetch`, sibling layout of `single-encoder.test.ts`. |
|------|---------|
| `device-auth.ts` | Paired-device bearer store + consumption for the browser (web-client analogue of shell `connect.ts`). → see `device-auth.ts.AGENTS.md` |
| `pair-protocol.ts` | Browser device-pairing wire helpers (port of shell `protocol.ts` handshake bits used by `PairLanding`). → see `pair-protocol.ts.AGENTS.md` |
| `paired-devices-api.ts` | Client fetch helpers for the paired-devices registry. Exports `listPairedDevices()`,… → see `paired-devices-api.ts.AGENTS.md` |
| `pairing-api.ts` | Operator pairing fetch helpers. Exports `getPairPayload()` (`GET /api/pair/payload`;… → see `pairing-api.ts.AGENTS.md` |
| `pairing-qr.ts` | Pairing payload ↔ QR/copy-string codecs. Exports `encodePayloadString` (bare `pi:pair:v1.<b64>` copy-string,… → see `pairing-qr.ts.AGENTS.md` |
