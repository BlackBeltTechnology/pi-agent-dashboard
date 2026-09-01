# managed-node-runtime Specification

## Purpose

Persistent, managed Node.js runtime under `<managedDir>/node/` (where `<managedDir>` is `~/.pi-dashboard/`) installed from the Electron-bundled Node tree. Provides a stable Node + npm pair that survives Electron upgrades and standalone CLI reinstalls, is preferred by `ToolRegistry`, and is injected onto the `PATH` of every child process the dashboard spawns. Restored automatically by Doctor / `pi-dashboard repair` when missing or version-mismatched.

## Requirements

### Requirement: Persistent Node runtime under managed directory

The dashboard SHALL maintain a persistent Node.js runtime at `<managedDir>/node/` (where `<managedDir>` is `~/.pi-dashboard/`) that survives Electron app upgrades and standalone CLI reinstalls.

#### Scenario: Managed Node directory layout on Windows

- **WHEN** `installManagedNode(managedDir)` completes successfully on Windows
- **THEN** `<managedDir>/node/node.exe` SHALL exist
- **AND** `<managedDir>/node/npm.cmd` SHALL exist
- **AND** `<managedDir>/node/npx.cmd` SHALL exist
- **AND** `<managedDir>/node/node_modules/npm/bin/npm-cli.js` SHALL exist

#### Scenario: Managed Node directory layout on Unix

- **WHEN** `installManagedNode(managedDir)` completes successfully on macOS or Linux
- **THEN** `<managedDir>/node/bin/node` SHALL exist
- **AND** `<managedDir>/node/bin/npm` SHALL exist
- **AND** `<managedDir>/node/lib/node_modules/npm/bin/npm-cli.js` SHALL exist

#### Scenario: Managed Node persists across Electron upgrade

- **WHEN** the Electron app is upgraded to a new version that ships a different bundled Node
- **THEN** the existing `<managedDir>/node/` SHALL remain on disk untouched until the next explicit install or repair invocation

### Requirement: Idempotent installation from bundled source

`installManagedNode(managedDir)` SHALL copy the bundled Node runtime resolved via `getBundledNodePath()` (and its sibling `getBundledNpmPath()`) into `<managedDir>/node/`, and SHALL skip the copy when an existing managed Node already matches the bundled source's version.

#### Scenario: First-run copy

- **WHEN** `installManagedNode(managedDir)` is called and `<managedDir>/node/` does not exist
- **THEN** the entire bundled Node directory tree SHALL be copied to `<managedDir>/node/`
- **AND** a `<managedDir>/node/.version` marker file SHALL be written containing the bundled Node version string (e.g. `v22.12.0`)

#### Scenario: Re-run with matching version

- **WHEN** `installManagedNode(managedDir)` is called and `<managedDir>/node/.version` matches the bundled Node version
- **THEN** no copy SHALL be performed
- **AND** the function SHALL return without error

#### Scenario: Re-run with mismatched version

- **WHEN** `installManagedNode(managedDir)` is called and `<managedDir>/node/.version` does not match the bundled Node version (or the marker is missing while the directory exists)
- **THEN** the existing `<managedDir>/node/` SHALL be replaced with a fresh copy of the bundled Node tree
- **AND** the `.version` marker SHALL be rewritten to the bundled Node version

#### Scenario: No bundled source available

- **WHEN** `installManagedNode(managedDir)` is called and `getBundledNodePath()` returns `null` (standalone CLI install with no Electron resources)
- **THEN** the function SHALL return without error and without writing any files

#### Scenario: Failed copy leaves no version marker

- **WHEN** `installManagedNode(managedDir)` fails partway through the copy (e.g. disk-full, permission denied)
- **THEN** the `.version` marker SHALL NOT be written
- **AND** the next invocation SHALL treat the managed Node as missing and retry the copy

### Requirement: ToolRegistry resolves managed runtime first

`ToolRegistry.resolve("node")` and `ToolRegistry.resolve("npm")` SHALL prefer the managed runtime under `<managedDir>/node/` when present, while still allowing `tool-overrides.json` to take precedence.

#### Scenario: Managed Node preferred over PATH

