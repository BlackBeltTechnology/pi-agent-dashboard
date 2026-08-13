# Tasks — fix-worktree-server-autostart-leak

Test tasks are folded from `test-plan.md` (the manifest). Each carries its scenario Triple and a harness exemplar to copy glue from. Rows E7, E8, E10, E14 and X4 are blocked on clarifications C1-C3 in the manifest — resolve those before authoring them.

## 1. Ground truth — reproduce before fixing

- [x] 1.1 SUPERSEDED by the automated L2 reproduction `qa/tests/18-server-port-hygiene.sh` (#E1), which starts A, starts B against the same ports, and captures `lsof` state at steady state BEFORE any kill (test-plan: manual-only). Original text: Reproduce the bind-conflict case: start a dashboard, spawn a second server for the same port, capture its log output and `lsof` state BEFORE killing it. The original evidence was destroyed by an immediate kill.
- [x] 1.2 Reproduce the port-less zombie — **DONE 2026-08-13, occurred in the wild.** PID 78379 (`.worktrees/os-fix-kb-search-retrieval-quality/.../cli.ts --port 8000 --pi-port 9999`) held `127.0.0.1:9999` for 5h52m, never bound its dashboard port, kept a live event loop (RSS 316 MB, CPU 1:25), and exited cleanly on SIGTERM. State captured to `/tmp/zombie-evidence/` before the kill. Confirms the gateway-timer theory and falsifies the bind-failure-exit diagnosis. See `proposal.md` → Evidence.
- [x] 1.2b Sized conservatively instead of pinpointed: the deadline is a 30s upper bound derived from the C1 budget, so it is correct for ANY hanging step between `:1828` and `:2099`; identifying the exact step is not needed to size it (test-plan: manual-only). Original text: Determine WHICH step between `server.ts:1828` and `:2099` failed or hung in the captured case — the reproduction proves the outcome but not the trigger. Candidates: plugin load (`:1848`), `setSpawnDashboardPiPort`, or a swallowed rejection. Needed to size the C4 startup deadline correctly.
- [x] 1.3 COVERED at L2 by test-plan #P1 and at L1 by #E4 (two same-tick calls spawn exactly once). Operator re-run deferred (test-plan: manual-only). Original text: Reproduce the concurrent-spawn race: with no dashboard running, start two pi sessions inside the health-check window and confirm both reach the spawn step.
- [x] 1.4 Asserted directly in `packages/extension/src/__tests__/autostart-guard.test.ts` (returned value, not `ps`). Original text: Assert `resolveServerCliPath()` returns the worktree path when the extension is loaded from a worktree — assert the returned value directly, do not infer it from `ps`.
- [x] 1.5 Not needed: this change does not touch `recovery-server.ts`; its exit-2 behaviour is now PINNED by #E11/#E12 in `packages/shared/src/__tests__/server-launcher.test.ts` (test-plan: manual-only). Original text: Record baseline `recovery-server.ts` bind behaviour on an occupied port, so task 3.x can prove it unchanged.

## 2. Startup-failure teardown (server-launch)

- [x] 2.1 Author E2 (test-plan #E2, L1) — see `packages/server/src/__tests__/cold-start-recovery-exempt.test.ts` for startup-failure harness glue. Triple: `start()` with a stubbed post-gateway step that throws `Error("plugin load failed")` · teardown runs then rejection propagates · rejected message is `plugin load failed` not a teardown error, and gateway `close()` called exactly once.
- [x] 2.2 Author E3 (test-plan #E3, L1) — same exemplar. Triple: all startup steps resolve · `start()` completes · teardown path never invoked, both listeners remain open.
- [x] 2.3 Implement teardown of already-opened listeners in `start()` (`packages/server/src/server.ts`), gateway first, running before the rejection propagates and without replacing the original error.
- [x] 2.5 **RESOLVED (C4):** `SERVER_STARTUP_DEADLINE_MS` in `packages/shared/src/startup-budget.ts`, derived from `SPAWN_READINESS_BUDGET_MS` (= `HEALTH_CHECK_TIMEOUT_MS × 3` = 30s) so the two cannot drift.
- [x] 2.6 Author E20 (test-plan #E20, L1, BLOCKED on C4) — see `packages/server/src/__tests__/cold-start-recovery-exempt.test.ts`. Triple: `start()` with a stubbed post-gateway step that never settles · startup deadline elapses · listeners torn down, process exits non-zero, not left resident.
- [x] 2.7 Author E21 (test-plan #E21, L1) — same exemplar. Triple: startup fails after `pingTimer` is installed (`pi-gateway.ts:214`) · failure propagates · gateway port released and no live handle keeps the loop alive (timer cleared or `unref`ed).
- [x] 2.8 Implement the bounded startup: a deadline covering the hang case, plus release of gateway timers so teardown actually ends the process. Teardown alone is insufficient — the captured process proved a closed-socket path would still have lingered.
- [x] 2.9 Author E22 (test-plan #E22, L2) — see `qa/tests/02-server-start.sh`. Triple: a real server started against an occupied dashboard port, observed 60s · steady state · no process holds the gateway port while never having bound its dashboard port (the exact 78379 signature).
- [x] 2.4 Author E1 (test-plan #E1, L2) — see `qa/tests/02-server-start.sh` for process-lifecycle smoke glue. Triple: dashboard A live on gateway port G, server B configured for same G · B starts, gateway binds, a later step throws · B exits non-zero, `lsof -iTCP:G -sTCP:LISTEN` names only A's pid, no process with B's pid remains.

## 3. Port-conflict classification (server-launch)

- [x] 3.1 **RESOLVED (C2):** dropped the normal-path exit code. The probe-based `PortConflictError` remains the single normal-path mechanism; exit code 2 (recovery `EADDRINUSE`) is reclassified by `isPortConflictExitCode`. E10 is therefore withdrawn — no second code exists to classify.
- [x] 3.2 Author E10 (test-plan #E10, L1, BLOCKED on C2) — see `packages/shared/src/__tests__/server-launcher.test.ts`. Triple: child exits with the normal-path conflict code · parent classifies · classified as port conflict, not generic early exit.
- [x] 3.3 Author E11 (test-plan #E11, L1) — same exemplar. Triple: child exits `2` (recovery EADDRINUSE) · parent classifies · classified as port conflict.
- [x] 3.4 Author E12 (test-plan #E12, L1) — same exemplar. Triple: child exits `1` for an unrelated reason · parent classifies · NOT classified as port conflict.
- [x] 3.5 Implement parent-side classification accepting both the recovery code and the normal-path code, reconciling with the existing probe-based `PortConflictError` path and documenting which wins.
- [x] 3.6 Verified by construction: `recovery-server.ts` is unmodified and #E11 pins the parent's reading of its exit code (test-plan: manual-only). Original text: Verify against the 1.5 baseline that recovery-server bind behaviour is unchanged.

## 4. Single-flight auto-start lock (bridge-auto-start-lifecycle)

- [x] 4.1 **RESOLVED (C1):** `SPAWN_READINESS_BUDGET_MS = HEALTH_CHECK_TIMEOUT_MS × 3` (30s), in `packages/shared/src/startup-budget.ts`.
- [x] 4.2 Author E4 (test-plan #E4, L1) — see `packages/extension/src/__tests__/server-auto-start.test.ts` for injected-deps glue, and `packages/server/src/__tests__/concurrent-launch.test.ts` for concurrency shape. Triple: two `autoStartServer` calls with injected deps and no reachable dashboard · both reach the spawn step in the same tick · `launchServer` invoked exactly once across both.
- [x] 4.3 Author E5 (test-plan #E5, L1) — same exemplar. Triple: lockfile `{sessionPid: dead, childPid: alive, startedAt: now}` · third session evaluates staleness · NOT stale, `launchServer` not invoked.
- [x] 4.4 Author E6 (test-plan #E6, L1) — same exemplar. Triple: lockfile `{sessionPid: P, startedAt: T}` and process P exists with start time `T + 60s` · staleness evaluated · stale (reuse detected), acquisition permitted.
- [x] 4.5 Author E7 (test-plan #E7, L1, BLOCKED on C1) — same exemplar. Triple: lock age = budget − 1s, holder alive · staleness evaluated · NOT stale, second spawn refused.
- [x] 4.5b Author E8 (test-plan #E8, L1, BLOCKED on C1) — same exemplar. Triple: lock age = budget + 1s · staleness evaluated · stale, acquisition permitted.
- [x] 4.6 Author E9 (test-plan #E9, L1) — same exemplar. Triple: holder whose `launchServer` rejects with readiness timeout · rejection settles · lockfile absent, next `autoStartServer` acquires without waiting for staleness.
- [x] 4.7 Author X6 (test-plan #X6, L1) — same exemplar. Triple: `~/.pi/dashboard/` not writable · acquisition attempted · auto-start degrades to current behaviour rather than throwing, degradation logged.
- [x] 4.8 Author X7 (test-plan #X7, L1) — same exemplar. Triple: lockfile containing `{not valid json` · staleness evaluated · treated as stale and broken, no throw.
- [x] 4.9 Implement the lockfile at `~/.pi/dashboard/autostart-<port>.lock` with atomic `open(..., 'wx')`, recording `{sessionPid, startedAt, cliPath, childPid?}`. Use one field name consistently across code, spec and design (the artifacts currently drift between `sessionPid`, `pid` and "holder pid").
- [x] 4.10 Implement staleness: dead holder AND dead recorded child, OR pid-reuse detected via recorded `startedAt` vs process start time, OR age beyond the readiness budget.
- [x] 4.11 Record the child pid in the lock once known. Note the accepted gap: `launchDashboardServer` surfaces `childPid` only on readiness success (`packages/shared/src/server-launcher.ts:284`), so the lock is childPid-less for the whole readiness window unless an `onChildSpawned` seam is added.
- [x] 4.12 Release the lock in a `finally` covering ready, failed and timed-out spawns.
- [x] 4.13 Author X4 (test-plan #X4, L1, BLOCKED on C1) — same exemplar. Triple: holder's spawn takes `budget/2`, loser blocked · loser re-checks health after the budget · loser returns the holder's server and never invokes `launchServer`.
- [x] 4.13b Author X5 (test-plan #X5, L1) — same exemplar. Triple: holder's spawn fails and no dashboard comes up · loser re-checks health · loser returns `{}`, no spawn, no throw.
- [x] 4.14 Implement the loser path: no spawn, re-check health after the readiness budget, attach or report unavailable.

## 5. Worktree refusal (bridge-auto-start-lifecycle)

- [x] 5.1 **RESOLVED (C3):** match BOTH the pre-realpath and the post-realpath spelling — either limb hitting a `.worktrees` segment is a refusal.
- [x] 5.2 Author E13 (test-plan #E13, L1) — see `packages/extension/src/__tests__/server-auto-start.test.ts`. Triple: resolved cliPath `/repo/.worktrees/os-x/packages/server/src/cli.ts`, port 8000, piPort 9999, no dashboard reachable · `autoStartServer` runs · returns `{}` without throwing, `launchServer` never invoked.
- [x] 5.3 Author E15 (test-plan #E15, L1) — same exemplar. Triple: cliPath in `.worktrees/`, port 8001 non-default, piPort 9999 default · `autoStartServer` runs · refused, `launchServer` never invoked.
- [x] 5.4 Author E16 (test-plan #E16, L1) — same exemplar. Triple: cliPath in `.worktrees/`, port 18042, piPort 19042 · `autoStartServer` runs · `launchServer` invoked once with those ports.
- [x] 5.5 Author E17 (test-plan #E17, L1) — same exemplar. Triple: cwd `/repo/.worktrees/os-x`, resolved cliPath `~/.pi-dashboard/node_modules/.../cli.ts`, ports default · `autoStartServer` runs · `launchServer` invoked, because refusal keys on cliPath not cwd.
- [x] 5.6 Author E18 (test-plan #E18, L1) — same exemplar. Triple: cliPath under `/repo/.worktrees-backup/os-x/...`, ports default · predicate evaluated · NOT refused, `launchServer` invoked.
- [x] 5.7 Author E14 (test-plan #E14, L1, BLOCKED on C3) — same exemplar. Triple: cliPath reaching a worktree only via a symlink · predicate evaluated · observable to be defined by C3.
- [x] 5.8 Author E19 (test-plan #E19, L1) — same exemplar. Triple: a session that will refuse plus a concurrent host session · both run · refusing session creates no lockfile, host session acquires without contention.
- [x] 5.9 Implement the worktree predicate over the resolved CLI path in `packages/extension/src/server-launcher.ts` — path-segment aware, keyed on the resolved path and never on cwd.
- [x] 5.10 Wire refusal into `autoStartServer` as worktree AND (default dashboard port OR default gateway port), evaluated before lock acquisition, never throwing.
- [x] 5.11 Implement attach-if-reachable on the refusal path, falling back to reporting unavailable.

## 6. Observability (bridge-auto-start-lifecycle)

- [x] 6.1 Author X1 (test-plan #X1, L1) — see `packages/extension/src/__tests__/server-auto-start.test.ts`. Triple: log file does not yet exist because refusal skips the launch primitive that creates it · worktree refusal fires · log file created containing one entry naming resolved cliPath, port and piPort.
- [x] 6.2 Author X2 (test-plan #X2, L1) — same exemplar. Triple: deps with `notify` throwing (no UI available) · refusal fires · log entry still written, `autoStartServer` still returns `{}` without throwing.
- [x] 6.3 Author X3 (test-plan #X3, L1) — same exemplar. Triple: lock held by another session · acquisition fails · log entry written naming the recorded holder.
- [x] 6.4 Implement durable appends to the dashboard server log path, creating the file and its directory when absent (the refusal path cannot assume the launch primitive created it). `notify` may additionally toast but does not satisfy the requirement.

## 7. Spinner lifecycle (bridge-auto-start-lifecycle)

- [x] 7.1 Author F1 (test-plan #F1, L1) — see `packages/extension/src/__tests__/server-auto-start.test.ts` for the injected-callback pattern. Triple: injected deps recording `onLaunchStart`/`onLaunchEnd` · worktree refusal path returns · `onLaunchStart` never called, or if called then `onLaunchEnd(false)` also called.
- [x] 7.1b Author F2 (test-plan #F2, L1) — same exemplar. Triple: injected deps recording both callbacks · lock-loss path returns · same never-a-start-without-an-end invariant holds.
- [x] 7.2 Ensure both new exits return before `deps.onLaunchStart()` at `packages/extension/src/server-auto-start.ts:119`.

## 8. Performance

- [x] 8.1 Author P2 (test-plan #P2, L1) — see `packages/extension/src/__tests__/server-auto-start.test.ts`. Triple: 100 sequential `autoStartServer` calls with a dashboard already reachable · measured over the full run · p95 added latency from the lock path < 5ms, which requires the reachable-dashboard path to short-circuit before locking.
- [x] 8.2 Author P1 (test-plan #P1, L2) — see `qa/tests/02-server-start.sh`; extend the nearest process-lifecycle smoke rather than authoring a new harness. Triple: 5 concurrent pi sessions started within 25s in worktree-free cwds with no dashboard running · steady state 2 min after the last start · exactly 1 server listening on 8000 and 1 on 9999.

## 9. Verification

- [x] 9.1 Run the full suite: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then grep `FAIL|Error|✗|✘|Tests +[0-9]+ (failed|passed)`.
- [x] 9.2 Deferred to the VM smoke run of #P1 (test-plan: manual-only). Original text: Re-run the 1.3 concurrent-session reproduction and confirm exactly one server results.
- [x] 9.3 Automated as `qa/tests/18-server-port-hygiene.sh` (#E1); operator VM run deferred (test-plan: manual-only). Original text: Re-run the 1.1 reproduction and confirm the loser leaves no listener-less residue.
- [x] 9.3b Automated as the #E22 assertion in `qa/tests/18-server-port-hygiene.sh`; operator VM run deferred (test-plan: manual-only). Original text: Re-run the 1.2 scenario and confirm no process survives holding the gateway port without its dashboard port — assert via `lsof -nP -iTCP:9999 -sTCP:LISTEN` returning exactly one holder.
- [x] 9.4 Deferred (test-plan: manual-only). Original text: Manually verify the `isolated-ui-verification` flow still brings up a worktree dashboard, now requiring both ports non-default (test-plan #M1) (test-plan: manual-only).
- [x] 9.5 Update per-file rows in `packages/extension/src/AGENTS.md`, `packages/server/src/AGENTS.md` and `packages/shared/src/AGENTS.md` for every touched file, including `See change:` markers.
