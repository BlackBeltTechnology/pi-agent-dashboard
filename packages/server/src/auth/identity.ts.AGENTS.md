# identity.ts — index

Persistent Ed25519 server identity (D2, TOFU pinning). `ensureServerIdentity(path?)` generates/loads keypair at `~/.pi/dashboard/identity.key` (0600), reuses across restarts. Exports `ServerIdentity`, `computeFingerprint` (`sha256:<b64url>` over SPKI DER), `signNonce`, `verifyNonceSignature`, `defaultIdentityPath`. Fingerprint = stable identity across URLs. See change: add-server-keypair-pairing.
