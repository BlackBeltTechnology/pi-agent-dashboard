# server-pinning.ts — index

Client-side D8 pinning of the server Ed25519 identity. `fingerprintFromPublicKeyB64`, `verifyNonceSignature`, pure `decidePinnedIdentity` (fingerprint recomputed from the PRESENTED key, then possession), `challengePinnedServer` (fresh nonce per call → no replay; unreachable/non-OK collapse to refusal). See change: add-pi-gateway-transport-identity.

Client-side D8 pinning of the server Ed25519 identity. `fingerprintFromPublicKeyB64`, `verifyNonceSignature`, pure `decidePinnedIdentity` (fingerprint recomputed from the PRESENTED key, then possession), `challengePinnedServer` (fresh nonce per call → no replay; unreachable/non-OK collapse to refusal). See change: add-pi-gateway-transport-identity. `proveServerIdentity(baseUrl,{timeoutMs})` (no pin: `redirect:manual`, 4 KiB cap, fingerprint recomputed from presented key → `{proven}`/`{refused}`). See change: stabilize-mdns-server-identity.

## harden-peer-address-identity

`classifyProof(proven, {pin, localFp})` → `ok|self|foreign|unverified` (`localFp` proven locally, `"none"` = remote mode, `undefined` = unresolved). Invalid signature ⇒ `foreign`; transport refusal ⇒ `unverified`. See change: harden-peer-address-identity.
