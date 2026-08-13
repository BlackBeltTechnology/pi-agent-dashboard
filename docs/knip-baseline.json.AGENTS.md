# knip-baseline.json — index

(repo root) Knip dead-code baseline. Per-class counts measured 2026-08-13: files 10, exports 227, types 189, duplicates 11, enumMembers 0 (total 437).
Debt ceiling, not target. Read by `scripts/knip-ratchet.mjs`.
Per-class on purpose: scalar total lets deleted file pay for two new dead exports.
Raising class rejected by `knip-ratchet.mjs --check-baseline-diff <ref>`; lowering always allowed. Missing file = hard error, never implicit adoption of current counts. See change: add-knip-dead-code-oracle.
