# Tasks — fix-bridge-autostart-port-resolution

## 1. Ground truth — reconfirm before changing anything

- [x] 1.1 Reconfirm `packages/shared/src/config.ts:641-648` still supplies `port: 8000` / `piPort: 9999` via `DEFAULT_DASHBOARD_PORT` / `DEFAULT_GATEWAY_PORT` in `DEFAULTS`, and that `loadConfig()` at `packages/extension/src/bridge.ts:834` is what feeds `autoStartServer` (called unconditionally at `bridge.ts:3177`).
- [x] 1.2 Reconfirm `packages/extension/src/server-auto-start.ts` health-checks `config.port` (step 2) and then calls `launchServer(config)` (step 3) — i.e. the launch inherits the misresolved port; note step 1 mDNS discovery shields mDNS-healthy hosts and the harness disables it via `PI_DASHBOARD_NO_MDNS`.
- [x] 1.3 Reconfirm `resolveDashboardPort()` at `packages/extension/src/command-handler.ts:1132-1155` is the only env-port reader in the extension (the server's own `buildConfig` at `packages/server/src/cli.ts:146-158` reads the same env for its bind and is out of scope), and that the server injects only `PI_DASHBOARD_URL` / `PI_DASHBOARD_SOCKET` into spawned sessions (`packages/server/src/spawn-process/process-manager.ts:252`) — `DASHBOARD_PORT` reaches sessions via container env, not via the server.
- [x] 1.5 Reconfirm the guard-composition surface: `shouldRefuseWorktreeAutoStart` keys on the RESOLVED ports (`packages/extension/src/autostart-guard.ts`), `shouldSuppressAutoStart` gates the same launch step, and the single-flight lock (`autostart-lock.ts`) serialises it — the new pinned-endpoint gate composes beside them without changing their semantics.
- [x] 1.4 Reproduce the split brain: bring up the harness, and confirm BOTH the harness port and `8000` answer `/api/health` inside the container while `server.pid` names the `8000` process.

## 2. Tests first (red)

- [x] 2.1 Resolver unit tests (see `packages/shared/src/__tests__/config.test.ts`): env wins over config; config wins over defaults; defaults when neither; `""`/`"abc"`/`"0"`/negative env values are ignored rather than shadowing config; first var of a role wins. Assert against every branch, not just the happy path. (test-plan #E2)
- [x] 2.2 Auto-start unit test (see `packages/extension/src/__tests__/server-auto-start.test.ts`): with the env naming a non-default port and a dashboard answering there, `launchServer` is NEVER called. (test-plan #E1)
- [x] 2.3 Auto-start unit test (see `packages/extension/src/__tests__/connection-suppress-auto-start.test.ts`): a session whose env carries `PI_DASHBOARD_URL` or `PI_DASHBOARD_SOCKET` skips the launch step entirely while discovery/health-check still run — both cells. (test-plan #X1)
- [x] 2.4 Warning test (see `packages/extension/src/__tests__/server-auto-start.test.ts`): discovery finding a dashboard elsewhere than the silent resolved port warns naming both ports, and no launch happens. (test-plan #X5)
- [x] 2.5 Verify each test FAILS before the fix (mutation-check the resolver: revert precedence and confirm 2.1 goes red — a resolver test that passes either way is worthless). VERIFIED: precedence flip → red, revert → green; pre-impl run: 15 red / 128 green.
- [x] 2.6 Dead-parent pinned-session test (see `packages/extension/src/__tests__/server-auto-start-guarded.test.ts` + `autostart-guard.test.ts`): with a pinned env and nothing answering, `launchServer` is still not called and the durable log gains a line naming the pinned endpoint. (test-plan #X2)
- [x] 2.7 Attach-without-launch log test: health check succeeding on the resolved port attaches AND the durable log names the port + records that no launch happened. (test-plan #X3)
- [x] 2.8 Port-conflict log test: `portConflict` emits the notify warning AND a durable log line naming the port, with no launch. (test-plan #X4)

## 3. Implementation

- [x] 3.1 Add the shared port resolver (env → `config.json` → `DEFAULT_DASHBOARD_PORT`/`DEFAULT_GATEWAY_PORT`) as a separate export in `packages/shared/src/config.ts`; HTTP: `PI_DASHBOARD_PORT` then `DASHBOARD_PORT`; gateway: `PI_DASHBOARD_PI_PORT` then `PI_GATEWAY_PORT`; parse exactly as today (`Number(v)` finite > 0, first var of a role wins); do NOT touch `loadConfig()`.
- [x] 3.2 Point `resolveDashboardPort()` in `command-handler.ts` at the shared resolver (delete the private copy) and correct its stale doc comment (the server injects only the URL/socket pins), so the two paths cannot drift.
- [x] 3.3 Use the resolver for the ports the bridge passes to `autoStartServer` (health check + `server-launcher.ts` launch); `loadConfig()` call site unchanged.
- [x] 3.4 Skip the launch step (only) for a session whose env carries `PI_DASHBOARD_URL` or `PI_DASHBOARD_SOCKET` — discovery/health-check still run so the session attaches to its pinned parent (gate placement per design.md D3).
- [x] 3.5 Make every non-launch path loud and greppable: `appendAutoStartLog` lines naming the ports for pinned-skip, attach-without-launch, and port-conflict; warn naming both ports when discovery finds a dashboard elsewhere than the silent resolved port (design.md D6).

## 4. Verify

- [x] 4.1 `npm test` green. RESULT: 16976 passed / 0 failed (1514 files). Also fixed a suite-hermeticity leak the new pinned gate exposed: dashboard-spawned sessions run npm test with PI_DASHBOARD_URL/SOCKET set → scrubbed in shared setup-home-perfile.ts. NB run it via a normal shell: a sandbox that overrides `TMPDIR` makes `resource-activation-*` fail spuriously (HOME-vs-`os.tmpdir()` classification), which is a harness artifact, not a regression.
- [x] 4.2 Harness: exactly ONE dashboard answers `/api/health` inside the container after startup + a spawned session. REPRO PRE-FIX: both 18931 AND 8000 answered, server.pid named the 8000 process. POST-FIX: un-pinned session attaches (log: attached … no launch), 8000 connection-refused, server.pid unchanged.
- [x] 4.3 `tests/e2e/faux-text.spec.ts` passes — the canary. Do not believe any other E2E verdict until it does. (test-plan #X7)
- [x] 4.4 Run the two specs that were blocked by this: `tests/e2e/notify-min-level.spec.ts` (#F15/#F16, authored but never executed) and `tests/e2e/notify-channel.spec.ts`, then tick tasks 2.33/2.34 of the archived `gate-notify-rows-by-level` change. RESULT: min-level 3/3 green; channel 3/4 — #F6 red on a PRE-EXISTING retention gap (gateway heartbeat GC removes force-killed sessions after 180s, contradicting the spec's retained-card premise; sessions/heartbeat code untouched by this change) — surfaced, needs its own change.
- [x] 4.5 Confirm a normal default-port install is unaffected (env absent, `config.json` carries the port).
- [x] 4.6 `npx openspec validate fix-bridge-autostart-port-resolution --strict`.
- [x] 4.7 Harness smoke: after startup the harness port answers `/api/health` AND `:8000` inside the container connection-refused — exactly one dashboard (test-plan #X6). Extend the existing health-check loop in `docker/test-entrypoint.sh` (see `:571-580`).
