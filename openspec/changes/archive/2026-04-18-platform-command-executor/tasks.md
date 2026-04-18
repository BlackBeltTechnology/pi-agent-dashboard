## 1. Phase 1 — Layer 1 wrapper (`platform/exec.ts`) and import migration

- [x] 1.1 Create `packages/shared/src/platform/exec.ts` exporting wrapped `execSync`, `exec`, `execFile`, `spawnSync`, `spawn`, `execAsync`, `execFileAsync` that set `windowsHide: true` by default (overridable). Preserve exact type signatures so downstream imports can be a pure swap. Add the module to `packages/shared/src/platform/index.ts`.
- [x] 1.2 Write unit tests in `packages/shared/src/__tests__/platform-exec.test.ts` covering: (a) `windowsHide: true` applied to each of the 7 wrappers when opts omits it, (b) explicit `windowsHide: false` honored, (c) existing user options (timeout, cwd, env) preserved, (d) `spawn` without args array gets `[]`. Use mocks or pass-through verification — these are thin wrappers so tests assert the option passthrough, not the subprocess behavior.
- [x] 1.3 Write the import-ban test `packages/shared/src/__tests__/no-direct-child-process.test.ts`. It SHALL scan every `.ts` file under `packages/*/src/` (excluding `__tests__/`) for direct `node:child_process` imports (`import ... from "node:child_process"`, `require("node:child_process")`). The allowlist SHALL contain exactly `packages/shared/src/platform/exec.ts`. Initially the test will fail listing every current violation — that's the migration worklist.
- [x] 1.4 Migrate `packages/shared/src/platform/binary-lookup.ts` — change `import { execSync } from "node:child_process"` to import from `./exec.js`.
- [x] 1.5 Migrate `packages/shared/src/platform/process.ts` — same swap.
- [x] 1.6 Migrate `packages/shared/src/platform/process-scan.ts` — same swap.
- [x] 1.7 Migrate `packages/shared/src/platform/commands.ts` — same swap for both `execSync` and `exec`.
- [x] 1.8 Migrate `packages/shared/src/openspec-poller.ts` — swap `spawnSync` and `execFile` imports. Remove any `windowsHide: true` that was added in earlier sessions (it becomes redundant; the wrapper provides it by default).
- [x] 1.9 Migrate `packages/server/src/cli.ts` — `spawn` import swap. The `taskkill` execSync call inside `killProcess` routes through the shared primitive already.
- [x] 1.10 Migrate `packages/server/src/browser-handlers/directory-handler.ts` — `execFile` import swap.
- [x] 1.11 Migrate `packages/server/src/browser-handlers/session-action-handler.ts` — `execSync` import swap (for `killHeadlessBySessionId` and `isPiProcess`).
- [x] 1.12 Migrate `packages/server/src/browser-handlers/terminal-handler.ts` — if it imports `child_process` directly, swap; otherwise it uses `terminalManager.spawn` which is PTY (out of scope).
- [x] 1.13 Migrate `packages/server/src/editor-manager.ts` — `spawn` import swap.
- [x] 1.14 Migrate `packages/server/src/git-operations.ts` — `execSync` import swap.
- [x] 1.15 Migrate `packages/server/src/package-manager-wrapper.ts` — `execSync` import swap.
- [x] 1.16 Migrate `packages/server/src/pi-resource-scanner.ts` — `execSync` import swap.
- [x] 1.17 Migrate `packages/server/src/process-manager.ts` — `execSync` + `spawn` import swap.
- [x] 1.18 Migrate `packages/server/src/restart-helper.ts` — `spawn` import swap. Note: the orchestrator script embedded as a string for `node -e` still uses raw `require("node:child_process")` — that's fine because it executes in a separate Node process; document the exception in a comment.
- [x] 1.19 Migrate `packages/server/src/routes/provider-auth-routes.ts` — the `exec` import was removed in a prior change; verify no `child_process` import remains.
- [x] 1.20 Migrate `packages/server/src/routes/system-routes.ts` — `spawn` import swap.
- [x] 1.21 Migrate `packages/server/src/session-diff.ts` — `execSync` import swap. **This is the file causing the current flashing-terminal bug on session click.**
- [x] 1.22 Migrate `packages/server/src/tunnel.ts` — `execSync` + `spawn` import swap.
- [x] 1.23 Migrate `packages/extension/src/command-handler.ts` — if any direct `child_process` import remains, swap; otherwise it uses `pi.exec` which is pi's extension API (not `child_process` directly) — no action.
- [x] 1.24 Migrate `packages/extension/src/git-info.ts` — `execSync` import swap.
- [x] 1.25 Migrate `packages/extension/src/dev-build.ts` — `execSync` import swap.
- [x] 1.26 Migrate `packages/extension/src/process-scanner.ts` — `spawnSync` import swap. All three call sites (ps, wmic, taskkill, powershell) inherit `windowsHide: true` from the wrapper automatically; remove any manually-added `windowsHide: true` lines.
- [x] 1.27 Migrate `packages/extension/src/server-launcher.ts` — `spawn` import swap.
- [x] 1.28 Migrate `packages/electron/src/lib/dependency-detector.ts` — `execSync` import swap.
- [x] 1.29 Migrate `packages/electron/src/lib/doctor.ts` — `execSync` import swap.
- [x] 1.30 Migrate `packages/electron/src/lib/server-lifecycle.ts` — `spawn` + `execSync` (inside `resolveTsxCommand`) import swap.
- [x] 1.31 Migrate `packages/electron/src/lib/update-checker.ts` — `execSync` import swap.
- [x] 1.32 Migrate `packages/electron/src/main.ts` — the `isVirtualMachine` delegation already routes through shared; verify no residual direct `child_process` import.
- [x] 1.33 Run the import-ban test — it SHALL now pass. The allowlist remains `packages/shared/src/platform/exec.ts` only (no `runner.ts` yet in Phase 1).
- [x] 1.34 Run full test sweep: `npx vitest run packages/shared packages/extension packages/server packages/electron`. All previously-passing tests still pass. Remove any `windowsHide: true` that was added in earlier sessions as part of the first-pass fix — the wrapper makes those redundant (optional cleanup; leave them if uncertain).
- [x] 1.35 Rebuild the client (`npm run build`) if any client-facing paths were touched (unlikely), restart the dashboard server. Click a session in the UI and verify no cmd-prompt window flashes anywhere. This is the acceptance test for Phase 1.

