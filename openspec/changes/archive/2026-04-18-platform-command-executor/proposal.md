## Why

Every time we spawn a subprocess in this codebase, we repeat the same concerns: `windowsHide: true`, timeout, shell escaping, error classification, stdout parsing, and binary resolution. When any one is forgotten, it leaks to the user (today: flashing cmd-prompt windows on session clicks because `packages/server/src/session-diff.ts` runs `git diff` without `windowsHide`). The prior `consolidate-platform-handlers` change pulled OS primitives into a shared module, but each call site still builds raw `execSync("git diff -- ...")` strings with those cross-cutting concerns inline. Five files invoke `git`, four invoke `npm`, two invoke `openspec` — each with its own copy of timeout, windowsHide, escape-logic, and parse code. The drift class remains: add one more `execSync` anywhere without `windowsHide` and the flashing is back.

This change introduces a three-layer architecture that collapses all subprocess concerns into **one runner module** and turns every external-tool invocation into a **pure-data Recipe**. Tool modules (`platform/git.ts`, `platform/openspec.ts`, `platform/npm.ts`) become platform-blind — they declare *what* to run and *how to parse*, never *how to spawn*. The runner owns every cross-cutting concern. Direct `child_process` imports outside the runner are forbidden, enforced by a repo-level check.

## What Changes

- **Layer 1 (safety net, lands first):** introduce `packages/shared/src/platform/exec.ts` — a thin wrapper over `node:child_process` that always sets `windowsHide: true` by default and provides typed `execSync` / `execFile` / `spawnSync` / `spawn` / `execAsync` / `execFileAsync` exports. Migrate **every** spawn site in `packages/server`, `packages/extension`, `packages/electron`, and `packages/shared` to import from this wrapper (replacing direct `node:child_process` imports). This alone eliminates the flashing-cmd-window class of bug.
- **Layer 2 (runner + recipe infrastructure):** introduce `packages/shared/src/platform/runner.ts` exporting a single `run<I, O>(recipe: Recipe<I, O>, input: I, ctx?: RunCtx): Result<O>` function plus the `Recipe<I, O>` / `RunCtx` / `Result<T>` types. The runner handles binary resolution (via `ToolResolver`), argument escaping (always argv array, never shell string), timeout defaults, tolerated exit codes, error normalization, and — critically — `windowsHide: true`. Recipes are pure data: `{ argv, parse, timeout?, tolerate?, cwd? }`.
- **Layer 3 (tool modules):** introduce Recipe-based tool modules for the three tools we call most:
  - `packages/shared/src/platform/git.ts` — replaces inline `execSync("git ...")` in `packages/server/src/session-diff.ts`, `packages/server/src/git-operations.ts`, `packages/extension/src/git-info.ts`, and the git calls in `packages/electron/src/lib/doctor.ts`. Exports typed methods: `diff`, `status`, `branches`, `currentBranch`, `headSha`, `remoteUrl`, `isGitRepo`, `checkout`, `stash`, `stashPop`, plus the underlying `GIT_RECIPES` registry.
  - `packages/shared/src/platform/openspec.ts` — formalizes and expands `packages/shared/src/openspec-poller.ts`. Exports `list`, `status`, `archive`. The existing `pollOpenSpec` / `pollOpenSpecAsync` APIs are preserved as thin wrappers over the new Recipe-based implementation.
  - `packages/shared/src/platform/npm.ts` — replaces inline `execSync("npm root -g")` and `execSync("npm outdated ...")` in `packages/server/src/package-manager-wrapper.ts`, `packages/server/src/pi-resource-scanner.ts`, `packages/electron/src/lib/update-checker.ts`, and `packages/electron/src/lib/doctor.ts`. Exports `rootGlobal`, `outdated`, `install`, `remove`, `viewVersion`.
- **Repo-level import ban:** add a unit test in `packages/shared/src/__tests__/no-direct-child-process.test.ts` that greps `packages/*/src/**/*.ts` for direct `node:child_process` imports and fails if any exist outside `packages/shared/src/platform/exec.ts` and `packages/shared/src/platform/runner.ts`. This prevents regression — anyone adding a new `execSync` anywhere breaks the test.
- **Zero behavior change for end users.** The dashboard server, bridge extension, and Electron app all continue to function identically. The refactor is internal: same commands, same outputs, same error handling — just routed through the runner.
- **One-off commands stay inline** (`sysctl -n hw.model`, `systemd-detect-virt`, `wmic bios`, `curl` health probe, etc.). Each is called from exactly one place; wrapping them as Recipes would be pure ceremony. They still import their `execSync` from the Layer 1 wrapper so they get `windowsHide: true` for free.

## Capabilities

### New Capabilities
- `command-executor`: Pure-data Recipe definitions + single `run()` function + ban on direct `child_process` imports. The one place in the codebase that knows how to spawn.
- `tool-modules`: Recipe-based facades for `git`, `openspec`, and `npm` that tool-consuming code calls instead of building raw command strings.

### Modified Capabilities
- `platform-primitives`: Adds `exec.ts`, `runner.ts`, and the three tool modules to the `platform/` barrel. Existing primitives (`binary-lookup`, `process`, `process-scan`, `shell`, `commands`) migrate their internal `execSync` calls to route through the Layer 1 wrapper but their public APIs are unchanged.

## Impact

- **Files introduced**: 6 in `packages/shared/src/platform/` (`exec.ts`, `runner.ts`, `git.ts`, `openspec.ts`, `npm.ts`, plus tests for each).
- **Files touched**: ~25 call sites across all four packages swap their `node:child_process` imports for `@blackbelt-technology/pi-dashboard-shared/platform/exec.js` (Layer 1) or, where applicable, swap inline `execSync("git ...")` / `execSync("npm ...")` / `execFile("openspec ...")` for typed tool-module calls (Layer 3).
- **Files deleted**: `packages/shared/src/openspec-poller.ts` is renamed/absorbed into `platform/openspec.ts` with a back-compat re-export.
- **APIs**: Internal only. No REST, WebSocket, CLI, or config surface changes.
- **Dependencies**: None added. The runner uses only `node:child_process`, `node:util`, and existing platform primitives.
- **Test coverage**: new tests for the runner (including the `windowsHide`, timeout, tolerate-exit-code, and error-normalization behaviors) and for each tool module's argv generation (as pure functions, no spawn needed). The no-direct-child-process import-ban test is the guard rail.
- **Risk**: Medium. Layer 1 is a pure wrapper and cannot change behavior. Layer 2/3 are a refactor of working code, so the primary risk is "did we preserve the exact error semantics of every migrated call site?" — mitigated by keeping each tool module small and unit-testable.
- **Scope boundary**: this change does NOT alter the existing Electron server-lifecycle `resolveTsxCommand`, `process-manager.ts` spawn-strategy logic, or `terminal-manager.ts` PTY spawn — these aren't subprocess concerns the runner should own (PTYs require `node-pty`, not `child_process`; strategy selection is domain logic). They're tracked as future cleanup.
- **Migration staged**: the change is structured as three commit-sized phases (Layer 1, Layer 2 + first tool, remaining tools) so it can merge incrementally if reviewers prefer.
