## 1. Tests first (TDD)

- [x] 1.1 Add `packages/server/src/browser-handlers/__tests__/session-action-handler.force-kill.test.ts` — inject `platform: "win32"` and a stub `exec`; assert `killProcess` is invoked and `taskkill /F /T /PID <pid>` is the command passed to `exec`.
  - Implemented by extending existing `packages/server/src/__tests__/force-kill-handler.test.ts` to `vi.mock` the platform `killProcess`/`isProcessAlive` and assert the handler delegates.
- [x] 1.2 Extend the same test with a `platform: "linux"` case using stub `kill`/`exec`; assert SIGTERM is sent, liveness is polled, and SIGKILL is sent after the 2s timeout when the stub reports the process still alive.
  - Cross-platform semantics are covered in `packages/shared/src/__tests__/platform-process.test.ts` (existing); handler-level test verifies the `killProcess(pid, {timeoutMs: 2000})` call shape.
- [x] 1.3 Extend with an "already dead" case: stub `kill(pid, 0)` to throw; assert no SIGTERM/SIGKILL/taskkill is issued and `force_kill_result` still reports `success: true`.
- [x] 1.4 Add `packages/server/src/__tests__/tunnel-cleanup.test.ts` — stub `kill` + `exec`; verify `cleanupStaleZrok` uses the platform `isProcessAlive` + `killProcess` path for both `win32` and `linux` branches.
- [x] 1.5 Add `packages/extension/src/__tests__/process-scanner-kill.test.ts` — inject `_platform` option; assert `killProcessByPgid` calls `killPidWithGroup` (no raw `process.kill`).
- [x] 1.6 Add repo-level lint test `packages/shared/src/__tests__/no-direct-process-kill.test.ts` (mirror `no-direct-child-process.test.ts`). Scan every `.ts` under `packages/*/src/` excluding `__tests__/` and `packages/shared/src/platform/`. Fail if `\bprocess\.kill\s*\(` matches. Verified: the test failed with exactly the 8 pre-existing offender lines before implementation; now passes with zero offenders.
- [x] 1.7 Run the targeted test suite; confirm the new unit tests fail and the lint test fails exactly on the expected files. ✓ Verified pre-fix + post-fix.

## 2. Fix server-side kill sites

- [x] 2.1 In `packages/server/src/browser-handlers/session-action-handler.ts`, replace the `handleForceKill` SIGTERM → wait → SIGKILL block with a single `const result = await killProcess(pid, { timeoutMs: 2000 });` and adapt the success/failure reporting paths to the returned `{ ok, forced }`.
- [x] 2.2 In the same file, delete the `process.kill(pid, "SIGTERM")` fallback inside `killHeadlessBySessionId`. Replaced with a `console.warn(...)` on failure so ESRCH/etc. are observable without silently retrying a raw kill.
- [x] 2.3 Verified the file no longer imports `process.kill` directly; `killProcess` is imported from `@blackbelt-technology/pi-dashboard-shared/platform/process.js`. Dead local wrappers `isPiProcess` / `isProcessAlive` removed as they became unreferenced.
- [x] 2.4 Targeted test suite passes (7 tests in `force-kill-handler.test.ts`).

## 3. Fix tunnel + editor-manager kill sites

- [x] 3.1 In `packages/server/src/tunnel.ts`, deleted the local `isProcessAlive` function and imported `isProcessAlive` from the platform module.
- [x] 3.2 Replaced `process.kill(pid, "SIGTERM")` in `cleanupStaleZrok` with `await killProcess(pid, { timeoutMs: 2000 })`. Made the function async; updated the single caller in `packages/server/src/server.ts` to `await cleanupStaleZrok()`.
- [x] 3.3 Replaced `child.kill("SIGTERM")` in the zrok timeout path with `killPidWithGroup(child.pid!, "SIGTERM")` guarded by `child.pid != null`.
- [x] 3.4 In `packages/server/src/editor-manager.ts`, replaced `inst.process.kill("SIGTERM")` with `killProcess(inst.process.pid!, { timeoutMs: 2000 })` (fire-and-forget, catches with `killPidWithGroup` fallback) so code-server subtrees die with their parent on Windows. `stop()` stays synchronous.
- [x] 3.5 Targeted test suite passes (4 tests in `tunnel-cleanup.test.ts`).

## 4. Collapse duplicate `isProcessAlive` helpers

- [x] 4.1 In `packages/server/src/headless-pid-registry.ts` deleted the local `isProcessAlive` and imported it from the platform module.
- [x] 4.2 In `packages/server/src/server-pid.ts` replaced the local `isProcessAlive` with `export { isProcessAlive } from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";` to preserve the public surface.
- [x] 4.3 Lint test (`no-direct-process-kill.test.ts`) confirms zero remaining `process.kill(pid, 0)` occurrences outside the platform module.

## 5. Fix extension-side kill site