## 2. Phase 2 — Runner (`platform/runner.ts`) + first Recipe-based tool (`platform/git.ts`)

- [x] 2.1 Create `packages/shared/src/platform/runner.ts` exporting `run<I, O>(recipe, input, ctx?)`, the `Recipe<I, O>` / `RunCtx` / `Result<T>` / `ExecError` types, `unwrap(result, fallback)`, and the test-only `resetResolverCache()`. The runner uses `platform/exec.ts` for spawning and `platform/binary-lookup.ts` for binary resolution.
- [x] 2.2 Update the import-ban test allowlist to include `packages/shared/src/platform/runner.ts`. Re-run; still passes.
- [x] 2.3 Write unit tests in `packages/shared/src/__tests__/platform-runner.test.ts` covering: successful recipe execution, tolerated exit code, untolerated exit code, binary-not-found, timeout, spawn-failure, argv resolution via cache, `resetResolverCache` behavior, `unwrap` helper. Use a mock `exec` to drive outcomes without real subprocesses.
- [x] 2.4 Create `packages/shared/src/platform/git.ts`. Define `GIT_RECIPES` (a const object containing `GIT_DIFF`, `GIT_STATUS`, `GIT_BRANCHES`, `GIT_CURRENT_BRANCH`, `GIT_HEAD_SHA`, `GIT_REMOTE_URL`, `GIT_IS_REPO`, `GIT_CHECKOUT`, `GIT_STASH`, `GIT_STASH_POP`). Each recipe has `argv` + `parse` + per-recipe defaults. Export typed functions (`diff`, `status`, `branches`, `currentBranch`, `headSha`, `remoteUrl`, `isGitRepo`, `checkout`, `stash`, `stashPop`) that call `run(GIT_RECIPES.X, input, { cwd: input.cwd })`.
- [x] 2.5 Write `packages/shared/src/__tests__/platform-git.test.ts` covering: each recipe's `argv` output for representative inputs (pure-function tests, no spawn), the `parse` function for representative stdout shapes, and integration smoke tests for `currentBranch` + `isGitRepo` against the actual repo.
- [x] 2.6 Migrate `packages/server/src/session-diff.ts` — replace the two inline `execSync("git diff ...")` + `execSync("git status --porcelain ...")` calls with `git.diff(...)` + `git.status(...)` from `platform/git.ts`. Verify session-diff tests still pass; verify no cmd-prompt flash when clicking a session in the UI.
- [ ] 2.7 Migrate `packages/server/src/git-operations.ts` — replace inline `execSync("git ...")` calls with `git.*` methods. Verify `git-operations` tests still pass.
- [x] 2.8 Migrate `packages/extension/src/git-info.ts` — replace `runGit` helper's `execSync("git ...")` with `git.*` methods. The higher-level `detectBranch` / `detectRemoteUrl` / `detectPrNumber` retain their current shape, just with `git.currentBranch()` etc. underneath.
- [ ] 2.9 Migrate `packages/electron/src/lib/doctor.ts` — any inline `git ...` invocations (if present) route through `platform/git.ts`. Grep to confirm zero `execSync("git ..."` patterns remain in the repo outside `GIT_RECIPES`.
- [x] 2.10 Run full test sweep. No regressions. UI acceptance test: click a session → no cmd-prompt flash (already true from Phase 1 but re-verify).

