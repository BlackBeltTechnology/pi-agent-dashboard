# project-trust-headless-spawn.spec.ts — index

L3 spec (test-plan #X4, change: adopt-pi-074-080-features; #F11, change: harden-agent-tool-guards). Dashboard-spawned headless session in an untrusted `.pi/` cwd registers (card `data-session-id`, no stall) and does NOT auto-trust: bridge withholds `not-covered`, pi applies `defaultProjectTrust`. Optional `PI_TRUST_SEED_MARKER` asserts the project extension marker is absent. Opt-in via `PI_TRUST_SEED_CWD` (untrusted-`.pi/` container trust-seed = flagged follow-up); default skips. Decision logic covered by project-trust L1 (T.60-T.68).
