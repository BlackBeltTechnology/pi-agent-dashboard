## 1. Pre-flight verification

- [x] 1.1 Confirm `enable-rpc-keeper-by-default` (PR #47) has merged. If still in review, this change MUST wait — the surface it modifies (`killBySessionId` keeper-branch + `keeper.cjs`) is only the production path once that change is in.
- [x] 1.2 Grep current state to confirm the gaps still exist: `rg -n "killPidWithGroup\(piPid|killPidWithGroup\(keeperPid" packages/server/src/headless-pid-registry.ts` should show the SIGTERM-only kills at L357 + L366. `rg -n "piChild" packages/server/src/rpc-keeper/keeper.cjs` should show the keeper's `shutdown()` does not reference `piChild.kill`.
- [x] 1.3 Confirm `killProcess` from `platform/process.ts` already implements the SIGTERM → 2 s → SIGKILL ladder: `rg -n "timeoutMs|SIGKILL|taskkill" packages/shared/src/platform/process.ts`. Should show the ladder in both POSIX and Windows branches.
- [x] 1.4 Identify all call sites of `killBySessionId` so step 3 can update them to `await`: `rg -n "killBySessionId" packages/server/src/`. Expected hits: `headless-pid-registry.ts` (definition + interface), `session-action-handler.ts` (3 callers: `handleShutdown` L523, `handleForceKill` L683, `handleKillProcess`), `server.ts` (shutdown teardown). Any unexpected hit means a new caller has appeared and step 3 needs to widen.

## 2. Escalate `killBySessionId` to SIGKILL via `killProcess`

- [x] 2.1 In `packages/server/src/headless-pid-registry.ts`: import `killProcess` from `@blackbelt-technology/pi-dashboard-shared/platform/process.js` alongside the existing `killPidWithGroup` + `isProcessAlive` imports.
- [x] 2.2 Change the function signature in the `HeadlessPidRegistry` interface: `killBySessionId(sessionId: string): boolean;` → `killBySessionId(sessionId: string): Promise<boolean>;`.
- [x] 2.3 In the keeper-branch (currently L350-377): replace `killPidWithGroup(piPid, "SIGTERM"); killedSomething = true;` with `try { await killProcess(piPid, { timeoutMs: 2000 }); killedSomething = true; } catch { /* pi may already be dead */ }`. Keep the surrounding logic (the `if (piPid !== undefined)` guard and the `entries.delete` / `persist()` at the bottom).
- [x] 2.4 In the keeper-branch's "pi unknown — kill keeper directly" path (currently L370-374): replace `killPidWithGroup(keeperPid, "SIGTERM")` with `await killProcess(keeperPid, { timeoutMs: 2000 })`. This path only fires when pi never registered (bridge never connected); SIGKILL escalation on the keeper here is correct because we have no cleaner shutdown signal to fall back on.
- [x] 2.5 Keep the 200 ms keeper-fallback `setTimeout` as-is (fire-and-forget SIGTERM). The keeper's own SIGTERM handler is reliable; SIGKILL escalation at the registry layer is unnecessary for the happy path.
- [x] 2.6 In the non-keeper branch (legacy entries; currently L380-391): replace `killPidWithGroup(entry.pid, "SIGTERM")` with `await killProcess(entry.pid, { timeoutMs: 2000 })`. The branch is retained for orphan cleanup of pre-`enable-rpc-keeper-by-default` sessions persisted in `headless-pids.json`; the SIGKILL ladder makes it uniform with the keeper path.
- [x] 2.7 Run `rg -n 'killPidWithGroup\(piPid|killPidWithGroup\(entry\.pid' packages/server/src/headless-pid-registry.ts` and confirm zero matches remain (the only `killPidWithGroup` left should be the keeper-fallback 200 ms SIGTERM and `killAll`).

## 3. Update `killBySessionId` callers to await

- [x] 3.1 In `packages/server/src/browser-handlers/session-action-handler.ts::handleShutdown` (L523): `headlessPidRegistry.killBySessionId(msg.sessionId);` → `await headlessPidRegistry.killBySessionId(msg.sessionId);`. The function is already `async`-compatible (registered as an async handler in `browser-gateway.ts`); ensure the function signature is `async` and `void` becomes `Promise<void>` if not already.
- [x] 3.2 In `handleForceKill` (L683): same change. `handleForceKill` is already `async` (it `await`s `killProcess` at L678).
- [x] 3.3 In `handleKillProcess` (the third caller at L138): same change. Confirm the function is `async`.
- [x] 3.4 In `packages/server/src/server.ts` (any shutdown-teardown path that iterates registry entries): if `killBySessionId` is called, await it. If only `killAll` is called there, no change.
- [x] 3.5 Re-run `rg -n "killBySessionId" packages/server/src/` and confirm every non-definition call is `await`ed (or assigned to a `void` discard if intentionally fire-and-forget — but none should be intentional in this codebase).

## 4. Make keeper SIGKILL its piChild on shutdown

- [x] 4.1 In `packages/server/src/rpc-keeper/keeper.cjs::shutdown` (L87-101): before `process.exit(exitCode)` and AFTER the `unlinkQuiet` calls, insert:
  ```javascript
  try {
    if (piChild && piChild.exitCode === null && piChild.signalCode === null) {
      piChild.kill("SIGKILL");
    }
  } catch (_e) { /* ignore — pi may have died between guard and kill */ }
  ```
- [x] 4.2 Verify the inserted code is positioned BEFORE `process.exit` (otherwise it's unreachable) and AFTER the `try { server.close() } catch` (otherwise the socket teardown is skipped on kill-throw, although the try/catch above absorbs throws).
- [x] 4.3 Read the `shutdown` function in full and confirm no other `process.exit` call exists outside of `shutdown` that would bypass the new SIGKILL (grep `rg -n "process\.exit" packages/server/src/rpc-keeper/keeper.cjs`). If other exit paths exist (e.g. early-exit on missing argv), those are pre-pi-spawn and have no `piChild` to kill — they can be left unchanged.

## 5. Add tests

- [x] 5.1 Create `packages/server/src/__tests__/headless-pid-registry-kill-escalation.test.ts`. Use `vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/process.js")` to inject a fake `killProcess` that resolves immediately. Assert:
  - When `killBySessionId(sid)` is called on a keeper-mediated entry with both `piPid` and `keeperPid` registered, `killProcess` is called with `(piPid, { timeoutMs: 2000 })`.
  - The bare `killPidWithGroup(piPid, "SIGTERM")` is NOT called (the legacy path).
  - The 200 ms keeper-fallback `setTimeout` still fires `killPidWithGroup(keeperPid, "SIGTERM")`. Use `vi.useFakeTimers()` + `vi.advanceTimersByTime(200)`.
  - The function resolves to `true` when at least one kill targeted a live PID and `false` when the entry doesn't exist.
- [x] 5.2 Create `packages/server/src/rpc-keeper/__tests__/keeper-shutdown-kills-pi.test.ts`. Gate with `describe.runIf(process.platform !== "win32")`. Use a tiny fixture script (inline or under `tools/test-fixtures/fake-hung-pi.cjs`) that traps SIGTERM via `process.on("SIGTERM", () => {})` and busy-loops on `setInterval`. Spawn the real `keeper.cjs` against this fake-pi argv (via `PI_KEEPER_PI_CMD=node <fixture>`), then send `keeper.kill("SIGTERM")`. Poll `isProcessAlive(fakePiPid)` every 50 ms for up to 1 s; assert it becomes false.
- [x] 5.3 Run the targeted tests: `HOME=$(mktemp -d) npx vitest run headless-pid-registry-kill-escalation keeper-shutdown-kills-pi 2>&1 | tail -20`. Confirm all pass.
- [x] 5.4 Run the broader server suite to catch any caller that missed an `await`: `HOME=$(mktemp -d) npx vitest run session-action-handler force-kill kill-session 2>&1 | tail -30`. Confirm no new failures.

## 6. End-to-end verification

> **Status:** §6.5 + §6.7 automated via `packages/server/src/__tests__/session-kill-e2e.test.ts` (Tier-1 in-process server + real keeper subprocess + hung mock-pi; drives shutdown / force_kill via browser WS; asserts pi dies within ladder window ≥ 1.8 s). Remaining tasks (§6.1–§6.4, §6.6, §6.8) require live dashboard + operator/Windows VM.

- [ ] 6.1 Rebuild + restart the server: `npm run build && curl -X POST http://localhost:8000/api/restart -H 'Content-Type: application/json' -d '{"dev":true}'`.
- [ ] 6.2 Reload all sessions: `npm run reload:check`.
- [ ] 6.3 Spawn a fresh headless session. In the chat input, paste a prompt that intentionally hangs pi (e.g. a Bash tool call that runs `while true; do :; done` with a fake non-cancellable wrapper, or invoke a session-extension that ignores AbortSignal). Confirm `agent_start` arrives, no `agent_end`, the prompt stays "running".
- [ ] 6.4 Click "Stop" / abort. Observe `pi.abort()` is sent (cooperative). Confirm in the bridge log that abort was dispatched. Pi still hung.
- [x] 6.5 Click "Shutdown" from the session menu (not "Force Kill"). With this change, the session SHALL end within ~2 s — `killBySessionId` escalates pi from SIGTERM to SIGKILL via the `killProcess` ladder. Card transitions to "ended" status.
- [ ] 6.6 Confirm via `ps aux | grep <piPid>` that pi is no longer running. Confirm `~/.pi/dashboard/sessions/<sid>.rpc.sock` is gone (keeper cleaned up its bookkeeping).
- [x] 6.7 Repeat 6.3-6.6 but instead of "Shutdown" use the red ✕ "Force Kill". Behavior is identical (`handleForceKill` was already correct); this run verifies no regression.
- [ ] 6.8 (Windows only, where feasible) Repeat 6.3-6.7 on Windows. The `taskkill /F /T /PID` path is the durability fix; explicit Windows verification is essential.

## 7. Documentation

- [x] 7.1 CHANGELOG.md `[Unreleased] → Fixed`: add entry. Suggested wording: "Sessions stuck after Stop/Shutdown now reliably terminate. `headlessPidRegistry.killBySessionId` escalates pi from SIGTERM to SIGKILL within a 2-second grace window via the shared `killProcess` ladder; the keeper sidecar additionally SIGKILLs its pi child on its own shutdown (defence-in-depth). Previously a hung pi could survive the entire kill ladder and only a dashboard server restart cleared it. (change: `fix-keeper-kill-escalation`)".
- [x] 7.2 `docs/faq.md`: if any FAQ entry says "Restart the dashboard server to recover stuck sessions", update it to say "Click Force Kill (or Shutdown) — the session terminates within 2 s; if not, restart helps". Grep with `rg -n "stuck.*session|server restart" docs/faq.md` first.
- [x] 7.3 `docs/architecture.md` § "RPC keeper sidecar" / "Lifecycle" paragraph (around the SIGTERM/SIGKILL discussion): add one line — "Keeper's `shutdown()` SIGKILLs its `piChild` before exiting, so a hung pi cannot be orphaned by the keeper's own death (see change `fix-keeper-kill-escalation`)."

## 8. Final validation

- [x] 8.1 `npx --no-install openspec validate fix-keeper-kill-escalation --strict` → zero errors.
- [x] 8.2 Full test suite: `npm test 2>&1 | tee /tmp/pi-test.log` → no NEW failures beyond pre-existing environment-dependent ones (`git-worktree-lifecycle-ops`, `browse-endpoint`).
- [x] 8.3 Code-search final sweep: `rg -n 'killPidWithGroup\(piPid|killPidWithGroup\(entry\.pid' packages/server/src/headless-pid-registry.ts` → zero matches. `rg -n 'piChild\.kill' packages/server/src/rpc-keeper/keeper.cjs` → at least one match in `shutdown()`.
- [x] 8.4 Diff review: every line removed traces to one of §2, §3, §4, §7. Any unrelated deletion is out of scope and should be reverted or split into a separate proposal.
