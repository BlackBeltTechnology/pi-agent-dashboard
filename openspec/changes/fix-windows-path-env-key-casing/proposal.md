## Why

Issue #720: on Windows the tool resolver treats installed tools (`git`, `gh`, `npx`, `tailscale`) as not found. Spawned sessions pick the wrong git, or none at all, and the folder watchers fail with `ENOENT`.

The root cause is that Windows stores the variable as `Path`. `process.env` itself ignores key case, but a **copy** of it (`{ ...process.env }` or `Object.entries`) keeps the literal `Path` key. `ToolResolver.buildSpawnEnv()` copies the env and then reads `base.PATH`, which is `undefined`. It builds a new `PATH` from only the dirs it prepends, so the output holds **both** `Path` (the full value) and `PATH` (the prepended dirs only).

When Node spawns a child on win32, it drops env keys that differ only in case. It sorts the keys and keeps the first one, and `"PATH"` sorts before `"Path"`, so the full system PATH is thrown away. Electron launches the server with this env (`launch-source.ts`), so the server's own `where` lookups and every session it spawns inherit the cut-down PATH.

## What Changes

- New shared helper `normalizeEnvPathKey(env, platform?)` in `packages/shared/src/platform/`. On win32 it merges every case variant of `PATH` into a single `PATH` key. Entries are de-duplicated case-insensitively, `PATH` goes first, and the original order is kept. It returns a clone, never mutates the input, and is a no-op clone on POSIX, where `Path` and `PATH` are distinct variables.
- Every shared function that reads or writes the PATH of an env it was given normalizes that env first:
  - `ToolResolver.buildSpawnEnv`
  - `ensureWindowsSystemPath`
  - `ensureBundledGitOnPath`
  - `prependManagedNodeToPath`
  - `prependSelectedNodeToPath`
  - `process-manager` `prependResolvedBinDir`
- Result: a spawn env built by the dashboard carries exactly one PATH key on win32, and the inherited system PATH is kept.
- The fix also covers the same flaw in `pi-core-updater` (`prependManagedNodeToPath(process.env)`) and in the PTY terminal (`augmentEnvWithGitSource({ ...process.env })`).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `platform-primitives`: adds the requirement "Spawn-env PATH key is case-normalized on Windows". Every shared PATH-mutating env helper must return an env with exactly one PATH key that keeps the inherited PATH entries.

## Discipline Skills

- `systematic-debugging`: the bug was root-caused from the report through the code and Node's win32 env de-dup rule. Tests reproduce it (a `Path`-keyed env on the win32 platform) and fail before the fix.
- `review-code`: before commit, per project doctrine.
- No others apply: nothing touches auth, secrets or untrusted input, there is no latency budget, and there are no new endpoints or irreversible steps.

## Impact

- Shared: `packages/shared/src/platform/{env-path-key.ts (new), binary-lookup.ts, ensure-windows-path.ts, ensure-bundled-git.ts, managed-node-path.ts}`, `packages/shared/src/node-installs/child-path.ts`.
- Server: `packages/server/src/spawn-process/process-manager.ts` (`prependResolvedBinDir`).
- Behaviour on macOS/Linux is byte-identical: the helper does nothing there.
- Requires an Electron rebuild/release to reach affected users, because the Electron main builds the server's env.
- No protocol, persistence or config changes, so no migration. Rollback means reverting the commit.
