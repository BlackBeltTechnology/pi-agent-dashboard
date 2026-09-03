# automation-folder-scope-contribution Specification

## Purpose

Let a plugin/host make a folder scope reachable to the automation engine — scanned,
armed, reaped, and watched — without a live pi session having that directory as its
cwd. Fills the gap where `folderScopeBases()` derived folder scopes only from live
session cwds.

## Requirements

### Requirement: Folder-scope contribution axis

The automation plugin SHALL expose an in-process contribution axis under the prefix
`automation.folderscope.`. A plugin/host SHALL publish a folder scope via
`ctx.provide("automation.folderscope.<id>", { base })`, where `base` is an absolute
repo root and `<id>` namespaces the contributor. The plugin SHALL collect these
contributions via `ctx.consumeAll("automation.folderscope.")` on every scope read and
union the valid, resolved bases into the session-derived folder-scope set. Collection
SHALL be load-order independent. Downstream consumers — scan/arm (`engine.refresh`),
reap (`reapStaleRuns`), and watch (`attachWatchers`) — SHALL require no change.

#### Scenario: Zero-session contributed scope is armed at boot

- **WHEN** a plugin publishes `automation.folderscope.acme = { base: "/abs/repo" }` from `registerPlugin`, `/abs/repo/.pi/automation/intake/automation.yaml` is enabled, and no session has `/abs/repo` as its cwd
- **THEN** after engine init the automation `intake` SHALL be scanned and armed, and a watcher SHALL be attached to `/abs/repo/.pi/automation/`.

#### Scenario: Contributed base equal to a session cwd is deduped

- **WHEN** a base is contributed AND a live session also has that cwd
- **THEN** the base SHALL yield exactly one folder scope and exactly one watcher (idempotent union).

### Requirement: Contribution is opt-in and validated

The plugin SHALL treat folder-scope arming as an execution-arming surface. A
contribution value SHALL be accepted only when it is a plain, non-null, non-array
object whose `base` is a string that is non-empty after trimming and that
`path.resolve` accepts; any other value SHALL be ignored and SHALL NOT prevent
collection of the remaining valid contributions. Because `folderScopeBases()` is read
on every `listScopes()` call (scan/arm, watcher reconcile, and the stale-run reaper
interval), a malformed contribution SHALL be warned at most **once per key**, not once
per read. Bases SHALL be deduped by resolved path (the same `path.resolve` applied to
session cwds, not `realpath`). A contributed base equal to the global home directory
SHALL be dropped so the `global` scope solely owns it. The plugin SHALL NOT derive
folder scopes from navigation pins, `knownFolderCwds`, or any signal other than an
explicit `automation.folderscope.` contribution; arming SHALL be gated only by
plugin-trust (a loaded plugin), the same boundary as every `ctx.provide` axis.

#### Scenario: Malformed contribution is isolated and warned once

- **WHEN** a published `automation.folderscope.*` value is missing `base`, has a non-string or whitespace-only `base`, is an array, or is not an object
- **THEN** it SHALL be ignored, the remaining valid folder-scope contributions SHALL still be collected and armed, and its warning SHALL be emitted at most once per contribution key across repeated scope reads.

#### Scenario: Contributed base equal to home dir does not double-arm

- **WHEN** a contributed base resolves to the global home directory AND global-scope scanning is enabled
- **THEN** the automation there SHALL be armed once under the `global` scope only, never additionally as a `folder` scope.

#### Scenario: Navigation pin never arms

- **WHEN** the host holds a pinned (navigation) directory that is NOT published as an `automation.folderscope.` contribution
- **THEN** that directory SHALL NOT be scanned, armed, reaped, or watched by the automation engine.

### Requirement: Boot-anchored arming; no retract; runtime live-add out of scope

The contributed scope SHALL be armed and watched when the engine first reads scopes at
boot (`engine.start()` → `refresh()` and the initial `attachWatchers()`). Collection
SHALL be load-order independent, but the boot arm is one-shot: a contribution present
in the registry when automation's engine-init timer fires SHALL be armed at boot; a
contribution whose `ctx.provide` lands after that window SHALL be treated as the
post-boot case below, not guaranteed a boot arm. A contributed scope SHALL be
process-lifetime: the host exposes no `unprovide`/retract, so the plugin SHALL NOT
promise withdrawal. Runtime addition of a contribution after boot, with no session
ever present and no watched-file change to trigger a re-scan, is OUT OF SCOPE — the
plugin SHALL NOT add an always-on re-arm timer for this case.

#### Scenario: Post-boot zero-session live-add is not armed

- **WHEN** a contribution is published after boot with zero sessions ever present and no watched-file activity
- **THEN** it SHALL NOT be armed (documented boundary — no re-arm trigger fires), rather than being treated as a defect.
