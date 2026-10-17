## Purpose

Detect, adopt or install OBS Studio, enable its obs-websocket remote control with a stored secret, register it as a managed service, start it unattended after an unclean exit, and diagnose why it is not usable.

## ADDED Requirements

### Requirement: Detection and adoption of an installed OBS
The system SHALL detect an installed OBS Studio on darwin, win32 and linux and report its install path, version, CPU architecture (darwin), whether it is running, and the obs-websocket state (enabled, port, password present). An installed OBS of version 28 or later SHALL be adopted as-is; the system SHALL NOT reinstall, move or modify it during detection. A version below 28 SHALL be reported as unsupported.

#### Scenario: Installed OBS is adopted
- **WHEN** `pi-obs doctor` runs on a darwin host with `/Applications/OBS.app` version 32.2.2
- **THEN** it reports the path, version `32.2.2`, arch and websocket state, and proposes provisioning rather than installation

#### Scenario: OBS outside /Applications on macOS
- **WHEN** OBS is found only in `~/Applications`
- **THEN** doctor reports it as usable with the warning that the virtual camera requires `/Applications`

#### Scenario: Too old
- **WHEN** the detected version is 27.x
- **THEN** doctor reports `unsupported-version` and does not provision

### Requirement: Confirmed install when OBS is absent
When no OBS is detected, the system SHALL offer an install plan naming the exact command and target, and SHALL perform nothing until the user confirms. When an agent drives the install, the skill SHALL obtain that confirmation from the user before passing a non-interactive confirm flag. A portable archive SHALL be rejected if any entry is absolute, contains `..`, or is a symbolic link. The macOS target SHALL be `/Applications` via the Homebrew cask. The Windows target SHALL be winget, or on request a portable copy under `~/.pi/dashboard/plugins/obs-studio/apps/obs/` whose download is verified against the release's published SHA-256 digest. The Linux target SHALL be the per-user Flathub package. A missing package manager SHALL produce a manual-install instruction instead of a fallback download.

#### Scenario: Install refused without confirmation
- **WHEN** `pi-obs install` runs non-interactively without `--yes`
- **THEN** it prints the plan and exits non-zero without running any installer

#### Scenario: Portable download without a published digest
- **WHEN** the selected Windows release asset carries no published SHA-256 digest
- **THEN** the portable install is refused and nothing is extracted

#### Scenario: Unsafe archive entry
- **WHEN** the verified portable archive contains an entry `../../evil.dll`
- **THEN** extraction is refused and nothing is written outside the install directory

#### Scenario: Homebrew absent
- **WHEN** install runs on darwin and `brew` is not on PATH
- **THEN** the system prints the obsproject.com download instruction and installs nothing

### Requirement: obs-websocket enablement with a stored secret
The system SHALL ensure obs-websocket is enabled with authentication and that its password is held only in the managed-services secret slot `store:<serviceId>/password`. An existing password SHALL be imported only after explicit consent. When OBS is not running, the system MAY write the obs-websocket config after backing it up; when OBS is running, it SHALL NOT write the config file and SHALL instead instruct the user to enable the server in the OBS UI. A password shorter than 8 characters SHALL be accepted with a warning and an offer to rotate it to a generated 24-character password. A config write SHALL happen only after OBS's process exit has been observed and its absence re-checked immediately before writing, SHALL be verified by re-reading, and SHALL be rolled back from the backup when storing the secret fails. The password SHALL never be printed, logged, placed on a command line, or returned by any route, and SHALL NOT be injected into the OBS process environment.

#### Scenario: Existing password imported with consent
- **WHEN** obs-websocket is enabled with a password and the user confirms the import
- **THEN** the secret slot reports `configured` and no output or log contains the password

#### Scenario: Config written only while OBS is stopped
- **WHEN** OBS is not running and obs-websocket is disabled
- **THEN** a timestamped backup of the config is created, the config is written with authentication enabled and a generated password, and the same value is stored in the secret slot

#### Scenario: Short existing password
- **WHEN** obs-websocket has a 6-character password and the user consents to import
- **THEN** it is stored, a short-password warning is shown and rotation is offered

#### Scenario: Secret store failure rolls back the config
- **WHEN** the config was written but storing the secret fails
- **THEN** the backup is restored and provisioning reports failure

#### Scenario: OBS running with websocket disabled
- **WHEN** OBS is running and obs-websocket is disabled
- **THEN** the config file is not modified and the user receives the UI instruction

### Requirement: Service registration for local and remote OBS
Provisioning SHALL register at most one local OBS per host as a user-origin `attached` managed service with a websocket-hello health probe, process-name adoption, a start command, no stop command, and idle-stop disabled. Any number of remote OBS instances SHALL be registered as `external` services with endpoint, health probe and password secret only. Registration SHALL go through the managed-services add review (`service add --file`) and require confirmation. Instances SHALL be distinguished by service id and recorded as OBS instances for the panel; an id whose secret environment name collides with an existing service's SHALL be refused, and recorded instances whose definition was removed SHALL be dropped. Provisioning a non-loopback endpoint SHALL warn that obs-websocket traffic is unencrypted.

#### Scenario: Local registration
- **WHEN** the user confirms the add review for a local OBS
- **THEN** a service `obs` exists with mode `attached`, a `ws-first-message` health probe, no `lifecycle.stop` and `idleStopMinutes: null`

#### Scenario: Running OBS is adopted, not restarted
- **WHEN** `ensure obs` runs while the user's OBS is already running
- **THEN** no second OBS process is started and the service reports `healthy` once the hello is received

#### Scenario: Remote OBS
- **WHEN** the user provisions `--remote ws://10.0.0.5:4455 --service obs-studio2`
- **THEN** an `external` service `obs-studio2` is registered and the password is set from stdin

