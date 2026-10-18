## Why

Issue: https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/474 (depends on #473, which shipped via the archived `add-plugin-spawn-scope`).

#474 asks for a reusable opt-in extension. It would reject tool calls whose path argument resolves outside the configured `allowedRoots`, support `deniedTools`, and read its config through the `string[]` `extensionConfig` convention shipped in #473/#556. Any project could load it through `scope.extensions`.

**Premise correction (issue comment + archived `add-plugin-spawn-scope` Deferred note):** this is a from-scratch build, not an extraction. No host `SessionGuardPolicy`, `collectPathCandidates` or `pathWithinRoots` ever existed, so the "delete the host guard" acceptance clause has nothing to apply to.

**Overlap to resolve first:** the shipped `agent-path-confinement` capability (`openspec/specs/agent-path-confinement/spec.md`) already gates `read` / `write` / `edit` calls outside the session roots. It canonicalises with realpath, compares component-wise, and asks the operator interactively (with a YOLO bypass). #474's extension differs in three ways: it **rejects** instead of prompting, it is **opt-in and configured per spawn**, and it can deny tools. The planning step must decide whether:
1. the extension reuses the same resolver/containment logic as a fail-closed, non-interactive mode for plugin-spawned (unattended) sessions; or
2. `agent-path-confinement` already covers the need, and #474 is closed as superseded.

## What Changes

(Assuming outcome 1.)
- A first-party extension `path-containment-guard`. It reads `allowedRoots` / `deniedTools` from `extensionConfig` and rejects out-of-root path tool calls and denied tools with a clear tool error, without prompting.
- It shares the path resolution and containment code with `agent-path-confinement`, with no second copy of the realpath or case-folding rules.
- Plugins opt in through `PluginSpawnOptions.scope.extensions`.
- Containment tests cover the extension standalone.

## Capabilities

### New Capabilities
- `path-containment-guard` (name to confirm).

### Modified Capabilities
- `agent-path-confinement` — the containment resolver is extracted into a shared module (no behaviour change).
- `plugin-spawn-scope` — documents loading the guard through `scope.extensions`.

## Non-goals

- Changing the interactive operator gate of `agent-path-confinement`.
- Shell-command path analysis for `bash`. Only path-argument tools are gated; `bash` can only be denied through `deniedTools`.

## Discipline Skills

- `security-hardening` — tool path arguments are untrusted (written by the model): traversal, symlinks, case-folding, Windows drive letters.
- `doubt-driven-review` — the outcome-1 vs outcome-2 decision, and the fail-closed semantics.
- `review-code` — before commit.

## Impact

- New extension package (location decided in planning), plus the shared resolver extracted from the `agent-path-confinement` implementation.
- Compatibility: opt-in, so there is no change for existing sessions. Rollback = do not load the extension.