- **WHEN** `<managedDir>/node/node.exe` (Windows) or `<managedDir>/node/bin/node` (Unix) exists
- **AND** no override exists for `node` in `tool-overrides.json`
- **THEN** `ToolRegistry.resolve("node")` SHALL return the managed-runtime path
- **AND** the resolution SHALL NOT fall through to `where`/PATH lookup

#### Scenario: Override still wins over managed runtime

- **WHEN** `tool-overrides.json` declares `{ "node": "/custom/path/node" }`
- **AND** `<managedDir>/node/bin/node` also exists
- **THEN** `ToolRegistry.resolve("node")` SHALL return `/custom/path/node`

#### Scenario: Standalone fallback when managed is absent

- **WHEN** `<managedDir>/node/` does not exist
- **AND** no override exists for `node`
- **THEN** `ToolRegistry.resolve("node")` SHALL fall through to the existing `where`/PATH-based strategy chain

### Requirement: Doctor re-runs managed Node installation

The Doctor diagnostic and `pi-dashboard repair` SHALL invoke `installManagedNode(managedDir)` as part of their checks so that a missing or version-mismatched managed Node is restored.

#### Scenario: Doctor restores missing managed Node

- **WHEN** the user runs Doctor and `<managedDir>/node/` is missing on a system with bundled resources
- **THEN** Doctor SHALL invoke `installManagedNode(managedDir)`
- **AND** `<managedDir>/node/` SHALL exist with a valid `.version` marker after Doctor completes

#### Scenario: Doctor re-copies on version mismatch

- **WHEN** the user runs Doctor and `<managedDir>/node/.version` does not match the bundled Node version
- **THEN** Doctor SHALL re-copy the bundled Node tree into `<managedDir>/node/`
- **AND** the `.version` marker SHALL be updated to the bundled Node version

#### Scenario: Doctor is a no-op when managed Node matches bundled

- **WHEN** the user runs Doctor and `<managedDir>/node/.version` already matches the bundled Node version
- **THEN** Doctor SHALL NOT re-copy any files
- **AND** the existing managed Node directory SHALL remain unchanged

### Requirement: Spawn-runtime resolution ladder

The dashboard SHALL resolve exactly one spawn runtime for pi sessions at every server start, trying
in order: (1) the user-owned explicit override (`runtime.override` in `~/.pi/dashboard/config.json`,
a key the dashboard itself never writes; an explicit Node-installation selection from the
family-selection surface is read as a step-1 candidate under the same gate), honoured only when the
named binary exists and passes the version gate; (2) the user's Node — candidates evaluated in
terminal-fidelity order, which is arm-dependent — GUI/service launches evaluate the login-shell
resolution first, then the inherited `PATH`'s first hit; terminal-launched arms (and Windows)
evaluate the inherited `PATH`'s first hit first, then the login-shell resolution — followed on
both by a filesystem probe of well-known version-manager defaults (no shell invocation); each
source contributes its first hit only, the first gate-passing candidate wins, and gate-failing
candidates are skipped with a recorded reason; (3) the managed Node under
`<managedDir>/node/` when installed and gate-passing; (4) the dashboard's own runtime — the
Electron-bundled Node on the Electron arm, `process.execPath` on every other arm. The ladder SHALL
be total: it cannot fail to resolve on any arm.

The version gate SHALL accept a candidate that satisfies the resolved pi package's `engines.node`
floor (read from the package.json of the pi copy being spawned, falling back to the shared
canonical floor when unreadable) AND is not in the nodejs/node#58515 affected range. The gate
SHALL reuse the shared affected-range predicate from `node-version.ts`, and any floor
constant/comparator it needs SHALL live in that same module as the single defining occurrence —
no consumer SHALL carry a private copy of either range. A
candidate at or above the dashboard's engines cap SHALL still be accepted (pi declares no cap); a
candidate in the affected range SHALL be treated exactly as if absent.

The ladder governs pi-session spawns (processes that load the shared extension tree
`~/.pi/agent/npm/node_modules`) only. The Electron arm SHALL continue to run the dashboard server
itself on its bundled Node.

#### Scenario: Override wins over user Node

- **WHEN** the config override names an existing Node binary that passes the version gate
- **AND** a different user Node is also resolvable on `PATH`
- **THEN** the resolved spawn runtime SHALL be the override binary

#### Scenario: Invalid override falls through

- **WHEN** the config override — or the family-selection step-1 candidate — names a binary that
  is missing or fails the version gate
