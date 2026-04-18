## Why

Platform-specific code (`process.platform === "win32"` branches, `where`/`which` switches, `SHELL`/`COMSPEC` selection, `taskkill`/`kill -pid` differences, `ps`/`tasklist` enumeration, `open`/`xdg-open`/`start`) is scattered across **17 production files** in `packages/server`, `packages/extension`, `packages/electron`, and `packages/shared`. Each file owns its own ad-hoc branch, and the same primitives are reimplemented or partially duplicated across packages — most recently surfaced by `fix-windows-server-parity`, which had to patch the same jiti-resolver bug in two places because `packages/electron/src/lib/server-lifecycle.ts` kept its own copy of logic already in `packages/shared/src/tool-resolver.ts`. This drift is the canonical argument for consolidation: separation across files let two implementations diverge and bug-fix coverage was incomplete until the duplicate was found. Consolidating the platform primitives into a single shared module removes the drift vector, shrinks the Windows-branch surface from ~25 scattered call sites to ~8 named helpers, and gives ARM64/WSL follow-ups a natural home.

## What Changes

- Introduce `packages/shared/src/platform/` as the single home for cross-OS primitives with sub-modules by concern:
  - `binary-lookup.ts` — absorbs and supersedes `packages/shared/src/tool-resolver.ts` (`where`/`which`, `.cmd` extension, managed-bin search, login-shell fallback, pi/tsx/node resolution)
  - `process.ts` — `findPortHolders`, `killProcess` (taskkill tree on Windows, SIGTERM→SIGKILL on Unix), `isProcessAlive`, `killByPidWithGroup` (negative-pid on Unix, positive on Windows)
  - `process-scan.ts` — `listChildPids`, `scanByPgid`, `isProcessRunning` (ps vs tasklist), `parseEtime`
  - `shell.ts` — `detectShell` (SHELL/COMSPEC), terminal env hints (`TERM=cygwin` on Windows)
  - `commands.ts` — `openBrowser`, `detectMachineInfo`
  - `index.ts` — re-export public API
- Introduce `packages/electron/src/platform/` for Electron-API-bound concerns (cannot live in shared because they import from `electron`):
  - `tray-icon.ts` — platform-specific tray icon selection (`trayTemplate.png` on macOS, `.ico` on Windows, `.png` on Linux)
  - `menu.ts` — darwin-specific menu template
  - `node.ts` — bundled Node binary resolution (`node.exe` vs `node`)
  - `app-lifecycle.ts` — darwin dock-hide quit behavior, linux `ozone-platform-hint`
- Migrate **17 call sites** to consume the new modules. The `ToolResolver` public API is preserved via a thin re-export so external consumers (if any) keep working during transition; remove the re-export after all internal callers are migrated.
- **Remove the duplicate `resolveJitiFromAnchor` in `packages/electron/src/lib/server-lifecycle.ts`** — import from the new `binary-lookup.ts` instead. Closes the drift vector that `fix-windows-server-parity` had to patch in two places.
- Tests consume the new platform API directly: platform behavior is a function argument (e.g. `findPortHolders(port, { platform: "win32", exec: fake })`), eliminating the need for `Object.defineProperty(process, "platform", …)` mutation in tests and reducing the six current `it.skipIf(win32)` skips where a paired Windows-side assertion is now cheap to express.
- Documentation: `AGENTS.md` gets a "Platform primitives" entry pointing at the new module; `docs/architecture.md` gets a short section explaining how cross-OS behavior is resolved; `README.md` is unchanged (no user-visible API change).
- **NOT a breaking change** — all external REST/WebSocket APIs and CLI commands are unaffected. The refactor is internal.

## Capabilities

### New Capabilities
- `platform-primitives`: Unified, injectable cross-OS helpers for binary lookup, process control/enumeration, shell detection, and OS-specific commands. Lives in `packages/shared/src/platform/` with an Electron-specific companion in `packages/electron/src/platform/` for Electron-API concerns.

### Modified Capabilities
_(none — this is a refactor. External behavior is preserved. The only observable change is that the Electron jiti-resolver duplication disappears, but the user-facing behavior stays the same.)_

## Impact

- **Files moved / renamed**:
  - `packages/shared/src/tool-resolver.ts` → `packages/shared/src/platform/binary-lookup.ts` (with back-compat re-export during migration)
- **Files touched (production)**: ~17 call sites across `packages/server` (cli, process-manager, terminal-manager, tunnel, editor-registry, editor-detection, headless-pid-registry, browser-handlers/session-action-handler, routes/provider-auth-routes), `packages/extension` (process-scanner), `packages/electron` (server-lifecycle, dependency-detector, doctor, bundled-node, tray, app-menu, main).
- **Files touched (tests)**: ~15 test files simplified — platform branches become injectable arguments instead of `Object.defineProperty` / `_platform` escape hatches. The six current `skipIf(win32)` tests get paired Windows assertions where feasible.
- **Electron-specific removal**: `resolveJitiFromAnchor` (packages/electron/src/lib/server-lifecycle.ts) deleted; callers use shared `binary-lookup`.
- **Dependencies**: None added or removed.
- **Bundle size**: Marginally smaller (duplicate logic removed, tree-shaking improves).
- **API surface**: Internal only. No changes to REST, WebSocket, or CLI.
- **Migration window**: 6–8 reviewable PRs (bottom-up, adapter-free approach — see design.md for sequencing) OR one squash-merge if preferred. Each intermediate step is green.
- **Risk**: Medium. The primitives are well-understood (most already exist, just scattered), but `process-manager.ts` (310 LOC of intertwined tmux/headless/WSL spawn logic) is the hardest to decompose cleanly and deserves its own step with extra test coverage.
- **Out of scope**: WSL-specific spawn paths, ARM64 native-module audit, `process-manager.ts` strategy logic (remains in-place, consumes platform primitives). All three are naturally easier to revisit once the platform module exists.
