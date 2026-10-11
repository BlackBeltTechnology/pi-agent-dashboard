# local-credential-proof.ts — index

Pure local credential proof primitive (`node:crypto`+`node:net` only). `mintProof`/`parseProof`/`verifyProofMac`/`deriveKey`/`canonicalBinding`/`serverCounterProof`/`verifyCounterProof`/`httpPurpose`/`httpProofHeaders`/`localDialHost`/`isLoopbackLiteral`. Grammar `v1.<13 digits>.<22 b64url>.<43 b64url>`; counter-proof `v1.<43>`. Headers `X-Pi-Local-Proof`, `X-Pi-Local-Proof-Server`; env `PI_DASHBOARD_REQUIRE_SERVER_PROOF`. Binding = address literal+port, never a name. Malformed input rejected before any HMAC. See change: loopback-credential-proof (D1).
