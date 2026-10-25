# Tasks

## 1. Group-aware killProcess (shared)

- [x] 1.1 Write failing L1 tests in `packages/shared/src/__tests__/platform-process.test.ts`. A pid leading a foreign group gets `SIGTERM` to `-pid`. A pid leading our own group, or an unknown own pgid, gets a single-pid kill only.
- [x] 1.2 Write a failing real-process test: `killProcess(leader)` kills a detached leader AND a child that ignores SIGTERM.
- [x] 1.3 Implement `readOwnPgid` (cached for the default exec only) and `leadsForeignGroup`. `killProcess` delegates to `killProcessGroup` on Unix when the pid leads a foreign group.
- [x] 1.4 Make the existing single-pid mock tests model a non-leader (the `-pid` probe gives ESRCH).

## 2. Keeper fallback (server)

- [x] 2.1 Change the failing test in `headless-pid-registry-kill-escalation.test.ts`: after 200 ms the fallback calls `killProcessGroup(keeperPid, { timeoutMs: 2000 })`, even when the keeper is no longer alive.
- [x] 2.2 Replace the `isProcessAlive(keeperPid)` + `killPidWithGroup` fallback in `killEntry` with `killProcessGroup`.
- [x] 2.3 Fix the orphan-cleanup test mock in `headless-pid-registry.test.ts`: the test process does not lead a group.

## 3. Verify

- [x] 3.1 `npm test`: parallel and real-process phases. The only failures are environmental (the gitignored `packages/electron/resources/server` build copy, `hermes-config` upstream drift) and a load flake that passes in isolation.
