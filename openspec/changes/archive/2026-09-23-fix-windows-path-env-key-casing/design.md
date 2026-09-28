## Context

See proposal.md (Why) for the failure chain. Constraints that shape the fix:

- `process.env` on win32 is a special object that ignores key case, and assigning `process.env.PATH` updates the existing `Path`. But `{ ...process.env }`, `Object.entries(process.env)` and plain-object clones keep the literal key (`Path`), and plain-object reads are case-sensitive.
- Node `child_process` (v24 `normalizeSpawnArguments`) on win32 sorts env keys and keeps the first of each upper-cased name. `"PATH" < "Path"`, so a stray `PATH` shadows the real `Path`. The de-dup happens **before** the child starts: the child's `process.env` holds only the surviving value and cannot recover what its parent dropped.
- The downstream PATH helpers each have contracts pinned by tests and specs:
  - `ensureWindowsSystemPath` and `ensureBundledGitOnPath` return identity on no-op (`ensure-windows-path.test.ts:31,37,78`, `ensure-bundled-git.test.ts:50,57,64`, `windows-git-bash-runtime` spec).
  - `prependManagedNodeToPath` always returns a clone (`managed-node-runtime` spec, `managed-node-path.test.ts:85-89`).
  - `ensureWindowsSystemPath` and `ensureBundledGitOnPath` already read and write `PATH` with `;`. The others use host `path.delimiter`.
- Where a raw process-env copy enters a PATH writer or an overlay:

  | Site | Shape |
  |---|---|
  | `ToolResolver.buildSpawnEnv` (`binary-lookup.ts:454`) | `Object.entries` copy → reads `base.PATH` → writes `PATH`. **The #720 bug.** Feeds Electron (`launch-source.ts:329`), `shared/server-launcher.ts:239`, `process-manager.buildSpawnEnv`. |
  | `pi-core-updater.ts:123` | `prependManagedNodeToPath(process.env)` → clone keeps `Path`, writes `PATH` |
  | `terminal-manager.ts:264` | `augmentEnvWithGitSource({ ...process.env, ...platformTerminalEnvHints() })` → bundled source writes `PATH` next to `Path` |
  | `runner.buildSpawnEnvForArgv` (`runner.ts:161`) | `{ ...process.env, ...ctxEnv }` overlay (latent: no current caller passes PATH) |
  | `package-manager-wrapper.ts:141` | `{ ...process.env, ...options.env }` overlay (latent) |
  | `shared/server-launcher.ts:244-248` | `buildSpawnEnv` output, then caller `opts.env` overlaid key-by-key |
  | `extension/server-launcher.ts:157` | passes `env: buildSpawnEnv(process.env, heap)`, a **full** process-env copy, into the overlay above. This violates the `server-launch` spec ("Callers MUST NOT pass `env: { ...process.env }`"): it overlays the raw PATH over the augmented one, which drops the prepends on POSIX today and would do the same on win32 once normalized. |
  | `electron/doctor.ts:432` | `{ ...process.env, PATH: extra + process.env.PATH }` gives `PATH` + `Path` on win32. It works only because Node keeps `PATH` (full value), so it is fragile. |

## Goals / Non-Goals

**Goals:**
- A single pure primitive that defines "the PATH of an env" on win32.
- Normalize at the **boundaries** where a raw process-env copy enters a PATH writer or overlay (the table above), so downstream helpers only ever see a normalized env.
- Keep every existing helper contract (identity vs clone, delimiters, signatures) unchanged.

**Non-Goals:**
- Changing `ensureWindowsSystemPath`, `ensureBundledGitOnPath`, `prependManagedNodeToPath`, `prependSelectedNodeToPath` or `prependResolvedBinDir`. They receive normalized envs from the boundaries.
- Recovering a PATH a parent already truncated. Only the fixed parent (the Electron release) repairs the server's own `process.env` and hence `/api/tools`.
- Spawn sites that only do `{ ...process.env, X: … }` without writing or overlaying PATH (`git-operations`, `restart-helper`). A lone `Path` passes through Node intact.
- `openspec-cli-shim.ts:119`. It assigns `env.PATH` on the live `process.env` proxy, which ignores case, so no copy is made and no duplicate arises.
- Normalizing other env keys (`SystemRoot`, `PATHEXT`, …).

## Decisions

1. **`packages/shared/src/platform/env-path-key.ts`** exports `normalizeEnvPathKey(env, platform = process.platform): NodeJS.ProcessEnv`. It is re-exported from `platform/index.ts`, as the existing "Single shared platform module" requirement demands a barrel, and it has no dependencies.
2. **Identity fast path.** Return the same object when:
   - the platform is not win32, or
   - no key upper-cases to `PATH`, or
   - exactly one does, it is named `PATH`, and its value is a string.

   This makes the call free on the common path and idempotent by identity.
