# acp-session.spec.ts — index

L3: spawn ACP session `qmt` via the folder picker (non-durable host A); driver chip, streamed reply + tool card, pi-only controls (Fork/Resume) absent. Test-plan #F1/#F6 (tasks 7.51, 7.56, 7.71). Harness seeds the fake ACP agents in `docker/test-entrypoint.sh` (`PI_E2E_SEED=1`). Also ended-session row: `POST /api/session/:id/shutdown` → `acp-ended-callout`, no Resume/Fork/Reload/Retry, prompt refused with the start-a-new-session hint, no new card (#F10, task 7.82). See change: add-acp-session-driver.
