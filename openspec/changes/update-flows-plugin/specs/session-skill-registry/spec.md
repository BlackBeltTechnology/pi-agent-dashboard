# Spec Delta

## MODIFIED Requirements

### Requirement: The bridge SHALL populate CommandInfo.path from pi's sourceInfo

`CommandInfo` declares an optional `path`, but the bridge forwards pi's raw command objects, where the path is carried at `sourceInfo.path`. The bridge SHALL map that value onto `path` in `filterHiddenCommands()`, the single function every `commands_list` sender passes through, tolerating its absence.

#### Scenario: Skill command carries its file path

- **GIVEN** `pi.getCommands()` returns an entry with `source: "skill"` and `sourceInfo.path` set to an absolute `SKILL.md` path
- **WHEN** the bridge sends `commands_list`
- **THEN** that entry's `path` SHALL be the absolute `SKILL.md` path

#### Scenario: Missing sourceInfo does not throw

- **GIVEN** a command entry with no `sourceInfo`
- **WHEN** the bridge sends `commands_list`
- **THEN** the entry SHALL be sent with `path` absent
- **AND** the bridge SHALL NOT throw

#### Scenario: Every sender carries the path

- **GIVEN** `commands_list` is sent on session register, on spawn, on `dashboard:commands-changed` (emitted by any plugin bridge, for example the flows plugin on `flow:rediscover` or `flow:complete`), on `session_start` reload, and in response to `request_commands`
- **WHEN** any of those senders emits the message
- **THEN** its skill entries SHALL carry `path`

#### Scenario: No resend on flow rediscovery while the flows plugin is disabled

- **GIVEN** the flows plugin is disabled, so its bridge is not loaded
- **WHEN** pi-flows emits `flow:rediscover`
- **THEN** the bridge SHALL NOT resend `commands_list`

#### Scenario: No new message is introduced

- **WHEN** the bridge reports loaded skills
- **THEN** it SHALL do so via the existing `commands_list` message

#### Scenario: The server notices a path-less skill list

- **GIVEN** a retained `commands_list` whose skill entries all lack `path`
- **WHEN** the server attempts the join
- **THEN** it SHALL report the condition rather than silently labelling every resolved skill not-loaded
