## Why

Windows session spawning is broken and scattered. Four concrete bugs (fork/continue silently drop `--fork`/`--session` flags; sessions die when the server restarts; crashes are invisible; every spawn has a 1.5s latency tax) all share one root cause: Windows spawn logic is duplicated across seven sites in `process-manager.ts`, `server-lifecycle.ts`, and `session-action-handler.ts`, each with its own ad-hoc platform branches and ~200 LOC of near-duplicated detached-spawn boilerplate. Fixing the bugs in-place would require editing the exact files that need to be rewritten for consolidation, so combine them: every file touched is a file we would touch either way, and each new file is a consolidation target that replaces an existing scatter.

## What Changes

- **Introduce three platform primitives** in `packages/shared/src/platform/`:
  - `detached-spawn.ts` — `spawnDetached`, `waitForNoCrash`, `waitForReady`. Uniform detached-child spawn with file-fd stderr capture, OS-correct defaults (libuv `detached: true` on Windows excludes the child from the parent's kill-on-close job, producing PGID-equivalent lifecycle), and an explicit, tunable crash-detection window.
  - `spawn-mechanism.ts` — `SpawnMechanism` enum (`"tmux" | "wt" | "wsl-tmux" | "headless"`) and pure `selectMechanism({ platform, userStrategy, electronMode, available })` selector. Single source of truth for "which mechanism runs on this platform given this config."
  - `process-identify.ts` — `findPidByMarker(marker, { platform })` and `isProcessLikePi(pid, { platform })` consolidating the three inline `process.platform === "win32"` branches currently in `session-action-handler.ts`.
- **Rewrite Windows-broken call sites to use the primitives**:
  - `process-manager.ts` — `spawnPiSession` dispatch replaced end-to-end. Single options-forwarding path, no dropped `sessionFile`/`mode` fields on any branch. Windows interactive-cmd ghost-fallback removed. Adds Windows Terminal (`wt.exe`) strategy so Win10/11 users get tabbed interactive sessions instead of the legacy cmd `/c` ghost.
  - `server-lifecycle.ts` — `launchViaCli` and `launchServer` both migrated to `spawnDetached` + `waitForReady`.
  - `session-action-handler.ts` — `killHeadlessBySessionId` and `isPiProcess` migrated to `process-identify`.
- **Add invariant guard test** `no-direct-platform-branch.test.ts` with seed allowlist. The allowlist starts non-empty (covering `extension/process-scanner.ts`, `electron/dependency-detector.ts`, and the `platform/**` canonical locations); the spawn-related files are REMOVED from the allowlist as part of this change. Future platform-branch leaks across the rewritten files fail the build.
- **Fix the following bugs as a byproduct of the rewrite** (each is resolved by writing the new version in the new location, not by patching old code):
  - B1: WSL branch drops `sessionFile`/`mode` → uniform options forwarding in `selectMechanism`-driven dispatch.
  - B2: `cmd /c pi` fallback hard-codes `pi` without session flags → cmd fallback removed; falls through to headless.
  - B3: Windows headless uses `detached: false` → primitive defaults `detached: true`, verified against libuv source.
  - B4: Windows fallback uses `stdio: "ignore"` hiding crashes → primitive redirects stderr to a file fd always.
  - B5: 1500 ms hard-coded crash window blocks every Windows spawn → `waitForNoCrash({ windowMs })` takes it as a parameter; `process-manager` passes 300 ms.
  - B6: `pi.cmd` + `shell: true` quoting edge cases → primitive requires pre-resolved argv (no `.cmd`); `resolvePiCommand` already prefers `node.exe + cli.js` when the managed install is present.
  - B7: Dangling stdin pipe owned by server process → primitive always uses `stdio[0] = "ignore"` for detached children.
- **BREAKING (lifecycle)**: On Windows, pi sessions now **survive dashboard server restart**. Today they die because they are in the server's libuv kill-on-close job. After this change, Windows behavior matches macOS/Linux. Requires a release note; users who relied on "closing dashboard cleans everything" need a "kill all sessions" action (out of scope here; existing force-kill works per-session).
- **Non-goals (explicitly deferred)**: Tools-UI three-level disclosure redesign; full `no-direct-platform-branch` sweep across extension/electron; Tools UI moves under Advanced. Those are follow-on changes that do not share files with this one.

## Capabilities

### New Capabilities

- `platform-detached-spawn`: OS-aware detached-child spawn primitives (`spawnDetached`, `waitForNoCrash`, `waitForReady`) with uniform file-fd stderr capture, tunable crash-detection window, libuv-correct defaults on Windows (`detached: true` → excluded from kill-on-close job, PGID-equivalent lifecycle). Lives in `packages/shared/src/platform/detached-spawn.ts`. All OS-dependent behaviour accepts an injectable `platform: NodeJS.Platform` parameter for testability.
- `platform-spawn-mechanism`: Pure selector that maps `(platform, userStrategy, electronMode, availability)` to one `SpawnMechanism` (`"tmux" | "wt" | "wsl-tmux" | "headless"`), replacing the current two-type-system tangle (`config.SpawnStrategy` vs `PlatformInfo.strategy`). Includes `wt` detection so Windows 10/11 users get tabbed Windows Terminal sessions; falls through to WSL tmux, then headless.
- `platform-process-identify`: Consolidated process-lookup primitives (`findPidByMarker`, `isProcessLikePi`) replacing scattered `process.platform === "win32"` guards inside `session-action-handler.ts`. Windows implementations return documented stubs today; future PID-registry lookup can be added in one place.

### Modified Capabilities

- `process-manager`: `spawnPiSession` dispatch rewritten to use `selectMechanism` + the new primitives. Every mechanism (tmux, wt, wsl-tmux, headless) forwards `sessionFile` and `mode` uniformly — no branch may drop them. Windows strategy `"tmux"` no longer silently downgrades to broken `wsl`/`cmd` paths; Windows gets `wt` when available, WSL tmux next, headless otherwise. The dead `"cmd"` value is removed from `PlatformInfo.strategy`.
- `headless-spawn`: The current spec explicitly documents the Windows lifecycle limitation ("agents MAY terminate due to stdin EOF"). That limitation is REMOVED: Windows headless now uses `detached: true` via `spawnDetached` and survives server restart, matching Unix behaviour. The stdin pipe is eliminated (`stdio[0] = "ignore"`); stderr goes to a file fd so crash diagnostics survive parent death.
- `force-kill-handler`: The Windows branches inside `killHeadlessBySessionId` / `isPiProcess` delegate to `platform-process-identify`. Observable behaviour is unchanged (Windows stubs still return empty list / `true`) but the platform branching moves out of the handler and into the primitive.

## Impact

- **New files** (`packages/shared/src/platform/`): `detached-spawn.ts`, `spawn-mechanism.ts`, `process-identify.ts`, plus three unit-test files.
- **Rewritten files**: `packages/server/src/process-manager.ts` (entire `spawnPiSession` body replaced), `packages/electron/src/lib/server-lifecycle.ts` (both `launchViaCli` and `launchServer`), `packages/server/src/browser-handlers/session-action-handler.ts` (three Windows branches removed).
- **Extended files**: `packages/server/src/__tests__/process-manager.test.ts` gains Windows dispatch + fork-forwarding coverage; new `packages/shared/src/__tests__/no-direct-platform-branch.test.ts` invariant guard.
- **Docs**: `AGENTS.md` key-files table gains three new rows; `docs/architecture.md` "Platform primitives" section gains a "Spawn" subsection; `README.md` gains a Windows-session-durability note and optional `wt` recommendation.
- **User-visible behaviour**: Windows session fork works for the first time outside Electron mode; continue works on all Windows configurations; Windows spawn latency drops by ~1.2 s per call; Win11 users see tabbed interactive sessions; Windows sessions survive server restart (BREAKING — see release note).
- **Risk**: Medium. Touches the startup path across server + Electron + bridge. Mitigated by phased commit order within the PR (primitives first, callers after), ToolResolver seam for dispatch testing, and explicit release note for the lifecycle change.
