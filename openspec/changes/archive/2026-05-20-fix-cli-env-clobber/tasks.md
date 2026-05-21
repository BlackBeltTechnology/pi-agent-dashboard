## 1. The fix

- [x] 1.1 In `packages/server/src/cli.ts:cmdStart`, remove `env: { ...process.env },` from the `launchDashboardServer({ … })` call. The shared primitive already runs `ToolResolver.buildSpawnEnv(process.env)` internally; the caller-override was clobbering the augmented PATH.
- [x] 1.2 Verify the function signature still satisfies `LaunchOptions` type — `env` is optional in the shared primitive's interface (see `packages/shared/src/server-launcher.ts:88` — `env?: Record<string, string | undefined>`).
- [x] 1.3 Confirm no other call site in `cli.ts` exhibits the same pattern. (`cmdStart` is the only daemon-spawn site; `cmdRestart` delegates to `/api/restart` which uses `restart-helper.ts` with its own env handling.)

## 2. Regression-prevention lint

- [x] 2.1 Create `packages/server/src/__tests__/cli-env-no-clobber.test.ts`.
- [x] 2.2 Test reads `packages/server/src/cli.ts` source and searches for the regex `/env:\s*\{\s*\.\.\.process\.env\s*\}/`. Fails when found.
- [x] 2.3 Include a docstring explaining why this anti-pattern is forbidden, with a pointer back to this change.
- [x] 2.4 Confirm the test passes against the fixed cli.ts (i.e. the regex returns zero matches post-fix).

## 3. Verification

- [x] 3.1 Build the monorepo: `cd ~/BB/pi-packages/pi-agent-dashboard && npm run build`. Build must complete clean.
- [x] 3.2 Run unit tests: `npm test 2>&1 | tee /tmp/cli-env-test.log`. All existing tests must pass. New test from §2 must pass.
- [x] 3.3 Manual smoke — verified by user in their environment (was the original reproducer).
- [x] 3.4 `openspec validate fix-cli-env-clobber --strict` clean.

## 4. Cross-references

- [x] 4.1 Cite `unify-server-launch-ts-loader` (archived) — the change that established `launchDashboardServer` as the shared primitive with `buildSpawnEnv` for env handling.
- [x] 4.2 Cite `fix-electron-server-launch-node-bin` (active) — the parallel fix on Electron's side for node-binary selection; demonstrates the pattern for env handling done correctly in `spawnFromSource`.
- [x] 4.3 Cite `dashboard-server` capability spec — constraint C22 (env merge contract).
