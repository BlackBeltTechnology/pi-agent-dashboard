## Context

See proposal.md (Why) for the failure chain. Constraints that shape the fix:

- `process.env` on win32 is a special object that ignores key case, but `{ ...process.env }`, `Object.entries(process.env)` and plain-object env clones keep the literal key (`Path`), and plain-object reads are case-sensitive.
- Node `child_process` on win32 sorts env keys, drops later keys whose upper-cased name repeats, and keeps the first. `"PATH" < "Path"`, so a stray `PATH` key shadows the real `Path` key.
- The PATH-mutating helpers form a pipeline:
  - `buildSpawnEnv` → `ensureWindowsSystemPath` → `augmentEnvWithGitSource` → `ensureBundledGitOnPath`, then (server) `prependSelectedNodeToPath` / `prependManagedNodeToPath` / `prependResolvedBinDir`.
  - Several of them are also called directly with a raw env:
    - `pi-core-updater` → `prependManagedNodeToPath(process.env)`
    - `terminal-manager` → `augmentEnvWithGitSource({ ...process.env })`
- Existing helpers already take an injectable `platform` (`ensureWindowsSystemPath`, `buildSpawnEnv` opts) for POSIX-hosted tests.

## Goals / Non-Goals

**Goals:**
- One helper that defines "the PATH of an env" on win32, used by every shared PATH mutator.
- Self-heal envs that already carry both keys, e.g. from an older Electron main that launched the server with a buggy env.

**Non-Goals:**
- Normalizing other env keys (`SystemRoot`, `PATHEXT`, …). `ensureWindowsSystemPath` already reads `SystemRoot` variants itself.
- Changing lookup strategy, search order or the tool registry.
- The `electron/doctor.ts` test-launch env. It reads `process.env.PATH`, which ignores case, and its `PATH` key already holds the full value, so it works as-is.

## Decisions

1. **New module `packages/shared/src/platform/env-path-key.ts`** exporting `normalizeEnvPathKey(env, platform = process.platform): NodeJS.ProcessEnv`.
   - It sits next to the other platform primitives and has no dependencies.
   - Alternative considered: fix only `buildSpawnEnv` (`base.Path ?? base.PATH`). Rejected because it leaves the same flaw in `pi-core-updater`, the PTY terminal and every helper, and it does not merge duplicates.
2. **Merge, don't pick.** On win32:
   - Collect every key with `k.toUpperCase() === "PATH"`.
   - Put `PATH` first, then the other variants in sorted order.
   - Split each value on `;`, drop empties, and de-duplicate case-insensitively in first-seen order (trailing `\`/`/` ignored for the comparison).
   - Delete all the variant keys and write a single `PATH`.

   Reason: an env that already has a truncated `PATH` next to a full `Path` (the #720 state) must recover the full entries. Picking either key alone loses data.
3. **Normalize at entry of each PATH mutator.** The helpers are:
   - `buildSpawnEnv`: after the `ELECTRON_*` strip, using `opts.platform`.
   - `ensureWindowsSystemPath`
   - `ensureBundledGitOnPath`
   - `prependManagedNodeToPath`
   - `prependSelectedNodeToPath`
   - `prependResolvedBinDir`

   Each helper is independently correct for raw-env callers. Normalizing an already-normalized env returns an identical clone, so the cost is negligible (O(keys)).

   Alternative considered: normalize only at spawn call sites. Rejected because there are many call sites, and a new one could easily be added without it.
4. **Platform injection.** Each helper passes its injected platform when it has one, and falls back to `process.platform` otherwise, so the win32 path can be tested on macOS/Linux CI.

## Risks / Trade-offs

- [A user deliberately sets different values under `Path` and `PATH` on Windows] → This is ambiguous by OS semantics. Merging keeps both sets of entries, `PATH` first, which is a superset of what Node would have passed.
- [Merged PATH exceeds Windows' 32,767-char env block limit] → De-duplication makes the result no longer than the union of the inputs. This is not a new risk.
- [The helper runs on hot spawn paths] → It is O(keys + entries) per spawn, which is negligible next to process creation.
- [Existing Electron installs keep launching the server with a broken env until they upgrade] → The server-side helpers self-heal the env on every spawn they build. The server's own `where` inherits its process env, so the Electron release is what fully fixes `/api/tools`.

## Migration Plan

No data or config migration. Ships with the next release, including the Electron artifacts. Rollback means reverting the commit.
