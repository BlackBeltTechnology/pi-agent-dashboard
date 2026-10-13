# acp-spawn-picker.spec.ts — index

L3: spawn picker WAI-ARIA menu button (chevron, menu, menuitemradio, arrows/Enter/Escape focus return) and per-folder agent memory across reload. Seeded agents: pi + 4. Test-plan #F9-#F11 (tasks 7.83/7.84). Harness seeds the fake ACP agents in `docker/test-entrypoint.sh` (`PI_E2E_SEED=1`). Also layout at 375/900/1440 with the 'Claude Agent' name (#F13, 7.85), worktree dialog preselect + create label (#F14, 7.86), goal link picker pi-only + hidden-ACP count with a served goal list (#F15, 7.89; folder route is base64url). See change: add-acp-session-driver.
