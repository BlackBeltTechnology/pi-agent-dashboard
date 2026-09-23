## Why

Issue #720: on Windows the tool resolver treats installed tools (`git`, `gh`, `npx`, `tailscale`) as not found. Spawned sessions pick the wrong git, or none at all, and the folder watchers fail with `ENOENT`.

The root cause is that Windows stores the variable as `Path`. `process.env` itself ignores key case, but a **copy** of it (`{ ...process.env }` or `Object.entries`) keeps the literal `Path` key. `ToolResolver.buildSpawnEnv()` copies the env and then reads `base.PATH`, which is `undefined`. It builds a new `PATH` from only the dirs it prepends, so the output holds **both** `Path` (the full value) and `PATH` (the prepended dirs only).

When Node spawns a child on win32, it drops env keys that differ only in case. It sorts the keys and keeps the first one, and `"PATH"` sorts before `"Path"`, so the full system PATH is thrown away. Electron launches the server with this env (`launch-source.ts`), so the server's own `where` lookups and every session it spawns inherit the cut-down PATH.

## What Changes

- New pure primitive `normalizeEnvPathKey(env, platform?)` in `packages/shared/src/platform/env-path-key.ts`, re-exported from the platform barrel:
  - On win32 it merges every case variant of `PATH` into a single `PATH` key. Entries are de-duplicated case-insensitively, `PATH` goes first, and the original order is kept.
  - It returns the **same object** when there is nothing to merge, and on POSIX.
  - It never mutates the input.
- The primitive is applied at the **boundaries** where a raw copy of `process.env` enters a PATH writer or an env overlay:
  - `ToolResolver.buildSpawnEnv`, which is the #720 bug
  - the `pi-core-updater` default env builder
  - the PTY terminal env
  - the overlay sites `runner.buildSpawnEnvForArgv`, `package-manager-wrapper` and `shared/server-launcher`
  - the Electron Doctor test-launch env
- At overlay sites both sides are normalized before merging, so a caller-supplied PATH in any casing replaces the inherited one. This is the same as POSIX overlay semantics.
- The bridge's server auto-spawn (`extension/server-launcher.ts`) currently passes a full `process.env` copy as `env`, which the `server-launch` spec forbids. It will pass only narrow overrides instead. This keeps the `buildSpawnEnv` PATH prepends on every platform; today it silently drops them on POSIX too.
- The downstream PATH helpers (`ensureWindowsSystemPath`, `ensureBundledGitOnPath`, the node-prepend helpers) are **unchanged**. They only receive normalized envs, so their identity/clone contracts and existing tests stay as they are.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `platform-primitives`: adds the requirement "Spawn-env PATH key is case-normalized on Windows". On win32, the spawn-env builder and the process-env overlay sites produce at most one PATH key, named `PATH`, which keeps the inherited entries. A caller overlay replaces the inherited PATH.
- `server-launch`: adds the requirement "Bridge auto-spawn passes only narrow env overrides".

## Discipline Skills

- `systematic-debugging`: the bug was root-caused from the report through the code and Node's win32 env de-dup rule. Tests reproduce it (a `Path`-keyed env on the win32 platform) and fail before the fix.
- `doubt-driven-review`: ran during planning, over 3 cycles including cross-model review. It narrowed the fix from "every helper" to boundary normalization.
- `review-code`: before commit, per project doctrine.
- No others apply: nothing touches auth, secrets or untrusted input, there is no latency budget, and there are no new endpoints or irreversible steps.

## Impact

- Shared:
  - `packages/shared/src/platform/env-path-key.ts` (new), `platform/index.ts` (re-export)
  - `platform/binary-lookup.ts` (`buildSpawnEnv`)
  - `platform/runner.ts` (`buildSpawnEnvForArgv`, optional `deps.platform`)
  - `packages/shared/src/server-launcher.ts` (overlay)
- Extension: `packages/extension/src/server-launcher.ts` (`buildSpawnEnv` → `buildBridgeEnvOverrides`, narrow overrides)
- Electron: `packages/electron/src/lib/doctor.ts` (test-launch env)
- Server:
  - `packages/server/src/pi/pi-core-updater.ts` (default `_envBuilder`)
  - `packages/server/src/terminal/terminal-manager.ts`
  - `packages/server/src/package/package-manager-wrapper.ts`
- On macOS/Linux the primitive returns its input unchanged. The one intended POSIX change is that the bridge-launched server now keeps the `buildSpawnEnv` prepends.
- Signature changes: the optional `runner` `deps.platform`, and the extension-internal rename.
- A server started from a normal shell is fixed by the server/shared code alone. The Electron-launched server's own env, and with it `/api/tools` and Doctor, needs the Electron rebuild/release: Node drops the duplicate key before the server starts, so the server cannot recover it.
- No protocol, persistence or config changes, so no migration. Rollback means reverting the commit.
