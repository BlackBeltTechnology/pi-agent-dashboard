# server-proof-probe.ts — index

`probeServerProof(candidateUrl,deps?)`: upgrade handshake with this HOME's proof, verifies counter-proof, terminates before `open` (no frame sent); timeout ⇒ `server-proof-invalid`. `verifyDiscoveredCandidate({healthUrl,candidateUrl,…})` = health AND proof; logs `server identity check failed (server_proof_missing or server_proof_invalid)`. Used as `retargetTo` `verify` in `bridge-handlers/lifecycle.ts`. See change: harden-bridge-inbound-and-discovery (D19).
