# Scenario-design gap decisions — harden-bridge-inbound-and-discovery

Hard-gate answers for the spec gaps scenario-design surfaced (stage: design).
Each line: gap → chosen answer (letter refers to the candidate list in the
drafting output). Principle: fail closed, match existing behaviour, prefer the
simpler mechanism. Answers that change a spec are applied to the deltas before
the test plan is folded.

## Bridge / media / electron (B21, B22, R4, B23, B24)

- B-G1 overlapping pauses → deadline = max(existing, new) (never shortens).
- B-G2 invalid limit env values → fall back to the default + log once.
- B-G3 `PI_DASHBOARD_BRIDGE_PROMPT_RATE` format → `"<burst>/<refillPerSec>"`, e.g. `30/10`.
- B-G4 bucket across reconnects → kept per bridge process (reconnect does not refill).
- B-G5 counter-proof refusal causes → `server_proof_missing` (no proof) and `server_proof_invalid` (bad MAC/timeout).
- B-G6 pinned `host:port` normalization → the R2 canonical-origin helper (lowercase, default port, trailing dot, IPv6 brackets).
- B-G7 `maxAudioMb` → 1 MB = 1024² bytes; invalid values fall back to 200 + warn; error shows sizes with one decimal.
- B-G8 normal-use thresholds → assert zero refusals for the replayed peak workload and defaults ≥ 3× peak; numbers filled from task 13.1.
- B-G9 limiter overhead → p99 added < 1 ms per command.
- B-G10 doctor navigation → block any navigation whose URL differs from the doctor page's file URL (reload/hash allowed).
- B-G11 unparseable remote with userinfo → send no origin and build no links.
- B-G12 npx JS entry → `<dirname(execPath)>/node_modules/npm/bin/npx-cli.js`, then `<dirname(execPath)>/../lib/node_modules/npm/bin/npx-cli.js`; else refuse.
