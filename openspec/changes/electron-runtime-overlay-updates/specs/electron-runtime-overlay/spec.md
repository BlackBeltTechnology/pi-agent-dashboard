## Purpose

Lets the Electron app run and update the dashboard runtime (server, web client, bridge extension and first-party plugins) from a writable overlay (npm, GitHub release or a linked local folder), with the read-only bundle as the guaranteed fallback.

## ADDED Requirements

### Requirement: Runtime release is the unit of update

A runtime release X SHALL be defined by a runtime lockfile published with release X that pins, at exact versions, the dashboard meta package, server, web client, bridge extension, every first-party plugin declared by that release, and all their dependencies including pi, openspec and tsx. Staging SHALL install exactly the locked tree. The system SHALL NOT activate an overlay in which any first-party package differs from version X.

#### Scenario: Coherent release staged

- **WHEN** runtime release X is staged from npm or GitHub
- **THEN** every first-party package in the staged tree SHALL be at version X
- **AND** pi, openspec and tsx SHALL be at the versions pinned by X's lockfile
- **AND** the staged tree SHALL contain a runtime manifest recording version, minimum shell version, supported Node range, origin and pi version

#### Scenario: Same release, same tree

- **WHEN** release X is staged twice on the same platform
- **THEN** both staged trees SHALL resolve identical package versions

#### Scenario: Mixed versions refused

- **WHEN** a staged tree contains a first-party package whose version differs from X
- **THEN** staging SHALL fail with a reason naming the mismatched package
- **AND** the tree SHALL NOT become pending

#### Scenario: First-party plugins available

- **WHEN** the server runs from overlay X
- **THEN** every first-party plugin declared by X SHALL be discovered and loaded as it is from the bundle

### Requirement: Selectable update source and channel

The user SHALL be able to select the runtime source `bundled`, `npm`, `github` or `local`, and for `npm`/`github` the channel `stable`, `beta` or a pinned exact version. The selection SHALL persist across restarts. The default SHALL be `bundled`.

#### Scenario: Default is bundled

- **WHEN** no runtime selection has ever been made
- **THEN** the Electron app SHALL launch the bundled runtime exactly as before this change

#### Scenario: Pinned version

- **WHEN** source is `npm` or `github` AND channel is pinned to version X
- **THEN** update checks SHALL report X as the target regardless of newer releases

#### Scenario: Newer release found

- **WHEN** the update check finds a release newer than the active runtime on the selected channel
- **THEN** the dashboard SHALL show that the release is available
- **AND** SHALL NOT stage or activate it without an explicit user action

#### Scenario: Beta channel

- **WHEN** channel is `beta`
- **THEN** the target SHALL be the newest release including prereleases

### Requirement: Integrity-verified staging

Downloaded runtimes SHALL be verified before they can become pending. npm installs SHALL rely on registry integrity; GitHub assets SHALL match their published sha512. An interrupted or failed staging SHALL NOT leave a tree that is considered installed.

#### Scenario: Checksum mismatch

- **WHEN** a GitHub runtime asset's sha512 does not match the published checksum
- **THEN** staging SHALL fail AND the asset SHALL be discarded AND the current runtime SHALL be unchanged

#### Scenario: Interrupted download

- **WHEN** staging is interrupted (network loss, app quit)
- **THEN** the partial tree SHALL NOT be selectable as current or pending
- **AND** the next staging attempt SHALL start clean

#### Scenario: Only allowlisted packages

- **WHEN** an update request names a package outside the first-party runtime allowlist
- **THEN** the request SHALL be rejected

### Requirement: Compatibility gate before activation

Before spawning an overlay or local runtime, the Electron app SHALL verify that the runtime's minimum shell version is satisfied, that its Node major is compatible with the Node the shell will run it with, and that required files exist. A runtime failing the gate SHALL NOT be spawned.

#### Scenario: Runtime needs newer shell

- **WHEN** the pending runtime declares a minimum shell version above the running app version
- **THEN** the app SHALL NOT spawn it
- **AND** SHALL launch the previous runtime or the bundle
- **AND** SHALL report "requires app update" with the required version

#### Scenario: Local folder not built

- **WHEN** source is `local` AND the folder has no built web client
- **THEN** the app SHALL NOT spawn it AND SHALL report which artefact is missing and the command that produces it

### Requirement: Health-gated commit and automatic rollback

Activation of a pending runtime SHALL be performed by the Electron app, either on app launch or on an explicit activation request from the dashboard, and SHALL NOT depend on the running server replacing itself. A pending or local runtime SHALL become current only after the server spawned from it passes the health check within the launch deadline. On failure, the app SHALL mark that runtime bad, launch the previous runtime or the bundle, and expose the failure reason. The bundled runtime SHALL remain launchable in every case.

#### Scenario: Activation requested from the UI

- **WHEN** runtime X is pending AND the user requests activation
- **THEN** the Electron app SHALL stop the running server, launch X, and apply the health gate
- **AND** SHALL NOT attach to the previously running server

#### Scenario: Old server slow to exit

- **WHEN** activation is requested AND the previous server has not exited when the new launch would begin
- **THEN** the health gate SHALL accept only the server process spawned for the candidate runtime
- **AND** SHALL NOT commit the candidate because the previous server answered

