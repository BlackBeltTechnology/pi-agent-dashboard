## ADDED Requirements

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

- **GIVEN** `commands_list` is sent on session register, on spawn, on flow rediscovery, on `session_start` reload, and in response to `request_commands`
- **WHEN** any of those senders emits the message
- **THEN** its skill entries SHALL carry `path`

#### Scenario: No new message is introduced

- **WHEN** the bridge reports loaded skills
- **THEN** it SHALL do so via the existing `commands_list` message

#### Scenario: The server notices a path-less skill list

- **GIVEN** a retained `commands_list` whose skill entries all lack `path`
- **WHEN** the server attempts the join
- **THEN** it SHALL report the condition rather than silently labelling every resolved skill not-loaded

### Requirement: The server SHALL retain the latest commands_list per session

The server SHALL store the most recent `commands_list` for each session so the resources payload can consult it. Presence of a retained list is the signal that a session has reported; absence means no report.

#### Scenario: Retained on receipt

- **WHEN** the server receives `commands_list` for a session
- **THEN** it SHALL retain those commands for that session

#### Scenario: Replaced on re-report

- **WHEN** a session sends `commands_list` again after a resource reload
- **AND** the new list contains at least one skill entry
- **THEN** the retained list SHALL be replaced

#### Scenario: A transient empty list does not displace a populated one

- **GIVEN** a session with a retained list containing skills
- **WHEN** that session sends a `commands_list` containing no skill entries during a reload
- **THEN** the retained skill set SHALL NOT be emptied by that message alone
- **AND** no resolved skill SHALL flip to `not-loaded` as a result

#### Scenario: Reporting session with no skills

- **GIVEN** a session whose retained `commands_list` contains no `source: "skill"` entries
- **WHEN** the resources payload is built
- **THEN** the session SHALL be treated as having reported an empty skill set

#### Scenario: No retained list means scan-only

- **GIVEN** a workspace with no session that has sent `commands_list`
- **WHEN** the resources payload is built
- **THEN** the payload SHALL be scan-only
- **AND** no skill SHALL be labelled as not loaded

### Requirement: The server SHALL join live skills against resolved skills on canonicalized path

The server SHALL filter the retained commands to `source === "skill"` and join them against resolved skills using canonicalized real paths, assigning a status per entry.

| Resolved | Live | Status |
|---|---|---|
| yes | yes | `active` |
| yes | no | `not-loaded` |
| no | yes | `loaded-elsewhere` |

#### Scenario: Skill both resolved and live

- **GIVEN** a skill present in the resolved set and in the retained commands at the same real path
- **WHEN** the server joins
- **THEN** the entry SHALL have status `active`

#### Scenario: Paths differing as strings but sharing a realpath match

- **GIVEN** a resolved path and a live path that differ textually but resolve to the same real file
- **WHEN** the server joins
- **THEN** the entry SHALL have status `active`
- **AND** SHALL NOT be labelled `not-loaded`

#### Scenario: Resolved but not live

- **GIVEN** a resolved skill absent from the retained commands
- **WHEN** the server joins
- **THEN** the entry SHALL have status `not-loaded`

#### Scenario: Live but not resolved

- **GIVEN** a live skill whose real path is not in the resolved set
- **WHEN** the server joins
- **THEN** the entry SHALL have status `loaded-elsewhere`
- **AND** it SHALL appear in the payload with the path the session reported

#### Scenario: Runtime-registered skills surface

- **GIVEN** a session that loaded skills from `~/.pi/agent/pi-hermes-memory/skills/` and `~/.pi/agent/projects-memory/<project>/skills/`
- **AND** the resolver returns none of them
- **WHEN** the server joins
- **THEN** each SHALL appear with status `loaded-elsewhere`

#### Scenario: Distinct resolved skills sharing a name remain distinct entries

- **GIVEN** two resolved skills named `release-revoke` at different real paths
- **WHEN** the server joins on canonicalized path
- **THEN** each SHALL remain a distinct entry in the payload
- **AND** the payload SHALL NOT merge them by name

#### Scenario: A name-collision loser is not distinguishable from a miss

- **GIVEN** two skills sharing a name where pi loaded only one
- **WHEN** the server joins
- **THEN** the unloaded one SHALL be reported `not-loaded`
- **AND** no requirement SHALL claim the join can identify it as a collision

### Requirement: Disabled skills SHALL NOT be labelled not-loaded

A resolved skill with `enabled: false` SHALL be reported as disabled. Its absence from the live set is expected and SHALL NOT produce a `not-loaded` status.

#### Scenario: Disabled skill keeps its state

- **GIVEN** a resolved skill with `enabled: false` absent from the retained commands
- **WHEN** the server joins
- **THEN** it SHALL be reported as disabled and not as `not-loaded`

### Requirement: The payload SHALL carry the session context behind the join

Where exactly one session for the folder has reported, the payload SHALL identify that session and its working directory, so a `not-loaded` status can be attributed to scope rather than to rejection.

Where more than one session for the folder has reported, the payload SHALL be scan-only. Selecting among several reporting sessions is an unresolved design question, and last-writer-wins SHALL NOT be adopted by default.

#### Scenario: Session working directory accompanies the join

- **GIVEN** exactly one session for the folder has reported
- **WHEN** the resources payload includes a live-derived status
- **THEN** it SHALL identify that session and its working directory

#### Scenario: Several reporting sessions degrade to scan-only

- **GIVEN** two or more sessions attached to the same folder have reported
- **WHEN** the resources payload is built
- **THEN** it SHALL be scan-only
- **AND** no skill SHALL be labelled `not-loaded`

#### Scenario: Session cwd differs from the scanned folder

- **GIVEN** an attached session whose working directory is a worktree or subdirectory of the scanned folder
- **WHEN** the payload is built
- **THEN** the differing working directory SHALL be exposed alongside the statuses