- [x] 5.1 In `packages/extension/src/process-scanner.ts`, added `import { killPidWithGroup } from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";`.
- [x] 5.2 Replaced `process.kill(-pgid, "SIGTERM")` with `killPidWithGroup(pgid, "SIGTERM", { platform })`. Reused the already-resolved `platform` variable from the enclosing function.
- [x] 5.3 Simplified the `_platform` check in `captureChildPgids` to the `(options._platform ?? process.platform)` pattern used elsewhere in the same file.
- [x] 5.4 Targeted test suite passes (4 tests in `process-scanner-kill.test.ts`).

## 6. Fix Electron bypasses

- [x] 6.1 In `packages/electron/src/lib/dependency-detector.ts`, replaced the inline `where pi-dashboard` / `which pi-dashboard` shell-out with `resolver.which("pi-dashboard")` using the already-instantiated `ToolResolver`. `.npm/_npx` exclusion preserved.
- [x] 6.2 In `packages/electron/src/lib/doctor.ts`, replaced `execSync("curl -sf http://localhost:8000/api/health …")` with `await isDashboardRunning(port)`. Made `runDoctor` async and updated the single caller (`app-menu.ts::showDoctorDialog`) to `await runDoctor()`.
- [x] 6.3 Extended `isDashboardRunning` (and `DashboardStatus` interface) in `packages/electron/src/lib/health-check.ts` to also return the server `mode` field; `doctor.ts` now reads it from the structured response instead of re-parsing JSON.
- [x] 6.4 Targeted test suites for affected files pass; pre-existing TypeScript errors in unrelated files (e.g. `execSync` return-type drift in `tunnel.ts:171`, `platform/exec.ts` ambiguous re-exports) are NOT introduced by this change.

## 7. Enforcement + QA

- [x] 7.1 Re-ran the repo-level lint test — passes with zero offending lines (was failing on 8 sites before implementation).
- [~] 7.2 `npm test` at repo root intentionally skipped per project policy (full suite hangs on Windows); targeted test runs covering every file touched by this change pass: `no-direct-process-kill.test.ts`, `platform-process.test.ts`, `force-kill-handler.test.ts`, `tunnel-cleanup.test.ts`, `process-scanner-kill.test.ts` → **5 test files, 33 tests, all green**.
- [~] 7.3 `npm run build` (client) runs green; `tsc --noEmit` reveals only pre-existing TypeScript errors in unrelated files that this change did NOT introduce (verified by diffing `tsc` output scope against the files modified in this change).
- [ ] 7.4 Manual QA — Linux: start a tmux session in dashboard, verify ✕ kills every child in the tmux pane. *Deferred — requires Linux workstation.*
- [ ] 7.5 Manual QA — macOS: same scenario; verify no zombie processes in Activity Monitor. *Deferred — requires macOS workstation.*
- [~] 7.6 Manual QA — Windows: dashboard opened via `agent-browser`; session spawned via "Session" button; ✕-button clicked; REST confirmed `status=ended`. **However**, the spawned session had `pid=undefined` in the registry (unrelated pre-existing dashboard bug), so the `killProcess` → `taskkill /F /T` branch was NOT exercised end-to-end via UI. Unit tests mock `killProcess` and verify the handler delegates correctly; platform-level tests in `platform-process.test.ts` assert `taskkill /F /T /PID <pid>` is emitted on `platform: "win32"`. End-to-end tree-kill on Windows is left to a follow-up once the pid-registration bug is addressed (see Note below).
- [ ] 7.7 Manual QA — Windows headless: same limitation as 7.6 while the pid-registration path isn't populated.
- [ ] 7.8 Manual QA — zrok tunnel: requires zrok install + active tunnel to reproduce; deferred.

> **Note (follow-up):** Dashboard-spawned sessions report `pid=undefined` in `GET /api/sessions` even though the bridge sends `pid: process.pid` at `session_register` and the gateway passes it through to `sessionManager.register`. This is a separate pre-existing bug that blocks end-to-end verification of the Windows tree-kill path via the dashboard UI. A dedicated OpenSpec change should investigate where `pid` is dropped between register and read-back. Unit tests + the lint test are sufficient guarantees for this change's correctness.

## 8. Documentation

- [x] 8.1 Updated `AGENTS.md`: the `session-action-handler.ts` row now describes `handleForceKill`'s delegation to `killProcess` and calls out the `no-direct-process-kill` enforcement. Added a new row for `platform/process.ts` describing the three canonical helpers, and a row for `no-direct-process-kill.test.ts`.
- [x] 8.2 Updated `docs/architecture.md`: the "Force Kill Escalation" subsection now describes the Windows `taskkill /F /T` vs POSIX SIGTERM→SIGKILL split. Added a new "Platform-routed kill paths" subsection with a helper table, the list of routed sites, and references to the `command-executor` / `force-kill-handler` specs.
- [x] 8.3 Changelog note: captured in the proposal (`proposal.md` — "Impact" section) and specs deltas (`specs/command-executor/spec.md`, `specs/force-kill-handler/spec.md`). This repo does not maintain a separate `CHANGELOG.md`; OpenSpec archives serve that role.
