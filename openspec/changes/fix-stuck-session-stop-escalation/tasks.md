# Tasks — fix-stuck-session-stop-escalation

## 1. E — Shared tree-kill primitive (TDD)

- [ ] 1.1 Write unit tests for `killProcessTree(pid, opts)` in `packages/shared/src/platform/__tests__/`: descendant BFS from injected `ps -eo pid,ppid,pgid` output, unique-PGID collection, own-PGID exclusion, SIGTERM→wait→SIGKILL ordering, root single-PID fallback, win32 delegation to `taskkill /F /T`, ESRCH swallowed.
- [ ] 1.2 Implement `killProcessTree` in `packages/shared/src/platform/process.ts` (injectable `exec`/`kill`/`platform` seams, second snapshot pass after SIGTERM). Export from platform barrel.
- [ ] 1.3 Add `packages/shared/src/AGENTS.md` row update for `platform/process.ts` (new export, one line).

## 2. E — handleForceKill rewrite (TDD)

- [ ] 2.1 Extend `packages/server/src/__tests__/force-kill-handler.test.ts` with failing tests: (a) PID-reuse guard aborts kill + `success:false` + no signal; (b) no-PID → `findPidByMarker` recovery path; (c) no-PID + no marker → `success:false`, NO `ended` stamp; (d) verify-before-stamp: alive-after-kill → status unchanged + `success:false`; dead → `ended` + broadcast; (e) one structured log line per attempt with outcome field.
- [ ] 2.2 Rewrite `handleForceKill` in `packages/server/src/browser-handlers/session-action-handler.ts`: isPiCommandLine guard → killProcessTree → isProcessAlive verification poll (≤3 s) → conditional `ended` stamp → honest `force_kill_result` → structured log (`force_kill session= pid= outcome= tookMs=`).
- [ ] 2.3 Extend `packages/server/src/__tests__/session-kill-e2e.test.ts` (Unix-only): spawn fake pi with detached child in own PGID; assert force_kill kills BOTH; assert survivor case reports `success:false`.

## 3. D — Client kill-result + stall banner (TDD)

- [ ] 3.1 Write failing client tests: `force_kill_result {success:false}` → error toast + stop-state revert (killing → aborting); `{success:true}` → no toast. Component test for `CommandInput` reset via `resetStopSignal` prop.
- [ ] 3.2 Handle `force_kill_result` in the client message handler (`useMessageHandler` / `useSessionActions`); thread `showToast` + per-session stop-state reset (`resetStopSignal` counter prop into `CommandInput`).
- [ ] 3.3 Write failing tests for stall derivation: `deriveBannerState` returns `stalled` when status `streaming` AND `now - lastActivityAt > 120_000`; clears on activity / non-streaming.
- [ ] 3.4 Implement stall advisory line in `SessionBanner.tsx` (amber, advisory, Stop + Force Stop actions wired to existing senders); 1 s ticker gated on selected streaming session.
- [ ] 3.5 Force Stop emphasis: after 5 s in `aborting` with session still streaming, add emphasized styling + title "Still running — Force Stop kills the process" in `CommandInput.tsx`. Component test.

## 4. B — Bridge abort watchdog (TDD)

- [ ] 4.1 Write unit tests for new `packages/extension/src/abort-watchdog.ts` (fake timers, injected scanner/killer): fires at 10 s only when latch active AND streaming; disarms on agent_end / new prompt / latch clear; one-shot per latch; zero-children no-op; SIGTERM then SIGKILL-after-2 s ordering; win32 per-PID arm.
- [ ] 4.2 Implement `abort-watchdog.ts`; wire `arm()` into bridge `abort()` wrapper after `abortLatch.request(...)`, disarm hooks alongside existing latch-clear sites in `bridge.ts` / `command-handler.ts`.
- [ ] 4.3 Add `packages/extension/src/AGENTS.md` row for `abort-watchdog.ts`.

## 5. Validate & land

- [ ] 5.1 `npm test 2>&1 | tee /tmp/pi-test.log` → grep failures; all green.
- [ ] 5.2 Manual smoke (Unix): session runs `sleep 600` via a signal-ignoring wrapper → Stop → watchdog kills child within ~12 s and turn settles; separately Force Stop a wedged session → verify tree dead (`ps`), card ends, log line present.
- [ ] 5.3 Run CodeRabbit gate: `npx tsx .pi/skills/implement/scripts/review-changes.ts`; fix Critical/Warning.
- [ ] 5.4 Full rebuild + deploy: `npm run build` → `curl -X POST http://localhost:8000/api/restart` → `npm run reload`.
- [ ] 5.5 File upstream pi-mono issue for cooperative abort race (`Promise.race` in `executePreparedToolCall`), linking this change.
