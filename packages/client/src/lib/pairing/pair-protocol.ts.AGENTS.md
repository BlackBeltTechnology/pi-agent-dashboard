# pair-protocol.ts — index

Browser device-pairing wire helpers (port of shell `protocol.ts` handshake bits used by `PairLanding`). Exports `postJson<T>(base,path,body)` (envelope unwrap, 10s AbortController timeout), `challengeIdentity(base)` (fresh nonce → `POST /api/pair/challenge` → WebCrypto Ed25519 verify), `IdentityProof`. Caller pins `fingerprint == payload.id`, refuses on mismatch. See change: make-pairing-qr-camera-scannable.
