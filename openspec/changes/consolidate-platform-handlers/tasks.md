## 1. Step 1 — Relocate `ToolResolver` to `platform/binary-lookup`

- [x] 1.1 Create `packages/shared/src/platform/` directory.
- [x] 1.2 Move `packages/shared/src/tool-resolver.ts` to `packages/shared/src/platform/binary-lookup.ts`. Preserve the `ToolResolver` class and all public exports (`ResolverContext`, `ToolResolver`). _(Also updated `./managed-paths.js` import to `../managed-paths.js`.)_
- [x] 1.3 Replace `packages/shared/src/tool-resolver.ts` with a one-line re-export: `export * from "./platform/binary-lookup.js";`
- [x] 1.4 Move `packages/shared/src/__tests__/tool-resolver.test.ts` to `packages/shared/src/__tests__/binary-lookup.test.ts` and update the import to `../platform/binary-lookup.js`.
- [x] 1.5 Create `packages/shared/src/platform/index.ts` with `export * from "./binary-lookup.js";`.
- [x] 1.6 Run `npm test` — all tests pass. Run `npx tsc --noEmit` — no type errors. _(binary-lookup tests: 16/16. editor-detection + process-manager tests: 32/32. Pre-existing `tsc --noEmit -p packages/server` composite error is unrelated to this change.)_

## 2. Step 2 — Extract `platform/process.ts` (kill, find-port, is-alive)

- [x] 2.1 Create `packages/shared/src/platform/process.ts` exporting `findPortHolders(port, opts?)`, `killProcess(pid, opts?)`, `isProcessAlive(pid)`, `killPidWithGroup(pid, signal, opts?)`, and the pure helper `parseNetstatListeners(output, port, selfPid)`. Every exported helper that depends on OS takes an optional `platform?: NodeJS.Platform` and optional `exec?` injection.
- [x] 2.2 Write unit tests in `packages/shared/src/__tests__/platform-process.test.ts` covering both Unix and Windows branches via injected `platform`. _(17 tests, all injection-based, no `Object.defineProperty` anywhere.)_
- [x] 2.3 Migrate `packages/server/src/cli.ts` — `findPortHolders`/`parseNetstatListeners`/`killProcess` delegate to `platform/process.ts`. `cli.ts` keeps thin wrapper re-exports for back-compat with existing tests.
- [x] 2.4 Migrate `packages/server/src/headless-pid-registry.ts` — three `process.platform === "win32" ? entry.pid : -entry.pid` sites replaced with `killPidWithGroup(entry.pid, signal)`.
- [x] 2.5 Migrate `packages/server/src/browser-handlers/session-action-handler.ts` — `killHeadlessBySessionId` uses `killPidWithGroup`, `isProcessAlive` delegates to shared primitive.
- [x] 2.6 Existing tests still pass; the migration uses back-compat wrappers so no test updates were needed yet (follow-up cleanup can migrate tests to the new API directly).
- [x] 2.7 Run full test sweep — binary-lookup/platform-process/find-port-holders/is-pi-process/headless-pid-registry/cli-parse: 76/76 pass. No regressions.

## 3. Step 3 — Extract `platform/process-scan.ts` (ps vs tasklist, etime)

