# terminal-cap.spec.ts — index

L3 variant harness (`PI_E2E_SEED=1 PI_E2E_TERMINALS_MAX_CONCURRENT=2 docker/test-up.sh`): two `new-terminal-launch` → 2 tabs; third → `terminal-limit-notice` (`role=status`, "2 terminals are open"), still 2 tabs; close one + `+` → 2 tabs, notice cleared. Skips unless the env is `2`. Needs a dedicated boot (cap is global). See change: harden-server-capability-bounds. Confinement stays seeded off (the spec pins `/fixtures/sample-git` via the picker).