#### Scenario: Non-loopback host warned
- **WHEN** the remote host is a private-network address such as `10.0.0.5`
- **THEN** provisioning warns that obs-websocket traffic is unencrypted before the review

#### Scenario: Second local instance refused
- **WHEN** a local OBS service already exists and the user provisions another local one
- **THEN** provisioning refuses and names the existing service

### Requirement: Unattended start after an unclean exit
The service start command SHALL launch OBS minimized. When no OBS process exists, it SHALL first move leftover unclean-exit sentinel files into a quarantine directory, so the next launch does not block on the safe-mode prompt. Sentinels younger than 60 seconds SHALL be ignored and SHALL leave the strike state unchanged. A leftover SHALL count as a crash strike only when the previous run's OBS log shows no shutdown phase (the run crashed while running, not while quitting) and its last write came less than 10 minutes after that launch; any other leftover SHALL reset the strikes. After two strikes recovery SHALL become suspended: the start command SHALL NOT clear sentinels, letting OBS show its safe-mode prompt, and the suspension SHALL be visible in status. The recovery state SHALL be persisted atomically before OBS is spawned; an unreadable record SHALL be treated as suspended; and a suspension SHALL be cleared only by an explicit user reset. If an OBS process appears after files were quarantined, the start command SHALL launch nothing, and the quarantined files SHALL stay quarantined. Quarantine SHALL retain at most the 10 newest batches.

#### Scenario: Recovery after an unclean exit
- **WHEN** a sentinel file remains from a crashed run and OBS is not running
- **THEN** the start command quarantines it, launches OBS, and the service becomes `healthy` without user interaction

#### Scenario: Crash loop reaches safe mode
- **WHEN** OBS has crashed while running, within 10 minutes of each of the last two launches
- **THEN** the next start does not clear sentinels, status reports `recovery-suspended`, and the service reaches `blocked` while OBS shows its prompt

#### Scenario: Crashes while quitting never suspend recovery
- **WHEN** OBS is stopped via `pi-obs stop` or quit from its own UI three times in a row, each crashing during shutdown and leaving a sentinel
- **THEN** every start clears the leftover and no suspension is recorded

#### Scenario: Suspension survives a clean launch
- **WHEN** recovery is suspended and the next start finds no leftover sentinel
- **THEN** recovery stays suspended until the user resets it

#### Scenario: Young sentinel ignored
- **WHEN** a sentinel younger than 60 seconds exists at start
- **THEN** it is not quarantined and the strike count is unchanged

#### Scenario: Early crashes detected however late the relaunch
- **WHEN** OBS crashed within 1 minute of each of its last two launches and each relaunch happened 30 minutes after the crash
- **THEN** the next start reports `recovery-suspended` and does not clear sentinels

#### Scenario: Corrupt strike record fails safe
- **WHEN** the strike record cannot be parsed
- **THEN** the start does not clear sentinels, status reports `recovery-suspended`, and doctor offers the reset

#### Scenario: OBS started during recovery
- **WHEN** an OBS process appears after sentinel files were moved and before launch
- **THEN** no second OBS is launched and the quarantined files stay quarantined

#### Scenario: Never touches a running OBS
- **WHEN** the start command runs while an OBS process exists
- **THEN** it moves no files and launches nothing

### Requirement: Stop is explicit and warned
The system SHALL NOT stop OBS automatically, and the managed service SHALL declare no stop command. An explicit stop SHALL be refused for any service other than the local OBS. An explicit stop of the local OBS SHALL warn that OBS may exit uncleanly and that the next launch recovers, require confirmation, target only the matched OBS process, judge success by that process's exit within a timeout (never by the stop command's exit code), and refresh the managed-service state.

#### Scenario: Stop confirmed by exit
- **WHEN** the user confirms `pi-obs stop` and the quit command returns a non-zero code while OBS exits
- **THEN** the stop is reported as succeeded

#### Scenario: Stop refused for a remote instance
- **WHEN** the user runs `pi-obs stop --service obs-studio2` for an `external` service
- **THEN** the stop is refused and nothing is signalled

#### Scenario: Stop not confirmed
- **WHEN** OBS is still running after the stop timeout
- **THEN** the stop is reported as failed and no force-kill is attempted without a further explicit request

### Requirement: Diagnostics from the OBS log
`pi-obs doctor` SHALL run without the OBS password and without a healthy service, and SHALL report diagnostics derived from the newest OBS log: OS permission grants or denials, invalid display bindings with the affected inputs, unclean-shutdown and safe-mode lines, and load status of obs-websocket and known plugins. It SHALL report websocket exposure on all interfaces, a start command whose interpreter or entry path no longer exists, and recovery suspension. A black capture frame alone SHALL NOT be reported as a permission problem.

#### Scenario: Stale display binding
- **WHEN** the newest log contains `Invalid target display ID` and permissions are granted
- **THEN** doctor reports `stale-display-binding` naming the screen-capture inputs to rebind, and no permission problem

#### Scenario: Permission denied
- **WHEN** the newest log reports screen capture permission denied
- **THEN** doctor reports the macOS setting to grant and that OBS must be restarted afterwards

#### Scenario: Doctor while blocked
- **WHEN** the service is `blocked` on the safe-mode prompt
- **THEN** `pi-obs doctor` runs and reports the unclean-shutdown line

#### Scenario: Stale start path
- **WHEN** the definition's start command names a node binary that no longer exists
- **THEN** doctor reports it and recommends re-provisioning

#### Scenario: Exposure warning
- **WHEN** obs-websocket listens on all interfaces
- **THEN** doctor reports `exposure: all-interfaces` with a firewall recommendation
