## ADDED Requirements

### Requirement: The global home directory is never also a folder scope

While global-scope scanning is enabled, the automation plugin SHALL NOT produce a folder scope whose base, resolved with `path.resolve`, equals the global home directory, whether the base comes from a live session cwd or from a folder-scope contribution. Every consumer of the scope list (scan and arm, stale-run reaper, definition watchers, role-usage reporting) SHALL therefore see the home directory's `.pi/automation` exactly once, under the `global` scope. While global-scope scanning is disabled, a live session whose cwd is the home directory SHALL still yield a folder scope for it. A contributed base equal to the home directory SHALL remain dropped regardless of global-scope scanning (unchanged behaviour). While global-scope scanning is enabled, the automation list route SHALL NOT list the home directory's automations as folder-scope entries when its `cwd` resolves to the home directory. Bases that are not equal to the home directory, including its subdirectories, SHALL be unaffected.

#### Scenario: Session in the home directory does not double-arm a global automation

- **WHEN** global-scope scanning is enabled, `~/.pi/automation/nightly/automation.yaml` declares `on.kind: schedule`, and a live session has the home directory as its cwd
- **THEN** the scheduler SHALL arm `nightly` once, under the `global` scope, and SHALL NOT arm it under the `folder` scope
- **AND** one cron occurrence SHALL start exactly one run

#### Scenario: Equivalent spelling of the home directory is recognized

- **WHEN** global-scope scanning is enabled and a live session's cwd is the home directory written with a trailing slash
- **THEN** no folder scope SHALL be produced for it

#### Scenario: Home-directory session still arms when global scanning is off

- **WHEN** global-scope scanning is disabled and a live session has the home directory as its cwd
- **THEN** a folder scope for the home directory SHALL be produced and its automations SHALL be armed under the `folder` scope

#### Scenario: Subdirectory of the home directory is unaffected

- **WHEN** a live session's cwd is a subdirectory of the home directory that contains `.pi/automation/`
- **THEN** that subdirectory SHALL yield a folder scope as before

#### Scenario: A global run's own session does not create a folder scope

- **WHEN** global-scope scanning is enabled and a global automation's run session (cwd = the home directory) is live
- **THEN** the scope list SHALL contain the home directory exactly once, under the `global` scope

#### Scenario: Board list in the home directory shows each global automation once

- **WHEN** global-scope scanning is enabled and the automation list is requested with `cwd` equal to the home directory
- **THEN** each automation under `~/.pi/automation/` SHALL appear once, with scope `global`, and no entry SHALL have scope `folder`
