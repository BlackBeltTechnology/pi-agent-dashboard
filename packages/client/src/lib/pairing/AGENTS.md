# DOX — packages/client/src/lib/pairing

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `__tests__/knock.test.ts` | `knockServer` flow: fingerprint pin, poll, response-fingerprint verify, every result branch. See change: add-lan-knock-pairing. |
| `__tests__/knock-format.test.ts` | `groupConfirmCode`, `confirmCodeAriaLabel`, `formatCountdown`. See change: add-lan-knock-pairing. |
| `__tests__/pairing-api-request.test.ts` | `requestAccess(name?)` same-origin knock + typed refusal result. See change: add-lan-knock-pairing. |
| `__tests__/pairing-approval-api.test.ts` | `approvePending(..., tier?)` sends the tier; `PendingPairing` knock fields decoded. See change: add-lan-knock-pairing. |
| `__tests__/paired-devices-api.test.ts` | F5 (test-plan, mcp-legacy-clients-and-token-issuance): `createPairedDevice("cli")` POSTs once to `/api/paired-devices` with body `{label:"cli"}` and unwraps `{device, token}` from `data`; non-success envelope throws. Mocked `fetch`, sibling layout of `single-encoder.test.ts`. |
| `__tests__/describe-user-agent.test.ts` | E7: UA → label table (Chrome/Win "Chrome 140 on Windows", Safari/iPhone, Firefox/Linux, Edge/Win, Electron "pi-dashboard app", empty/junk "Unknown browser"). See change: add-pairing-approval-dialog. |
| `describe-user-agent.ts` | Dependency-free UA → label. `describeUserAgent(ua)` (dialog Browser row; Chrome major only), `deviceNameFromUserAgent(ua)` (versionless name prefill). Token matching only — never echoes raw UA; junk → "Unknown browser". See change: add-pairing-approval-dialog. |
| `device-auth.ts` | Paired-device bearer store + consumption for the browser (web-client analogue of shell `connect.ts`). → see `device-auth.ts.AGENTS.md` |
| `knock.ts` | `knockServer(baseUrl, expectedFingerprint, name, hooks)` — challenge → fingerprint pin → knock → poll → verify the response fingerprint against the pin. Result union `approved` \| `identity_mismatch` \| `refused` \| `rejected` \| `expired` \| `cancelled`. Takes an explicit `baseUrl` so native + cross-origin consumers (`add-electron-server-windows`) reuse it. See change: add-lan-knock-pairing. Now re-exports shared `pairing-knock-client` with the WebCrypto prover. See change: add-electron-server-windows. |
| `knock-format.ts` | Pure knock display helpers: `groupConfirmCode` ("4821 7730"), `confirmCodeAriaLabel` (digit-by-digit for screen readers), `formatCountdown`. See change: add-lan-knock-pairing. |
| `pair-protocol.ts` | Browser device-pairing wire helpers (port of shell `protocol.ts` handshake bits used by `PairLanding`). → see `pair-protocol.ts.AGENTS.md` |
| `paired-devices-api.ts` | Client fetch helpers for the paired-devices registry. Exports `listPairedDevices()`,… → see `paired-devices-api.ts.AGENTS.md` |
| `pairing-api.ts` | Operator pairing fetch helpers. Exports `getPairPayload()` (`GET /api/pair/payload`;… → see `pairing-api.ts.AGENTS.md` |
| `pairing-approval-api.ts` | Approval-dialog fetch helpers: `listPending()` (`GET /api/pair/pending`, throws on transport/non-2xx), `approvePending(pendingId, confirmCode, label?)` → `ApprovePendingOutcome` (server outcomes resolve, mismatch carries `attemptsLeft`; transport throws), `denyPending(pendingId)`, type `PendingPairing`. `PendingPairing` gains `provenance`/`requesterName`/`unencrypted`; `approvePending(..., tier?)` forwards the operator's tier choice. See change: add-lan-knock-pairing. Separate from `pairing-api.ts` (eager entry via Gateway) so it rides the lazy host chunk — `mdi-chunk-size` entry gzip cap. See change: add-pairing-approval-dialog. |
| `pairing-approval-store.ts` | Per-tab `PairingApprovalStore` (`subscribe`/`getState` for `useSyncExternalStore`; `setPending`, `dismiss`, `review`) + singleton `pairingApprovalStore`. State `{pending, dismissed, preferred}`; written by `PairingApprovalHost`, read by Gateway `WaitingDevices`. See change: add-pairing-approval-dialog. |
| `pairing-qr.ts` | Pairing payload ↔ QR/copy-string codecs. Exports `encodePayloadString` (bare `pi:pair:v1.<b64>` copy-string,… → see `pairing-qr.ts.AGENTS.md` |
