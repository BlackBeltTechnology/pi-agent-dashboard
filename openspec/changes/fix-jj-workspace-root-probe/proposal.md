# Fix: jj workspaceRoot probe should return the parent repo root

## Why

Phase 4c of `add-jj-workspace-plugin` (Decision 15) introduced workspace-aware
session grouping: sessions inside a `.shadow/<name>/` jj workspace collapse
under their parent repo's group key, with the precedence chain
`pin > jjState.workspaceRoot > cwd`.

The grouping logic is correct and tested. However, the bridge probe in
`packages/extension/src/vcs-info.ts` populates `JjState.workspaceRoot` by
calling `jj workspace root` (via `jj.workspaceRoot()`), which returns the
**current workspace's** working-copy root — i.e. the workspace's own cwd —
not the parent repo root.

As a result, for a session at `/repo/.shadow/np-tp/`:

- **Spec contract** (Decision 15): `workspaceRoot = /repo`
- **Actual probe value**: `workspaceRoot = /repo/.shadow/np-tp` (== cwd)

That makes the new collapse rule a **silent no-op** for non-default
workspaces — `pathKey(workspaceRoot) === pathKey(cwd)`, so the session still
groups under its own folder, defeating the entire purpose of the rule.

The bug is invisible without integration testing because the unit tests for
session-grouping use the spec's contract values directly, not real probe
output.

## What Changes

- Replace the `jj.workspaceRoot()` call in `gatherJjInfo` with a derivation
  that returns the **parent repo root** — the directory that hosts the
  default workspace and (in colocated repos) the `.git` directory.
- For the default workspace, this still equals `cwd` (no behavioural change).
- For non-default workspaces, it now resolves to the parent.
- Keep the existing `JjState.workspaceRoot` field shape and semantics — only
  the value populated by the probe changes.
- Add a focused integration test that uses a real `jj git init --colocate`
  + `jj workspace add` setup to verify the probe populates `workspaceRoot`
  correctly in both default and non-default workspaces. Skip the test when
  `jj` is not on PATH.

## Impact

- **Affected specs**: `jj-workspace-plugin` — clarify the probe contract for
  `workspaceRoot` (already documented in Decision 15; this aligns
  implementation with spec).
- **Affected code**:
  - `packages/extension/src/vcs-info.ts` — probe derivation logic
    (reads `<cwd>/.jj/repo` from the filesystem; `jj workspace root`
    becomes a fallback-only subprocess).
- **Backwards compatibility**: the `JjState.workspaceRoot` type stays
  identical. Existing consumers (session-grouping) immediately benefit
  without any signature change.
- **Risk**: low. Default-workspace path unchanged. Non-default path
  previously broken (no-op grouping); fix activates the documented
  behaviour.
