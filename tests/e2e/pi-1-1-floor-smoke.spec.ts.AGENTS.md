# pi-1-1-floor-smoke.spec.ts — index

Playwright L3 spec. Sets full display prefs, spawns a fresh git session, sends `[[faux:tool-read]]`. Asserts: `src/example.ts` visible; `/api/health` `compatibility` == `{current:"1.1.0", error: undefined}`; first `tool-burst-header` contains a duration (`NNNms` / `N.Ns`). Needs `PI_E2E_SEED=1`. Harness image installs the `docker/Dockerfile` pin. See change: update-pi-core-1-1-adopt-apis (test-plan #F3).