#### Scenario: Committed runtime not re-activated

- **WHEN** X was committed AND the app is relaunched
- **THEN** X SHALL run as current without counting as a new activation attempt

#### Scenario: Healthy activation

- **WHEN** the server from pending runtime X passes the health check
- **THEN** X SHALL become current AND the prior current SHALL become previous
- **AND** runtimes other than current and previous SHALL be removed

#### Scenario: Crash detection preserved

- **WHEN** a committed runtime's server exits unexpectedly, including after an aborted or rolled-back switch
- **THEN** the app's existing crash handling SHALL apply

#### Scenario: Unhealthy activation

- **WHEN** the server from pending runtime X fails the health check
- **THEN** X SHALL be marked bad AND SHALL NOT be retried automatically
- **AND** the app SHALL launch previous, or the bundle if there is none
- **AND** the failure reason SHALL be available to the UI

#### Scenario: Crash before commit

- **WHEN** the app exits after marking X pending but before committing it
- **THEN** the next launch SHALL retry X at most once before marking it bad

#### Scenario: Manual rollback

- **WHEN** the user requests rollback
- **THEN** the next launch SHALL use the previous runtime, or the bundle if there is none

### Requirement: Bridge extension follows the active runtime

After a runtime is committed or rolled back, the pi settings SHALL reference exactly one dashboard bridge extension, the one belonging to the active runtime, and connected pi sessions SHALL be reloaded automatically.

#### Scenario: Update committed

- **WHEN** runtime X becomes current
- **THEN** the pi settings SHALL reference X's bridge extension and no other dashboard bridge extension
- **AND** connected pi sessions SHALL be reloaded

#### Scenario: Late-reconnecting session

- **WHEN** a pi session reconnects after the new runtime became active AND it is still running the previous runtime's bridge extension
- **THEN** that session SHALL be reloaded once

#### Scenario: Reload does not loop

- **WHEN** a session still reports a non-matching extension after its reload for the active runtime
- **THEN** it SHALL NOT be reloaded again for that runtime AND the mismatch SHALL be reported as a diagnostic

#### Scenario: Rollback to bundle

- **WHEN** the active runtime falls back to the bundle
- **THEN** the pi settings SHALL reference the bundled bridge extension

### Requirement: Local folder link mode

With source `local`, the app SHALL run the server, web client, bridge extension and first-party plugins directly from the configured checkout without copying. The runtime identity SHALL be the folder's real path. The git commit and a dirty flag SHALL be reported alongside it for display and diagnostics. No update check SHALL be performed for a local source.

#### Scenario: Link a checkout

- **WHEN** source is `local` with a valid checkout path
- **THEN** the server SHALL run from that checkout AND the UI SHALL show the path and commit

#### Scenario: Local checkout fails to start

- **WHEN** the linked checkout passes preflight but its server fails the health check
- **THEN** the app SHALL fall back to the previous runtime or the bundle AND SHALL report the failure

#### Scenario: Fixed checkout retried after re-selection

- **WHEN** a linked checkout was marked failed AND the user selects the same folder again from the app menu
- **THEN** the app SHALL attempt to activate it again

#### Scenario: Environmental failure does not mark a runtime bad

- **WHEN** a candidate cannot start because the previous server still holds its process or port
- **THEN** the switch SHALL be aborted, the previous runtime SHALL remain current, and the candidate SHALL NOT be marked failed

#### Scenario: Stale state cannot enable local

- **WHEN** the dashboard-side runtime selection is missing, reset or written by an older runtime version
- **THEN** the local source SHALL be treated as off

#### Scenario: Edit and restart

- **WHEN** the user changes code in the checkout and restarts the server
- **THEN** the restarted server SHALL run the changed code without any staging step

### Requirement: Local source set only from the Electron app

The local-folder source and its path SHALL be settable only through the Electron app's own native UI (app menu with a native folder picker). No dashboard HTTP or WebSocket endpoint SHALL accept a local source or path, whatever the network origin. The stored path SHALL be absolute, resolved to its real path, and SHALL contain the dashboard server entry.

#### Scenario: HTTP attempt to set a local path

- **WHEN** any client, including one on loopback, sends a request that sets source `local` or a local path
- **THEN** the server SHALL reject it AND SHALL NOT change the local source

#### Scenario: Set from app menu

- **WHEN** the user picks a checkout folder through the Electron app menu AND it contains the server entry
- **THEN** the local source SHALL be stored AND the next activation SHALL link that folder

#### Scenario: Invalid folder picked

- **WHEN** the picked folder does not contain the dashboard server entry
- **THEN** the app SHALL refuse it AND SHALL keep the previous source

#### Scenario: Remote client views status

- **WHEN** a remote client reads runtime status
- **THEN** it SHALL see the active source, path and version read-only

### Requirement: Runtime mutation endpoints are Electron-only

Endpoints that change the runtime source, stage, activate or roll back a runtime SHALL be available only when the server was started by the Electron app. For other starters they SHALL respond 403 and SHALL NOT write runtime state.

#### Scenario: Standalone server

- **WHEN** a Standalone or Bridge-started server receives a runtime update or activation request
- **THEN** it SHALL respond 403 AND no runtime state SHALL change