- **THEN** resolution SHALL continue with step 2 as if no override were set
- **AND** the failure reason SHALL be recorded for diagnostics and surfaced in the Doctor
  runtime row

#### Scenario: User Node outranks managed Node

- **WHEN** no override is set
- **AND** a user Node passing the version gate is resolvable via `PATH` or login shell
- **AND** a managed Node is installed under `<managedDir>/node/`
- **THEN** the resolved spawn runtime SHALL be the user's Node

#### Scenario: Version-manager default is discovered without a shell

- **WHEN** no gate-passing Node is resolvable via the login shell or `PATH`
- **AND** a version-manager default (e.g. nvm `alias/default`) names an installed, gate-passing
  Node
- **THEN** the resolved spawn runtime SHALL be that Node, discovered by filesystem probe alone

#### Scenario: Stale managed Node is skipped

- **WHEN** no override is set and no gate-passing user Node exists
- **AND** the installed managed Node fails the version gate (below pi's floor or in the affected
  range)
- **THEN** step 3 SHALL be skipped with a recorded reason and resolution SHALL terminate at the
  dashboard's own runtime

#### Scenario: Affected-range user Node is treated as absent

- **WHEN** the only user Node resolvable is version 24.1.x or 24.2.x (in-floor but
  nodejs/node#58515-affected)
- **AND** a managed Node is installed
- **THEN** step 2 SHALL reject the user Node and the resolved runtime SHALL be the managed Node

#### Scenario: Above-cap user Node is accepted

- **WHEN** the only gate-relevant user Node has a major version at or above the dashboard's engines
  cap
- **AND** it satisfies pi's floor
- **THEN** the resolved spawn runtime SHALL be that Node
- **AND** the diagnostic surface SHALL note it exceeds the dashboard-tested range

#### Scenario: Terminal rung on the Electron arm

- **WHEN** no override is set, no gate-passing user Node exists, and no managed Node is installed
- **AND** the dashboard runs as the Electron app
- **THEN** the resolved spawn runtime SHALL be the Electron-bundled Node

#### Scenario: Terminal rung on non-Electron arms

- **WHEN** no override is set, no gate-passing user Node exists, and no managed Node is installed
- **AND** the dashboard runs as an npm-installed server, dev checkout, or in docker
- **THEN** the resolved spawn runtime SHALL be `process.execPath`

#### Scenario: Spawn-time re-validation

- **WHEN** a pi session is about to spawn and the previously resolved runtime binary no longer
  exists, or no longer resolves to the same real path and version (e.g. a version-manager symlink
  retargeted since resolution)
- **THEN** the spawn SHALL NOT use the stale resolution; the ladder SHALL re-resolve before the
  spawn proceeds

### Requirement: Pi-session spawns use the resolved runtime

Every pi-session spawn the dashboard controls SHALL derive its Node environment from the ladder
result: the resolved runtime's bin directory SHALL be the first `PATH` entry of the child
environment, and any spawn mechanism that passes an explicit Node binary in argv SHALL use the
resolved binary. No unconditional managed-Node prepend SHALL remain on the pi-session spawn path.

When an explicit Node installation selection exists (the family-selection surface), the ladder
SHALL read it as its gated step-1 candidate — there SHALL NOT be two competing selection
mechanisms for the pi-session spawn runtime. Shared-tree operations follow the ladder result even
where dashboard-tooling resolution follows the selection directly.

#### Scenario: Pi session inherits the resolved runtime

- **WHEN** the dashboard spawns a pi session and the ladder resolved the user's Node
- **THEN** the child's `PATH` SHALL contain the resolved runtime's bin directory as its first entry
- **AND** the managed Node directory SHALL NOT appear ahead of it

#### Scenario: Explicit-argv spawns use the resolved binary

- **WHEN** a pi session is spawned via an explicit node-binary + script argv (e.g. Windows headless
  spawn)
- **THEN** the Node binary in argv SHALL be the ladder-resolved binary

#### Scenario: Process environment is not globally mutated

- **WHEN** the spawn environment is constructed from the ladder result
- **THEN** `process.env` of the dashboard server SHALL NOT be mutated
- **AND** the constructed environment SHALL be a distinct object passed to the spawn call

### Requirement: Managed-tree mutations retain the managed runtime

Mutations of the managed tree (`<managedDir>/node_modules/`, e.g. pi-core updates) SHALL continue
to prefer the managed Node family when the managed runtime is installed: that tree's owning runtime
is the managed Node, so it SHALL be built by it. When no managed runtime is installed the mutation
environment SHALL be unchanged (no-op prepend), as today.

#### Scenario: pi-core-updater inherits managed Node

- **WHEN** a managed-source package update spawns `npm` for the managed tree
- **AND** `<managedDir>/node/` exists
- **THEN** the spawned process's `PATH` SHALL contain the managed Node directory as its first entry

#### Scenario: No-op without managed runtime

- **WHEN** a managed-tree mutation is spawned and `<managedDir>/node/` does not exist
- **THEN** the environment SHALL be a shallow clone with `PATH` unchanged

### Requirement: Resolved runtime is published for diagnosis

On every server start the dashboard SHALL publish the resolved spawn runtime to
`~/.pi/dashboard/config.json` as `runtime.resolved`, carrying at least: the runtime bin directory,
the Node binary path, the Node ABI number, the classification source (via `classifyNodeSource`),
and the resolution timestamp. The block SHALL be diagnostic and inspectable only: no component
SHALL consume it to construct a spawn environment — the ladder re-resolves live at every start.
The user-owned `runtime.override` key is disjoint; the dashboard SHALL never write it, so
publication can neither destroy a user's pin nor become one.

Bundle-internal paths SHALL never be persisted — stable installs included, not just ephemeral
mounts (AppImage `/tmp/.mount_*`, macOS `/AppTranslocation/`): when the resolved runtime is the
bundled Node — on stable and ephemeral installs alike — the published block SHALL record
classification, ABI, and timestamp without an absolute bundle path, and the path SHALL be
re-derived live from the running process at each launch.

#### Scenario: Publication on start

- **WHEN** the server completes startup with a ladder-resolved runtime outside the app bundle
  (user, managed, or override)
- **THEN** `runtime.resolved` in `~/.pi/dashboard/config.json` SHALL name that runtime's binary,
  ABI, and classification

#### Scenario: Bundled runtime publishes without a path

- **WHEN** the resolved runtime is the Electron-bundled Node, on any install (stable or ephemeral)
- **THEN** `runtime.resolved` SHALL record the classification and ABI
- **AND** SHALL NOT contain any path under the app bundle

#### Scenario: Publication never touches the override

- **WHEN** `runtime.resolved` is written on startup
- **AND** the user has set `runtime.override`
- **THEN** `runtime.override` SHALL be byte-identical before and after the write

#### Scenario: AppImage bundle path is not persisted

- **WHEN** the resolved runtime is the bundled Node under an AppImage mount (`/tmp/.mount_*`)
- **THEN** the published block SHALL NOT contain the mount path
- **AND** the runtime SHALL be recorded as ephemeral/bundled

#### Scenario: Translocated macOS bundle path is not persisted

- **WHEN** the resolved runtime is the bundled Node under a macOS App Translocation mount
  (`/AppTranslocation/`)
- **THEN** the published block SHALL NOT contain the translocated path
- **AND** the runtime SHALL be recorded as ephemeral/bundled

#### Scenario: Stale block does not steer resolution

- **WHEN** the published block names a binary that has since been deleted
- **AND** the server restarts
- **THEN** the ladder SHALL resolve fresh, spawns SHALL use the fresh result, and the block SHALL
  be rewritten

### Requirement: Install/load coherence for the shared extension tree

Extension-tree mutations the dashboard itself performs (recommended-extension installs, ABI
reconciliation rebuilds of `~/.pi/agent/npm/node_modules`) SHALL use the same Node family as the
resolved spawn runtime, so the shared tree is always built by the runtime that will load it.

#### Scenario: Extension install uses the resolved family

- **WHEN** the dashboard installs a recommended extension into the shared tree
- **AND** the ladder resolved the user's Node
- **THEN** the install SHALL run with the user's Node family, not the bundled or managed one

#### Scenario: Bundled-only machine stays coherent

- **WHEN** the ladder resolved the bundled Node (no user Node, no managed Node)
- **THEN** extension installs SHALL use the bundled npm
- **AND** the tree is built and loaded by the same runtime
