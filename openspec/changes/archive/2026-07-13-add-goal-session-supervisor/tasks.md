# Tasks — add-goal-session-supervisor

## 1. Types & store (foundation)
- [x] 1.1 Extend `GoalRecord` (`packages/shared/src/types.ts`): `autoRespawn?: boolean`, `respawns?: GoalRespawn[]`, `status` gains `"failed"`; add `GoalRespawn` type. → verify: `tsc --noEmit` clean, shared build passes.
- [x] 1.2 `goal-store.ts`: persist `autoRespawn` + `respawns` (FIFO-capped), make `turnsUsed` cumulative on the record, add `recordRespawn` / `setStatus("failed")`. Legacy `GoalsFile` records load unchanged. → verify: unit test load-old-record + append-respawn cap.
- [x] 1.3 `GoalPluginSettings`: add `autoRespawnDefault` (default off); new goals inherit it. → verify: unit test default inheritance.

## 2. Reuse host session management (no new mechanism)
- [x] 2.1 RENAME `abortAutomationRun` → `abortSpawnedRun` across `dashboard-plugin-runtime/src/server/server-context.ts` (type + field + doc), host wiring in `packages/server/src/server.ts`, and the automation caller (`automation-plugin/src/server/{index,engine}.ts`). Mechanical, no behavior change. → verify: `tsc --noEmit` clean repo-wide; automation stop-run tests still green.
- [x] 2.2 Correlation: capture the `spawnToken` returned by `ctx.spawnSession` in the goal spawn path (`goal-routes.ts` / `spawnGoalSession`) and stamp `goalId` via the host's existing token correlation (`linkByToken` in `event-wiring.ts`), replacing `pendingGoalLinkRegistry.consume(cwd)` as the PRIMARY link path. Keep the host's cwd-FIFO only as its existing legacy fallback. → verify: unit test — same-cwd non-goal session not linked; overlapping goal respawns don't cross-link.
- [x] 2.3 Subscribe the goal server to the death fanout. SUPERSEDED by 9.2/10.1: the supervisor is main-server and rides `dispatchPluginSessionEnded` (not plugin `ctx.onSessionEnded`, which can't reach `GoalStore`). Wired in `server.ts` `dispatchPluginSessionEnded`. → verify: goal-supervisor.test.ts drives death handling directly.

## 3. Supervisor core (`packages/server/src/goal-supervisor.ts`) — goal POLICY only
- [x] 3.1 Classify death (terminal / paused / respawn) per spec; ignore non-current-driver goals. `goal-supervisor.ts` `handleDeath`. → verify: goal-supervisor.test.ts branch tests.
- [x] 3.2 Progress signal. SUPERSEDED by 9.7/10.6: progress = strict `totalTurnsUsed` increase past a persisted per-driver baseline (`currentDriverBaselineTurns`), NOT verdicts (fire-and-forget). Resets counters/backoff on progress. → verify: goal-supervisor.test.ts progress vs no-progress.
- [x] 3.3 Respawn: resume-first. SUPERSEDED by 9.3 — resume via `spawnPiSession({sessionFile, mode:"continue"})` (no `--resume` flag); fresh-fallback after `K=2` no-progress resume-deaths, re-primed via `buildGoalReprime` (objective + criteria + verdict summary). → verify: goal-supervisor.test.ts resume + poison.
- [x] 3.4 Backoff `5s→15s→45s` cap; reset on progress. Note: rapid streaks trip the (window-scoped) breaker at 3 before 45s; 45s reachable when deaths spread beyond the window. → verify: goal-supervisor.test.ts backoff sequence.
- [x] 3.5 Crash-loop breaker: `3` no-progress deaths / rolling `5min` → `status=failed` reason `"crash loop"`; surfaced on chip/board (not push-notified per S12), no further respawn. → verify: goal-supervisor.test.ts trip + progress-prevents-trip.
- [x] 3.6 Abort: `clear`/`pause`/`delete` route through `supervisor.abort` → host kill (`killByToken`/`killBySessionId`, the renamed primitive), terminal-status-first + generation-guarded. In-flight token stashed on the record (`inFlightSpawn`). → verify: goal-supervisor.test.ts abort-in-window + kill-death no-op.
- [~] 3.7 Reaper: CUT for v1 per S9 (a "no turn advance" reaper cannot tell hung from busy-on-a-long-tool → would violate C1). Rely solely on `onUnregister` + boot reconcile.
- [~] 3.8 Restart quiesce: REPLACED by boot-time reconcile per S10 (no server-side deferred-action queue exists; the old server exits first). See 9.10/10.2.

## 4. Budget integration
- [x] 4.1 Route `decideBudgetHalt` off cumulative `totalTurnsUsed` (`max(totalTurnsUsed, live turnsUsed)`) in `server.ts` budget guard; halt applies across respawns. → verify: existing goal-budget-guard.test.ts (pure fn) + wiring.

## 5. Client surfaces
- [x] 5.1 board/detail surface the new states via `statusMeta` (`↻ Respawning`, `✕ Failed`) + board FILTERS include them (the session-card `GoalChip` renders the live snapshot; durable respawn/failed shows on the GoalRecord-driven board/detail). → verify: status-meta.test.ts.
- [x] 5.2 Create/edit form: `autoRespawn` toggle, default from `goal-settings` (localStorage) + `GoalPluginSettings` panel toggle. → verify: GoalForm.test.tsx toggle + default tests.

## 6. Discipline checkpoints
- [x] 6.1 `doubt-driven-review`: design went through 2 adversarial doubt cycles (design.md S1–S12, C2a–C2j). Runaway spend bounded by: opt-in default-off (`autoRespawn`), cumulative `totalTurnsUsed` budget (respawn-proof), crash-loop breaker (3 no-progress/5min → failed), exponential backoff, headless-unavailable disables auto-respawn.
- [x] 6.2 `observability-instrumentation`: supervisor logs every schedule/respawn/breaker-trip/abort (`log()` → `console.error`); state visible on board/detail via `statusMeta` (respawning/failed) + `respawns[]` history on the record.

## 7. Docs
- [x] 7.1 (delegate to docs subagent, caveman style) `packages/server/src/AGENTS.md` row for `goal-supervisor.ts`; update `goal-store.ts` + `event-wiring.ts` + `goal-routes.ts` rows; note the `abortAutomationRun`→`abortSpawnedRun` rename on `server.ts` + `dashboard-plugin-runtime` server-context rows; one-line note in `docs/architecture.md` on host-mechanism / goal-policy split + `See change: add-goal-session-supervisor`.

## 9. Doubt-review corrections (cycle 1: Claude + GPT-5.5) — must land
- [x] 9.1 (S1) `GoalRecordStatus` gains `respawning` + `failed`; real vocab (`pursuing`/`achieved`) throughout; during backoff the goal is `respawning` (supervisor sets it before scheduling the timer), never `pursuing` without a live driver. → verify: goal-supervisor.test.ts (respawning during backoff) + status-meta.test.ts.
- [x] 9.2 (S2) Supervisor is main-server `goal-supervisor.ts` with direct `GoalStore` + `spawnPiSession` (via injected `spawnDriver`), NOT plugin `ctx.onSessionEnded`. Rides `dispatchPluginSessionEnded` (C2a supersedes the raw `onUnregister` hook). → verify: goal-supervisor.test.ts drives the store directly.
- [x] 9.3 (S3) Resume via `spawnPiSession({sessionFile, mode:"continue"})` (sessionFile resolved from the dead `driverSessionId`); NO `--resume` flag. Fresh-spawn fallback when the file is gone (`effectiveReason`). → verify: goal-supervisor.test.ts resume path asserts sessionFile + fresh fallback.
- [x] 9.4 (S4) `goalId` stamped onto the registry entry keyed to the spawn token BEFORE `session_register` (token minted, entry `register(...goalId)`); `getGoalId` is the PRIMARY link. Supervisor spawn failure → paused (`respawn failed`). → verify: headless-pid-registry-goal-id.test.ts (same-cwd non-goal not linked).
- [x] 9.5 (S5) `goalStore.replaceDriver(cwd,id,newSessionId)` sets the new driver even when the dead one is still set + captures a fresh progress baseline. → verify: goal-store.test.ts + goal-supervisor.test.ts.
- [x] 9.6 (S6) Abort ordering: `store.finalize` bumps `generation` + writes terminal status in ONE write, timer cancelled (generation-checked), THEN host kill; stale-generation spawn completion killed. kill-false logged. → verify: goal-supervisor.test.ts abort test.
- [x] 9.7 (S7) Progress = strict `totalTurnsUsed` increase past the persisted `currentDriverBaselineTurns`; a first-seen/zero snapshot is not progress. → verify: goal-supervisor.test.ts progress vs no-progress.
- [x] 9.8 (S8) Breaker counter derives from persisted `respawns[]` (survives restart). → verify: goal-supervisor.test.ts.
- [~] 9.9 (S9) Reaper CUT for v1 (a no-turn-advance reaper can't distinguish hung from busy → would violate C1). Rely on `onUnregister` + boot reconcile.
- [x] 9.10 (S10) Boot-time reconcile (`reconcileOnBoot`), deferred 30s past a reconnect grace window so live drivers re-register first. → verify: goal-supervisor.test.ts orphan reconciled + live-driver untouched.
- [~] 9.11 (S11) Re-prime prompt (`buildGoalReprime`: objective + criteria + verdict summary + budget) DONE. Extension resume/cold-start CAPABILITY probe DEFERRED — open dependency (resume fidelity depends on `@ricoyudog/pi-goal-hermes` restoring in-session loop state); the `headlessAvailable` gate (10.10) disables auto-respawn when the reliable control channel is absent.
- [x] 9.12 (S12) No push notification; `failed` surfaced on board/detail via `statusMeta`. → verify: status-meta.test.ts.
- [x] 9.13 (D8) RENAME chosen (not alias-and-deprecate) — a shared primitive named after one consumer invites reinvention. Mechanical, tsc-clean, automation tests green.

## 10. Doubt-review corrections (cycle 2: GPT-5.5) — must land
- [x] 10.0 (P0, PREREQUISITE) Durable status+progress persistence DELIVERED by the shipped prerequisite `persist-goal-status-and-progress` (archived): `goal-status-projector.ts` + `GoalRecord.lastKnownTurnsUsed/totalTurnsUsed/lastProgressAt` + `goalStore.applyStatus`. This change layers respawn/breaker/budget on top. → verify: goal-status-projector.test.ts.
- [x] 10.1 (C2a) Supervisor rides `dispatchPluginSessionEnded` (added call in `server.ts`); `sessionManager.onUnregister` never reassigned. → verify: full suite (plugin-death dispatch) green.
- [x] 10.2 (C2b) `goalStore.listAll()` + persisted `inFlightSpawn{spawnToken,generation}`; boot reconcile skips a goal with a pending in-flight spawn (no double-spawn). → verify: goal-store.test.ts listAll + goal-supervisor.test.ts.
- [x] 10.3 (C2c) `{goalId}` persisted on the headless-pid registry entry (`HeadlessEntry`+`PersistedEntry`), round-trips restart, consumed by `getGoalId` at register. → verify: headless-pid-registry-goal-id.test.ts restart round-trip.
- [x] 10.4 (C2d) Token minted BEFORE launch, persisted `inFlightSpawn` synchronously, passed into `spawnPiSession`; stale-generation completion kills the returned process by token. → verify: goal-supervisor.test.ts abort + performSpawn stale-gen path.
- [x] 10.5 (C2e) Death gated on the CURRENT `driverSessionId` (`findCurrentDriverGoal`); `linkGoalDriver` clears the OUTGOING driver's in-memory `goalId` on handover so a late snapshot can't project. → verify: goal-supervisor.test.ts non-current-driver ignored.
- [x] 10.6 (C2f) Per-driver baseline captured at link (`currentDriverBaselineTurns`); a missing baseline (restart) is unknown-progress and does NOT count toward the breaker. (Busy-crash-before-first-snapshot within one run counts as no-progress — documented v1 limitation.) → verify: goal-supervisor.test.ts.
- [x] 10.7 (C2g) Breaker counts only no-progress deaths with `at > lastProgressAt` within the 5-min window; progress bumps `lastProgressAt` (the epoch). → verify: goal-supervisor.test.ts progress-prevents-breaker.
- [x] 10.8 (C2h) Abort = single awaited `store.finalize` (generation++ + terminal status) BEFORE kill; the death handler re-reads and no-ops. → verify: goal-supervisor.test.ts kill-death no-op.
- [x] 10.9 (C2i) Status union closed: shared type + REST `VALID_STATUS` + `statusMeta` + board FILTERS + detail (via statusMeta) + tests. Unknown status never renders as Pursuing for the new states. → verify: status-meta.test.ts.
- [x] 10.10 (C2j) `spawnGoalDriver` forces `strategy:"headless"`; `headlessAvailable` gate pauses instead of respawning when headless RPC is unavailable. → verify: goal-supervisor.test.ts headless-unavailable path.

## 8. Verify & ship
- [x] 8.1 tsc `--noEmit` clean; biome no Tier-A errors on changed files (advisory complexity/style warnings only, matching the existing goal-store pattern); full vitest suite green (9880 passed / 0 failed). (`biome --changed` reported 0 files pre-commit; ran the equivalent explicit-path check.)
- [x] 8.2 `openspec validate add-goal-session-supervisor --strict` passes.
- [~] 8.3 Manual smoke DEFERRED to post-merge QA (per ship-change: QA/manual tasks tested later). Automated coverage stands in for each scenario: resume (goal-supervisor.test.ts progress→resume), breaker→failed (breaker test), clear-during-spawn kills + no respawn (abort test), boot reconcile (reconcile tests).
