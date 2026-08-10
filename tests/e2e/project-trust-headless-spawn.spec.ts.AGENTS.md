# project-trust-headless-spawn.spec.ts — index

L3 spec (test-plan #X4, change: adopt-pi-074-080-features). Dashboard-spawned headless session in an untrusted `.pi/` cwd reaches idle (bridge auto-trust, no stall). Opt-in via `PI_TRUST_SEED_CWD` (untrusted-`.pi/` container trust-seed = flagged follow-up); default skips. Decision logic covered by project_trust L1 (E5/X1/X3).
