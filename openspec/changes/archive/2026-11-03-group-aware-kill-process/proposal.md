# Proposal

## Why

GitHub issue #912. On Unix, `killProcess` (`packages/shared/src/platform/process.ts`)
signals ONE pid. Windows already tree-kills (`taskkill /F /T`). Every termination
path goes through `killProcess`, so on Unix a process's own children can outlive it.
Examples: a pi's MCP server, or a long `bash` tool call.

That contradicts two specs:
- `headless-spawn` *Process group kill for headless agents*.
- `force-kill-handler`'s "entire process subtree".

The headless spec is also wrong about the keeper path. It says the kill targets `-piPid`.
But `keeper.cjs` spawns pi without `detached`, so pi shares the KEEPER's process group
and does not lead one. Verified on a live system: keeper pid = pgid, and pi plus its
MCP child carry the keeper's pgid.

The keeper fallback in `killEntry` signals the keeper's group only while the keeper is
alive. The keeper auto-exits with pi, so that signal almost never fires. pi's orphaned
children stay in the keeper's group.

## What Changes

- **`killProcess` becomes group-aware on Unix.** When `pid` leads its own process group
  and that group is not the caller's own, it delegates to the existing
  `killProcessGroup`: SIGTERM, then SIGKILL after `timeoutMs`, both to `-pid`.
  Otherwise the single-pid ladder is unchanged. This applies to every caller (sessions,
  tunnel, terminals, plugins, CLI stop) and gives parity with the Windows tree kill.
- **Safety: never signal the caller's own group.** The caller's pgid is read once via
  `ps -o pgid= -p <ownPid>` and cached. If it is unknown, `killProcess` uses single-pid.
- **Keeper fallback targets the keeper's group.** After the pi kill, a 200 ms timer calls
  `killProcessGroup(keeperPid, { timeoutMs: 2000 })`. It is gated on the group still
  existing (a no-op once gone), not on keeper liveness.
- Spec deltas align `command-executor`, `platform-primitives` and `headless-spawn`.

## Capabilities

### Modified Capabilities

- `command-executor`: `killProcess` POSIX semantics include group delegation and the
  own-group guard.
- `platform-primitives`: the `killProcess` description.
- `headless-spawn`: corrected keeper-group wording; the keeper fallback uses `killProcessGroup`.

## Impact

- `packages/shared/src/platform/process.ts`: `killProcess`, plus the private helpers
  `readOwnPgid` and `leadsForeignGroup`.
- `packages/server/src/spawn-process/headless-pid-registry.ts`: the `killEntry` keeper fallback.
- Behaviour: killing a group leader now also kills its non-detached descendants.
  Detached descendants lead their own groups and are unaffected. On the main
  single-pid path, the only extra cost is one signal-0 probe per kill.
- Compatibility: no API change. `killProcess` keeps its signature and `{ ok, forced }`
  result. Rollback: revert the two source files.
- No migration.

## Discipline Skills

- `systematic-debugging`: the root cause was established from live process-group
  evidence (keeper pgid membership) before changing code.
- `doubt-driven-review`: a shared termination primitive changes for every caller. The
  own-group guard and the single-pid fallback stress-test the blast radius.
- `review-code`: a non-trivial change to a shared primitive, reviewed before commit.