## 3. Phase 3 — `platform/openspec.ts` and `platform/npm.ts`

- [x] 3.1 Create `packages/shared/src/platform/openspec.ts`. Define `OPENSPEC_RECIPES` (`OPENSPEC_LIST`, `OPENSPEC_STATUS`, `OPENSPEC_ARCHIVE`). Export typed functions `list`, `status`, `archive`. The existing `pollOpenSpec` / `pollOpenSpecAsync` in `openspec-poller.ts` SHALL be rewritten as thin wrappers over the new API so existing callers don't break. Re-export them from `openspec-poller.ts` for back-compat during the migration window.
- [x] 3.2 Write `packages/shared/src/__tests__/platform-openspec.test.ts` covering recipe argv and the three top-level functions. Move relevant assertions from any existing `openspec-poller.test.ts`.
- [x] 3.3 Migrate `packages/server/src/browser-handlers/directory-handler.ts` — replace `execFileAsync("openspec", ["archive", "--completed"], ...)` with `openspec.archive({ completed: true, cwd: msg.cwd })`.
- [x] 3.4 Migrate `packages/server/src/directory-service.ts` — the poller loop calls `pollOpenSpecAsync`; this keeps working unchanged via the back-compat wrapper. Optionally, upgrade the callers to import from `platform/openspec.js` directly for consistency.
- [x] 3.5 Create `packages/shared/src/platform/npm.ts`. Define `NPM_RECIPES` (`NPM_ROOT_GLOBAL`, `NPM_OUTDATED`, `NPM_OUTDATED_GLOBAL`, `NPM_INSTALL`, `NPM_INSTALL_GLOBAL`, `NPM_VIEW_VERSION`). Export typed functions (`rootGlobal`, `outdated`, `outdatedGlobal`, `install`, `installGlobal`, `viewVersion`).
- [x] 3.6 Write `packages/shared/src/__tests__/platform-npm.test.ts` covering recipe argv and parse for `rootGlobal` (simple path return) and `outdated` (JSON parse).
- [x] 3.7 Migrate `packages/server/src/package-manager-wrapper.ts` — `execSync("npm root -g")` → `npm.rootGlobal()`.
- [x] 3.8 Migrate `packages/server/src/pi-resource-scanner.ts` — `execSync("npm root -g")` → `npm.rootGlobal()`.
- [x] 3.9 Migrate `packages/electron/src/lib/update-checker.ts` — all four `execSync("npm ...")` calls → `npm.*` methods.
- [x] 3.10 Grep the repo: no `execSync("npm ..."`, no `execSync(\`git ..."`, no `execSync("openspec ..."` — all such invocations SHALL now route through the Recipe-based tool modules.
- [x] 3.11 Run full test sweep. No regressions. Manual smoke: restart the server, trigger operations that hit openspec (session switch with an attached proposal), git (session click, branch picker), and npm (package install dialog). Confirm nothing flashes a cmd window.
- [x] 3.12 Delete `packages/shared/src/openspec-poller.ts` or leave as re-export shim — decision deferrable to cleanup step 4.

## 4. Phase 4 — Cleanup and documentation

- [ ] 4.1 Decide on `openspec-poller.ts`: if no external consumers remain, delete it; otherwise keep the re-export shim. Document the decision in `AGENTS.md`.
- [x] 4.2 Update `AGENTS.md` — add `src/shared/platform/exec.ts`, `src/shared/platform/runner.ts`, `src/shared/platform/git.ts`, `src/shared/platform/openspec.ts`, `src/shared/platform/npm.ts` entries to the Key Files table with brief descriptions. Add a note on the import-ban test.
- [ ] 4.3 Update `docs/architecture.md` — add a "Command Execution Pipeline" section explaining the three layers (exec → runner → tool modules), the Recipe pattern, and the import-ban enforcement. Include the diagram from `design.md`.
- [ ] 4.4 Update `README.md` troubleshooting section — mention that if flashing cmd windows reappear on Windows, the import-ban test (`npm test -- no-direct-child-process`) will identify the offending file.
- [ ] 4.5 Run `openspec validate platform-command-executor --strict` — passes. Archive the change.
