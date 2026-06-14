# Tasks — Fix `PI_DASHBOARD_SPAWN_TOKEN` env leak

## 1. Bridge: capture-once boolean + scrub token

- [x] 1.1 In `packages/extension/src/session-sync.ts`, capture
  `dashboardSpawned` once (module-level / first-register) BEFORE any scrub:
  `const wasDashboardSpawned = !!process.env.PI_DASHBOARD_SPAWN_TOKEN`.
  (Captured on `BridgeState` at bridge activation in `bridge.ts`, persisted
  across reload, exposed as `BridgeContext.dashboardSpawned`.)
- [x] 1.2 Replace the two live reads `dashboardSpawned = !!process.env.PI_DASHBOARD_SPAWN_TOKEN`
  (session-sync.ts) and the one in `bridge.ts` with the captured boolean.
- [x] 1.3 After reading the first-register token (`isFirstRegister` branch),
  `delete process.env.PI_DASHBOARD_SPAWN_TOKEN` so descendants don't inherit it.
- [x] 1.4 Confirm the existing "first register only" + reattach/in-process-change
  behavior is unchanged (token still omitted on every non-first register).
- [x] 1.5 Tests: first register emits token + `dashboardSpawned:true` and scrubs
  env; second register emits no token but still `dashboardSpawned:true`; a child
  process spawned after scrub sees no token and captures `dashboardSpawned:false`.

## 2. Keeper: do not re-inject token on respawn

- [x] 2.1 In `packages/server/src/rpc-keeper/keeper.cjs` `spawnPi()`, after the
  FIRST successful pi launch, `delete env.PI_DASHBOARD_SPAWN_TOKEN` for every
  subsequent respawn (track first-launch state on the keeper).
  (Extracted pure `buildPiEnv` into `keeper-env.cjs`; `piLaunchCount` gates
  first-launch.)
- [x] 2.2 Verify `PI_DASHBOARD_SPAWNED=1` is still set on every (re)spawn so
  source labelling survives respawn via the capture-once boolean.
- [x] 2.3 Keep `PI_KEEPER_PI_ARGS` / `PI_KEEPER_PI_CMD` stripping unchanged.
- [x] 2.4 Tests (keeper suite): first launch env contains the token; simulated
  respawn env omits it; `PI_DASHBOARD_SPAWNED` present in both.

## 3. Cross-entry-point validation

- [x] 3.1 Confirm REST spawn path (`packages/server/src/session-api.ts`) records
  `pendingClientCorrelations` / `pendingForkRegistry` exactly as the WS handler;
  no second injection of a reusable token.
  (REST mints a fresh token per `spawnPiSession`; no reusable injection.)
- [x] 3.2 Confirm `event-wiring.ts` `consume(spawnToken)` now resolves
  `spawnRequestId` on the first worktree register (no stale-token degrade).
  (Code already correct; scrub ensures token arrives exactly once.)

## 4. Spec + docs

- [x] 4.1 Update `spawn-correlation` spec delta (MODIFIED bridge requirement +
  ADDED scrub requirements) — see `specs/spawn-correlation/spec.md`.
- [x] 4.2 Doc-only note on `spawnToken` field in `packages/shared/src/protocol.ts`:
  single-use, scrubbed after first read at keeper + bridge boundaries.

## 5. End-to-end verification

- [ ] 5.1 Spawn an OpenSpec worktree session from the dashboard; placeholder card
  clears the moment the real card registers (not after 30 s). _(Manual live-system
  check — requires running dashboard + worktree spawn; not run in this env.)_
- [ ] 5.2 `grep -nE 'cwd-FIFO fallback for session .* token=[0-9a-f]' ~/.pi/dashboard/server.log`
  shows no new non-empty-token fallback lines after a worktree spawn + respawn.
  _(Manual live-system check.)_
- [ ] 5.3 Subagent/nested-`pi` child registers with `dashboardSpawned:false`, no token.
  _(Manual live-system check.)_
- [x] 5.4 `npm test` green — especially `dashboard-source-decision`,
  `spawn-correlation`, keeper, and `worktree-base-spawn-flow` suites.
