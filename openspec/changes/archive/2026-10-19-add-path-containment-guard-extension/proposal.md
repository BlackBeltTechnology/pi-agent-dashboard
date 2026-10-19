## Why

Issue: https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/474 (depends on #473, which shipped via the archived `add-plugin-spawn-scope`).

#474 asks for a reusable opt-in extension. It would reject tool calls whose path argument resolves outside the configured `allowedRoots`, support `deniedTools`, and read its config through the `string[]` `extensionConfig` convention shipped in #473/#556. Any project could load it through `scope.extensions`.

**Premise correction (issue comment + archived `add-plugin-spawn-scope` Deferred note):** this is a from-scratch build, not an extraction. No host `SessionGuardPolicy`, `collectPathCandidates` or `pathWithinRoots` ever existed, so the "delete the host guard" acceptance clause has nothing to apply to.

**Overlap to resolve first:** the shipped `agent-path-confinement` capability (`openspec/specs/agent-path-confinement/spec.md`) already gates `read` / `write` / `edit` calls outside the session roots. It canonicalises with realpath, compares component-wise, and asks the operator interactively (with a YOLO bypass). #474's extension differs in three ways: it **rejects** instead of prompting, it is **opt-in and configured per spawn**, and it can deny tools. The planning step had to choose between:
1. the extension reuses the same resolver/containment logic as a fail-closed, non-interactive mode for plugin-spawned (unattended) sessions; or
2. `agent-path-confinement` already covers the need, and #474 is closed as superseded.

**Decided: outcome 1** (operator, 2026-10-19). `agent-path-confinement` does not cover the need:
- it prompts instead of rejecting;
- its roots are the session cwd, not configured roots;
- it can be disabled machine-wide;
- it does not gate `grep`/`find`/`ls`;
- it has no `deniedTools`.

## What Changes

- **New package** `packages/path-containment-guard`, published as `@blackbelt-technology/pi-path-containment-guard` and loaded only through `-e`.
- **Behaviour.** The guard reads `allowedRoots` / `deniedTools` from `PI_EXT_PATH_CONTAINMENT_GUARD_*`, the `extensionConfig` convention. It rejects denied tools, and `read`/`write`/`edit`/`grep`/`find`/`ls` calls outside the roots, with a coded tool error and no prompt. Missing or unusable config fails closed.
- **Shared resolver.** The pi-parity path resolver and component-wise containment move from `packages/extension/src/path-gate/{resolve,decide}.ts` to `packages/shared/src/tool-path-resolve.ts`. path-gate re-imports it, so there is no second copy of the realpath or case-folding rules.
- **Security fix.** The shared resolver follows dangling symlinks, which fixes path-gate too.
- **Spawn env.** The plugin spawn env strips inherited `PI_EXT_<NAME>_*` for every extension named in `scope.extensionConfig`, plus the guard's namespace unconditionally. This runs after spawn-env contributors.
- **Plugin helper.** A pure helper `withPathContainmentGuard({ allowedRoots, deniedTools? }, baseScope?)` merges the guard into a spawn `scope`: `-e` entry plus `extensionConfig`. It throws on empty roots or malformed denied tools. Plugins then opt in without hand-typing the env namespace.
- **Tests.** Containment tests cover the extension standalone.

## Capabilities

### New Capabilities
- `path-containment-guard` — the opt-in fail-closed guard, its env contract, and the spawn-scope helper.

### Modified Capabilities
- `agent-path-confinement`:
  - Its resolver moves into a shared module.
  - **Security fix:** canonicalisation now follows a dangling symlink to its target. Today a write through an in-root dangling link (`repo/link -> ../other/new.txt`) lands outside the roots without a prompt (reproduced in doubt-review).
- `plugin-spawn-scope`:
  - A spawn whose `extensionConfig` names an extension owns that extension's `PI_EXT_<NAME>_*` namespace: inherited host vars under it are stripped, after spawn-env contributors have run.
  - `PI_EXT_PATH_CONTAINMENT_GUARD_*` is never inherited by any spawn.
  - Without this, a stale inherited guard var would silently stand in for dropped or omitted config (fail-open).

## Non-goals

- Changing the interactive operator gate of `agent-path-confinement`.
- Shell-command path analysis for `bash` / `powershell`. Only path-argument tools are gated; shell tools can only be denied through `deniedTools`.
- Defending against argument rewrites by other extensions in the same process. Those run with the process's full authority.
- Migrating the team-plugin guard (`packages/team-plugin/src/extension/guard.ts`, which has its own `canonicalize`/`inside`) onto the shared resolver. That is a follow-up. Its walk (`guard.ts:78-93`) has the same dangling-symlink escape; a follow-up issue is filed in task 5.5.
- Making any existing plugin load the guard. This change ships the capability only.

## Discipline Skills

- `security-hardening` — tool path arguments are untrusted (written by the model): traversal, symlinks, case-folding, Windows drive letters.
- `doubt-driven-review` — the outcome-1 vs outcome-2 decision, and the fail-closed semantics.
- `review-code` — before commit.

## Impact

- New package `packages/path-containment-guard`, registered in the publish allowlist, root vitest projects and knip. It is a pi extension, not a dashboard plugin, so it is not bundled into Electron `BUNDLED_PLUGINS`.
- New shared modules `packages/shared/src/tool-path-resolve.ts` and `packages/shared/src/path-containment-guard-name.ts`. `packages/extension/src/path-gate/{resolve,decide}.ts` re-import it.
- `packages/server/src/spawn-process/process-manager.ts` `buildSpawnEnv`: namespace strip.
- Migration: none. No persisted state, protocol or API changes.
- Compatibility:
  - A spawn that relied on inherited `PI_EXT_<NAME>_*` vars merging with its own `extensionConfig` for the same name now sees only its own keys. The existing named spawns are:
    - `pi-dashboard` (goal and automation);
    - `team`;
    - `chat-gateway-guard`.

    Each sets every key its extension reads (verified in task 4.3).
  - path-gate now asks about dangling-symlink escapes it previously let through.
- Rollback:
  - Guard only: stop loading it.
  - D6 (shared resolver) / D7 (spawn env): a code revert.