3. **Merge, don't pick** within one env.
   - Clone the env.
   - Collect the variant keys, with `PATH` first and the rest in sorted order.
   - Split each string value on `;`, drop empty entries, and de-duplicate by `toLowerCase()`, first seen wins.
   - Delete every variant key.
   - Write `PATH` only if at least one entry survives.

   Equality is exact apart from case. There is no trailing-separator heuristic, which keeps the primitive simple. `ensureBundledGitOnPath` keeps its own stricter check for its prepends.
4. **Overlay = normalize both sides, then spread.** The merge sites become `{ ...normalizeEnvPathKey(base), ...normalizeEnvPathKey(overlay) }`, and the `server-launcher` key loop runs over the normalized overlay. Rationale: a caller-supplied PATH in any casing replaces the inherited PATH, exactly as a POSIX overlay does, instead of silently producing two keys whose winner depends on Node's sort order.
5. **Boundary wiring.** Where each site normalizes:
   - `ToolResolver.buildSpawnEnv`: right after the `ELECTRON_*` strip, with `opts.platform`. The prepend blob is then joined onto a single `PATH`. The existing host-delimiter behaviour is unchanged.
   - `pi-core-updater`: the default `_envBuilder` becomes `prependManagedNodeToPath(normalizeEnvPathKey(process.env))`.
   - `terminal-manager`: normalize the `{ ...process.env, ...hints }` object before `augmentEnvWithGitSource`.
   - `runner.buildSpawnEnvForArgv`: normalize both sides. Its existing `deps` bag gains an optional `platform` for tests.
   - `package-manager-wrapper`: normalize both sides.
   - `shared/server-launcher`: normalize `opts.env` before the overlay loop. `baseEnv` is already normalized by `buildSpawnEnv`.
   - `electron/doctor.ts`: extract a pure exported `buildServerLaunchTestEnv(bundledNode, env, platform)`, which normalizes and then prepends with the platform delimiter. The inline env literal calls it with `process.env`/`process.platform`. The extraction gives the site a test seam, so it is win32-testable.

   Every call passes an explicit `platform` where the site has a seam: `buildSpawnEnv` `opts.platform` and `runner` `deps.platform`. The overlay formula is `{ ...normalizeEnvPathKey(base, p), ...normalizeEnvPathKey(overlay, p) }`.
6. **Fix the bridge caller rather than work around it** (user decision). `extension/server-launcher.ts` `launchServer` passes only narrow overrides:
   - `DASHBOARD_STARTER`
   - `NODE_OPTIONS` plus the heap marker, from `stampHeapFlag` applied to a two-key object seeded from the inherited values. An absent result becomes `undefined`, which the overlay deletes.
   - `PI_DASHBOARD_ELECTRON: undefined` and `PI_DASHBOARD_RESOURCES_PATH: undefined`

   The existing overlay loop already deletes keys set to `undefined`. The exported `buildSpawnEnv` in that file is replaced by a `buildBridgeEnvOverrides(baseEnv, heapMb)` builder, since its only production caller is `launchServer`; its tests migrate with it. Rationale: this honours the `server-launch` env-merge contract, keeps the prepends on both POSIX and win32, and makes the overlay normalization in the shared launcher a no-op for this caller. See the server-launch delta.
7. **Delimiter fidelity under test.** In `ToolResolver.buildSpawnEnv` the prepend join uses `opts.platform === "win32" ? ";" : path.delimiter` instead of host `path.delimiter`. Production output is identical, and on POSIX CI the win32 output becomes a well-formed `;` PATH that tests can split exactly.

## Risks / Trade-offs

- [Overlay semantics on win32 change from "two keys, `PATH` wins by sort" to "caller wins"] → This matches POSIX. The only production caller that overlaid PATH (the bridge) no longer does (decision 6).
- [Bridge-launched server env changes on POSIX: it now keeps the `buildSpawnEnv` prepends it was silently losing] → This is the behaviour the `server-launch` spec always required. The prepends are directories the dashboard owns (managed bin, bundled node), and user PATH entries are kept after them.
- [Boundary sites without a platform seam can't be win32-tested on POSIX CI] (`pi-core-updater` default, `terminal-manager`, `package-manager-wrapper`, `shared/server-launcher` overlay) → Each is a one-line call into the primitive. The primitive and the #720 chokepoint (`buildSpawnEnv`) are platform-injected and unit-tested, as is the latent `runner` overlay. The rest are covered by POSIX pass-through tests plus manual Windows QA.
- [A user deliberately sets different `Path` and `PATH` values in one env] → Ambiguous by OS semantics. Within one env the merge keeps both, `PATH` first, which is a superset of what Node would pass.
- [The hot spawn path] → O(keys) on the identity path; a merge is O(entries).

## Migration Plan

No data or config migration. Signature changes:
- optional `runner` `deps.platform`
- the extension-internal `buildSpawnEnv` becomes `buildBridgeEnvOverrides`. The extension package does not import it anywhere else.

Ships in the next release. A server started from a normal shell is fixed by the server/shared code alone (jiti, no build). The Electron artifacts are required for the Electron-launched server's own `process.env`, and so for `/api/tools` and Doctor. Rollback means reverting the commit.
