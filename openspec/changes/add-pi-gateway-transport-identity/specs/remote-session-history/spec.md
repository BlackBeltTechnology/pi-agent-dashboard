## ADDED Requirements

### Requirement: A remote-joined session's transcript is reachable by the dashboard it joined
A dashboard SHALL be able to serve the transcript of a session whose pi process
runs on another host, to the same extent it serves a local session. This includes
entries recorded before the bridge attached. The mechanism is not mandated; any
mechanism SHALL satisfy the constraints in this capability.

#### Scenario: History predating the connection is available
- **WHEN** a bridge on another host joins a dashboard part-way through a session
- **THEN** the dashboard SHALL be able to present transcript entries recorded before the bridge attached

#### Scenario: Full-fidelity payloads are available
- **WHEN** a tool payload for a remote session exceeds the in-memory event store's truncation limits
- **THEN** the dashboard SHALL still be able to serve the untruncated payload
- **AND** it SHALL NOT present the truncated in-memory copy as if it were complete

#### Scenario: Transcript data outlives the session
- **WHEN** a remote session ends and its bridge disconnects
- **THEN** the dashboard SHALL still be able to serve that session's transcript

### Requirement: No filesystem path crosses the bridge
A dashboard SHALL request session data by session identifier. The bridge SHALL
resolve the corresponding file itself. A path supplied by the server SHALL NOT be
used to read from the pi host's filesystem.

#### Scenario: Server addresses data by session id
- **WHEN** a dashboard requests session data from a bridge
- **THEN** the request SHALL identify the session by id
- **AND** it SHALL NOT carry a filesystem path

#### Scenario: A path-bearing request is refused
- **WHEN** a bridge receives a request to read a path supplied by the server
- **THEN** the bridge SHALL refuse it
- **AND** it SHALL NOT read the named file

#### Scenario: A request for another session's data is refused
- **WHEN** a bridge receives a request for a session id that is not its own
- **THEN** the bridge SHALL refuse it

### Requirement: Registration is never blocked on transcript transfer
Becoming usable SHALL NOT depend on completing a transcript transfer. A session
SHALL accept prompts as soon as it has registered, irrespective of how much
history remains to be transferred.

#### Scenario: A large transcript does not delay usability
- **WHEN** a bridge with a multi-megabyte transcript registers with a dashboard
- **THEN** the session SHALL become usable without waiting for the transcript transfer to complete

#### Scenario: History arriving later is reflected
- **WHEN** transcript data arrives after the session is already usable
- **THEN** the dashboard SHALL make it available without requiring a reconnect

### Requirement: A session records the host it originates from
A session SHALL carry the identity of the device its bridge ran on, so that
sessions from different hosts remain distinguishable when their working
directories coincide. That identity SHALL be derived from the credential the
bridge authenticated with, and SHALL NOT be taken from any value the bridge
reports about itself. A connection that cannot be attributed SHALL be treated as
remote rather than local.

#### Scenario: Identical paths on two hosts do not collide
- **WHEN** two hosts each have a session whose working directory path is identical
- **THEN** the dashboard SHALL keep them distinct
- **AND** each SHALL be attributable to its originating device

#### Scenario: A bridge cannot declare itself local
- **WHEN** a remote bridge reports that its session is local, or names a device it did not authenticate as
- **THEN** the reported value SHALL be ignored
- **AND** the session's origin SHALL be the one derived from its credential

#### Scenario: An unattributable remote connection is not treated as local
- **WHEN** a session is registered by a remote connection whose device cannot be resolved
- **THEN** the session SHALL be treated as remote
- **AND** operations restricted to local sessions SHALL be refused for it

#### Scenario: Origin is presentable
- **WHEN** a session originated on another host
- **THEN** its origin SHALL be available for display

### Requirement: Remote sessions are read-only once their bridge has ended
A dashboard SHALL NOT offer to resume or respawn a session whose pi process ran
on another host and has exited. The refusal SHALL state why.

#### Scenario: Resume is refused for an ended remote session
- **WHEN** a user attempts to resume a remote session whose bridge has ended
- **THEN** the dashboard SHALL refuse
- **AND** the response SHALL explain that the session's host cannot be reached

#### Scenario: The control does not appear actionable
- **WHEN** an ended remote session is displayed
- **THEN** resume SHALL NOT be presented as an available action

#### Scenario: Local sessions are unaffected
- **WHEN** a session ran on the same host as the dashboard
- **THEN** resume SHALL remain available as it is today
