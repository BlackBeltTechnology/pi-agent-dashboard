# automation-identity-restart.spec.ts — index

L3 for automation identity across a restart (test-plan #F1/#F2, change: fix-automation-identity-persistence): seeds `kind` + `automationRun` sidecars out-of-band via Docker exec, restarts the dashboard, and asserts a `visibility:"hidden"` run stays off the board (revealable via the Hidden toggle) while a restored run keeps its `session-card-badge` slot + run name. Prefix-isolated (`e2e-auto-identity`) cleanup on entry/exit.

Row summary (formerly inline in `tests/e2e/AGENTS.md`): L3: automation run identity survives a restart (#F1/#F2).
