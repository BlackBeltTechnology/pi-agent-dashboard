# __tests__/knip-ratchet.test.mjs — index

Per-class dead-code ratchet (test-plan #R1-#R6). Load-bearing case is #R2: a scalar total lets one deleted file pay for two new dead exports, so the count falls while the codebase worsens — one test pins that a total gate cannot distinguish the inputs while the per-class gate catches it. Also: a raised baseline is rejected while lowering is allowed, a missing baseline fails loudly rather than adopting current counts, and the enforcer imports only `node:` builtins (offline). See change: add-knip-dead-code-oracle.
