## MODIFIED Requirements

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
floor (read from the package.json of the pi copy being spawned, falling back to the shared pi
spawn floor when unreadable) AND is not in the nodejs/node#58515 affected range. The pi spawn
floor is distinct from the dashboard server floor: raising the server's `engines.node` floor SHALL
NOT raise the floor applied to pi-session spawns. The gate
SHALL reuse the shared affected-range predicate from `node-version.ts`, and any floor
constant/comparator it needs SHALL live in that same module as the single defining occurrence —
no consumer SHALL carry a private copy of either range. A
candidate at or above the dashboard's engines cap SHALL still be accepted (pi declares no cap); a
candidate in the affected range SHALL be treated exactly as if absent.

The ladder governs pi-session spawns (processes that load the shared extension tree
`~/.pi/agent/npm/node_modules`) only. The Electron arm SHALL continue to run the dashboard server
itself on its bundled Node.

#### Scenario: Pi-session gate ignores the dashboard server floor

- **WHEN** the dashboard server floor is `26.0.0`
- **AND** the spawned pi copy's `engines.node` is unreadable
- **AND** the only user Node resolvable is `v24.15.0`
- **THEN** the gate SHALL accept `v24.15.0` against the pi spawn floor `22.19.0`
- **AND** the resolved pi-session spawn runtime SHALL be that Node

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

## ADDED Requirements

### Requirement: Server-spawn runtime resolution

The shared ladder module in `packages/shared` SHALL also resolve the Node binary that runs the
dashboard **server** when a starter cannot rely on a known-good runtime: the bridge's auto-start
and the Electron app when no bundled Node exists. It SHALL use the same candidate probes as the
pi-session ladder, but gated on the dashboard server's `engines.node` range (`>=26.0.0 <27`)
instead of pi's floor. The order is: (1) the user-owned override `runtime.override` from
`~/.pi/dashboard/config.json`; (2) the first `node` on the inherited `PATH`; (3) every existing
version-manager default found by the existing filesystem probe (nvm `alias/default`, volta / asdf
/ mise / fnm shims), each as its own candidate in that order — a below-floor default for one
manager SHALL NOT hide a qualifying default for another; (4) the managed Node under `<managedDir>/node/`; (5) the starter's own runtime — pi's
`process.execPath` for the bridge, Electron's executable in Node mode for the Electron app —
whose version is read from the running process, not assumed. Every candidate, including (5),
SHALL pass the gate to be selected; gate-failing, missing, or unparseable-version candidates
(a `--version` output that is not a clean semver) are skipped with a recorded reason.

Unlike the pi-session ladder this resolution SHALL NOT be total: when no candidate passes the gate
it SHALL return an unresolved result carrying every skipped candidate and its reason. It SHALL NOT
invoke a login shell or any other shell. A Node reachable only through shell initialisation (e.g.
an nvm install with no `alias/default`) is therefore not found; this is an accepted trade-off
because terminal-launched pi inherits the activated `PATH`.

#### Scenario: pi on Node 24 with Node 26 on PATH

- **WHEN** pi runs on Node `v24.15.0`
- **AND** the first `node` on `PATH` is `v26.1.0`
- **THEN** the resolved server runtime SHALL be the `PATH` Node `v26.1.0`

#### Scenario: Version-manager default found without a shell

- **WHEN** neither the override nor the `PATH` Node passes the gate
- **AND** the nvm default alias names an installed `v26.0.0`
- **THEN** the resolved server runtime SHALL be that Node, discovered by filesystem probe alone

#### Scenario: Starter's own runtime used only when it qualifies

- **WHEN** no earlier candidate passes the gate
- **AND** the starter's own runtime reports `v26.2.0`
- **THEN** the resolved server runtime SHALL be the starter's own runtime
- **AND** when the starter's own runtime reports `v24.18.1` instead, it SHALL be skipped with a recorded reason

#### Scenario: No qualifying Node

- **WHEN** no candidate passes the gate (e.g. pi on `v22.19.0`, `PATH` Node `v24.15.0`, no managed
  Node, no version-manager Node 26)
- **THEN** resolution SHALL return an unresolved result listing each candidate with its version and
  skip reason

#### Scenario: No shell invocation

- **WHEN** server-spawn runtime resolution runs on any platform
- **THEN** no `sh`, `bash`, `zsh`, `cmd.exe` or PowerShell process SHALL be spawned by the resolver

#### Scenario: Second version manager qualifies

- **WHEN** the nvm default names `v24.15.0` and the volta shim runs `v26.0.0`
- **AND** neither the override nor the `PATH` Node qualifies
- **THEN** the resolved server runtime SHALL be the volta Node

#### Scenario: Unparseable version is skipped

- **WHEN** a candidate's `node --version` prints output that is not a clean semver
- **THEN** that candidate SHALL be skipped with a recorded reason and resolution SHALL continue

#### Scenario: Bounded probe cost

- **WHEN** server-spawn runtime resolution runs with every candidate present and failing the gate
- **THEN** it SHALL spawn at most one `node --version` probe per distinct candidate path (override,
  `PATH` first hit, each existing version-manager default, managed) and none for the starter's own
  runtime
