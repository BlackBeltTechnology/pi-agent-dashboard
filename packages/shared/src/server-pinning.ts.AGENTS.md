# server-pinning.ts — index

Client-side D8 pinning of the server Ed25519 identity. `fingerprintFromPublicKeyB64`, `verifyNonceSignature`, pure `decidePinnedIdentity` (fingerprint recomputed from the PRESENTED key, then possession), `challengePinnedServer` (fresh nonce per call → no replay; unreachable/non-OK collapse to refusal). See change: add-pi-gateway-transport-identity.
