# acp-permission.spec.ts — index

L3: ACP permission request renders a select prompt (Allow once / Deny); Allow resumes the turn. Agent `qmt-perm` (fake agent `permission` knob). Test-plan #F3 (task 7.53). Harness seeds the fake ACP agents in `docker/test-entrypoint.sh` (`PI_E2E_SEED=1`). See change: add-acp-session-driver.
