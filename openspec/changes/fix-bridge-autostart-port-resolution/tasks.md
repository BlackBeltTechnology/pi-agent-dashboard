# Tasks — fix-bridge-autostart-port-resolution

## 1. Ground truth — reconfirm before changing anything

- [ ] 1.1 Reconfirm `packages/shared/src/config.ts:572-573` still supplies `port: 8000` / `piPort: 9999` via `DEFAULT_CONFIG`, and that `loadConfig()` at `packages/extension/src/bridge.ts:719` is what feeds `autoStartServer`.
- [ ] 1.2 Reconfirm `packages/extension/src/server-auto-start.ts` health-checks `config.port` and then calls `launchServer(config)` — i.e. the launch inherits the same misresolved port.
- [ ] 1.3 Reconfirm `resolveDashboardPort()` in `packages/extension/src/command-handler.ts:915-936` is the ONLY reader of `PI_DASHBOARD_PORT` / `DASHBOARD_PORT`, and that `server-auto-start.ts` / `server-launcher.ts` / `config.ts` read none of them.
- [ ] 1.4 Reproduce the split brain: bring up the harness, and confirm BOTH the harness port and `8000` answer `/api/health` inside the container while `server.pid` names the `8000` process.

## 2. Tests first (red)

- [ ] 2.1 Resolver unit tests: env wins over config; config wins over defaults; defaults when neither; `""`/`"abc"`/`"0"`/negative env values are ignored rather than shadowing config. Assert against every branch, not just the happy path.
- [ ] 2.2 Auto-start unit test: with the env naming a non-default port and a dashboard answering there, `launchServer` is NEVER called.
- [ ] 2.3 Auto-start unit test: a session flagged as spawned by a known parent skips the launch step entirely.
- [ ] 2.4 Warning test: attempting a second dashboard on a different port emits a warning naming both ports.
- [ ] 2.5 Verify each test FAILS before the fix (mutation-check the resolver: revert precedence and confirm 2.1 goes red — a resolver test that passes either way is worthless).

## 3. Implementation

- [ ] 3.1 Add the shared port resolver (env → `config.json` → `DEFAULT_CONFIG`) in `packages/shared/src/config.ts`; cover the HTTP port and the gateway port.
- [ ] 3.2 Point `resolveDashboardPort()` in `command-handler.ts` at the shared resolver (delete the private copy) so the two paths cannot drift.
- [ ] 3.3 Use the resolver in `server-auto-start.ts` for the health check and in `server-launcher.ts` for the launch.
- [ ] 3.4 Skip the launch step for a session spawned by a known parent server.
- [ ] 3.5 Emit the loud warning when a second dashboard would start on a different port while one is already serving.

## 4. Verify

- [ ] 4.1 `npm test` green. NB run it via a normal shell: a sandbox that overrides `TMPDIR` makes `resource-activation-*` fail spuriously (HOME-vs-`os.tmpdir()` classification), which is a harness artifact, not a regression.
- [ ] 4.2 Harness: exactly ONE dashboard answers `/api/health` inside the container after startup + a spawned session.
- [ ] 4.3 `tests/e2e/faux-text.spec.ts` passes — the canary. Do not believe any other E2E verdict until it does.
- [ ] 4.4 Run the two specs that were blocked by this: `tests/e2e/notify-min-level.spec.ts` (#F15/#F16, authored but never executed) and `tests/e2e/notify-channel.spec.ts`, then tick tasks 2.33/2.34 of the archived `gate-notify-rows-by-level` change.
- [ ] 4.5 Confirm a normal default-port install is unaffected (env absent, `config.json` carries the port).
- [ ] 4.6 `npx openspec validate fix-bridge-autostart-port-resolution --strict`.
