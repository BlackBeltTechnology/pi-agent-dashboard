# reasoning-auto-collapse.spec.ts — index

Playwright E2E for reasoning-auto-collapse-timer. Two tests. Test 1: PATCH `/api/preferences/display {reasoning:true, reasoningAutoCollapseMs:1500}`, send `[[faux:thinking-text]]`, assert `reasoning-body` visible (live block held open) then `toHaveCount(0)` after window; reload → `reasoning-body` count 0 (replay renders collapsed). Test 2: `reasoningAutoCollapseMs:0` → block stays open past 2.5s. Uses `reasoning-block`/`reasoning-body` testids. Needs `PI_E2E_SEED=1`. See change: reasoning-auto-collapse-timer.