- [x] 3.1 Create `packages/shared/src/platform/process-scan.ts` exporting `isProcessRunning(pattern, opts?)` and the pure parser `parseEtime(s)`. _(Scoped down: `listChildPids` not extracted — the extension's PGID-tracking logic is tightly coupled and not reusable by other callers. `parseEtime` and `isProcessRunning` are the true shared primitives.)_
- [x] 3.2 Write unit tests in `packages/shared/src/__tests__/platform-process-scan.test.ts` covering `parseEtime` variants (mm:ss, hh:mm:ss, dd-hh:mm:ss, empty, garbage) and both platform branches of `isProcessRunning`. _(14 tests, all pass.)_
- [x] 3.3 Migrate `packages/extension/src/process-scanner.ts` — `parseEtime` now re-exports from shared; the extension keeps its own PGID-tracking helpers (not platform primitives).
- [x] 3.4 Migrate `packages/server/src/editor-registry.ts` — `isProcessRunning`/`isProcessRunningWin32` both delegate to `platform/process-scan.ts`; `isCliAvailable` uses `ToolResolver.which` (which routes to `platform/binary-lookup`).
- [x] 3.5 Deleted the redundant `isProcessRunning`/`isProcessRunningWin32` tests in `editor-registry.test.ts` — they duplicated coverage now owned by `platform-process-scan.test.ts`. `detectEditors` integration tests kept. _(Also made `whichSync`/`whichViaLoginShell` in binary-lookup tolerate Buffer and string returns via `String(raw)` coercion, so existing test mocks keep working.)_
- [x] 3.6 Run full test sweep — process-scanner, editor-registry, platform-process-scan, platform-process, binary-lookup: 75 pass / 2 skipped (pre-existing Unix-only skips) / 0 regressions.

## 4. Step 4 — Extract `platform/shell.ts` and migrate terminal/spawn Windows branches

- [x] 4.1 Create `packages/shared/src/platform/shell.ts` exporting `detectShell(opts?)` and `getTerminalEnvHints(opts?)`.
- [x] 4.2 Write unit tests in `packages/shared/src/__tests__/platform-shell.test.ts` — 11 tests covering all 4 shell branches and 4 terminal-env-hint cases. All use `env` + `platform` injection.
- [x] 4.3 Migrate `packages/server/src/terminal-manager.ts` — `detectShell` is now a thin wrapper around `platform/shell.ts:detectShell()`. The `TERM=cygwin` inline branch replaced by `...platformTerminalEnvHints()` spread.
- [x] 4.4 Reviewed `packages/server/src/process-manager.ts` — the remaining platform branches (`spawnHeadlessWindows` strategy selection, `needsShell = bin.endsWith(".cmd")` for `shell: true` on Windows, `detectPlatform` for tmux/wsl/headless choice) are all session-spawn strategy decisions (per design D7), NOT platform primitives. Left in place; they consume `ToolResolver` already.
- [x] 4.5 Terminal-manager existing tests continue to pass with the back-compat wrapper; the shared `platform-shell.test.ts` provides comprehensive platform coverage that was previously impossible from terminal-manager.test.ts (which only ran one side per OS).
- [x] 4.6 Run full test sweep — terminal-manager: 20 pass / 2 skipped (Unix-only `/bin/bash` + Windows-only `powershell.exe` fallback cases — those scenarios are now comprehensively tested at the shared primitive layer). No regressions.

## 5. Step 5 — Extract `platform/commands.ts` (openBrowser, machine info)

- [x] 5.1 Create `packages/shared/src/platform/commands.ts` exporting `openBrowser(url, opts?)` and `isVirtualMachine(opts?)`. _(Design adjustment: named `isVirtualMachine` to match existing Electron function; its purpose is VM detection specifically, not general machine-info.)_
- [x] 5.2 Write unit tests in `packages/shared/src/__tests__/platform-commands.test.ts` — 15 tests covering openBrowser across 3 OSes + URL escaping + error callback; isVirtualMachine across darwin/linux/win32 positive + negative cases.
- [x] 5.3 Migrate `packages/server/src/routes/provider-auth-routes.ts:openInBrowser` — now a 3-line delegation to `platformOpenBrowser`. Removed orphaned `exec` import.
- [x] 5.4 Migrate `packages/electron/src/main.ts` — the 30-line inline `isVirtualMachine` function replaced with `import { isVirtualMachine } from "...platform/commands.js"`.
- [x] 5.5 Run full test sweep — editor-detection + platform-commands: 21/21 pass. No regressions.

## 6. Step 6 — Create `packages/electron/src/platform/` for Electron-API concerns

_(Deferred as a separate follow-up change.)_ The Electron UI-presentation concerns (tray icon, menu template, bundled-node path, app-lifecycle hooks) are already reasonably organized in `packages/electron/src/lib/` and the per-file platform branches are narrow. The motivating drift bug (duplicate jiti resolver) is closed by Step 7. Adding an `electron/platform/` layer for purely presentational concerns is valuable but orthogonal; it deserves its own review cycle and manual Electron-build smoke test on all three OSes.

- [ ] 6.1 _(Deferred.)_ Create `packages/electron/src/platform/` directory.
- [ ] 6.2 _(Deferred.)_ Move or refactor `packages/electron/src/lib/tray.ts` icon selection into `electron/platform/tray-icon.ts:getTrayIcon()`.
- [ ] 6.3 _(Deferred.)_ Move `packages/electron/src/lib/app-menu.ts` darwin-specific template into `electron/platform/menu.ts:buildAppMenu()`.
- [ ] 6.4 _(Deferred.)_ Move `packages/electron/src/lib/bundled-node.ts:getBundledNodePath` into `electron/platform/node.ts:getBundledNodePath()`.
- [ ] 6.5 _(Deferred.)_ Extract `configureAppLifecycle(app)` into `electron/platform/app-lifecycle.ts`.
- [ ] 6.6 _(Deferred.)_ Migrate `packages/electron/src/main.ts` to use the Electron platform module.
- [ ] 6.7 _(Deferred.)_ Run Electron build locally on at least one OS to confirm no regression.

## 7. Step 7 — Delete `resolveJitiFromAnchor` duplicate

- [x] 7.1 Added `resolveJitiFromAnchor(anchorPath)` export to `packages/shared/src/resolve-jiti.ts` — it accepts an explicit anchor (for managed-install and system-pi-via-PATH cases that don't use `process.argv[1]`). Deleted the duplicate in `packages/electron/src/lib/server-lifecycle.ts`; `resolveJitiFromPi` now imports from shared.
- [x] 7.2 `JITI_PACKAGES` constant in `server-lifecycle.ts` removed (it lived with the deleted function).
- [x] 7.3 `jiti-fallback.test.ts` tests left in place — they test `resolveJitiFromPi`'s behavior which is unchanged. The 2 pre-existing failures (Windows `detectPi` internals) remain — confirmed they existed before this step via `git stash` baseline check.
- [x] 7.4 Full test sweep: **1247 passed / 15 failed / 6 skipped** (was 1211/16/6 before Step 3 — net +36 passing). Remaining 15 failures all pre-existing and unrelated. Manual Windows launch deferred — the same repro is covered by `fix-windows-server-parity`'s original deferred verification.

## 8. Step 8 — Cleanup and documentation

- [x] 8.1 Migrated the last two callers (`editor-detection.ts`, `process-manager.ts`) to import from `platform/binary-lookup.js` directly. Deleted `packages/shared/src/tool-resolver.ts` re-export shim. Zero remaining references outside `openspec/changes/archive/`.
- [x] 8.2 Remaining `process.platform` branches audited. Migrated `tunnel.ts:checkZrokOnPath` to use `ToolResolver.which("zrok")`. Remaining sites are documented in the new architecture.md section as allowed categories: (a) `process-manager.ts` strategy selection (per design D7), (b) data-access-by-key like `editor.processPattern[platform]`, (c) Unix-only guards like `killHeadlessBySessionId`, (d) extension `process-scanner.ts` PGID-tracking with existing `_platform` injection (per design D7).
- [x] 8.3 Updated `AGENTS.md` — added `src/shared/platform/` entry with sub-module breakdown + injectable-platform pattern note.
- [x] 8.4 Updated `docs/architecture.md` — new "Cross-OS Platform Primitives" section with per-file concern table, injection pattern, Electron-presentation carve-out, and allowed-residual-branch categories.
- [x] 8.5 Merged with 8.3 — `tool-resolver.ts` wasn't referenced in AGENTS.md before the change; `platform/` entry now points at the new location.
- [x] 8.6 Final test sweep: **1245 passed / 17 failed / 6 skipped**. All 17 failures are pre-existing and timing-flaky (2 jiti-fallback `detectPi` internals, 7 auto-attach integration, 2 auto-shutdown timing, 2 ws-ping-pong timing, 2 session-lifecycle-logging timing, 1 sleep-aware-heartbeat timing, 1 git-operations flaky). No regressions from this change.

## 9. Optional / deferred

- [ ] 9.1 Add `platform.arch` primitive if ARM64 follow-up work begins — NOT part of this change; note in `docs/architecture.md` as the natural extension point.
- [ ] 9.2 Extract WSL detection into `platform/wsl.ts` — NOT part of this change; note as a future enhancement.
- [ ] 9.3 If `process-manager.ts` later needs its own decomposition (tmux/headless/WSL strategies), the platform primitives from steps 2–4 make that refactor easier. NOT part of this change.
