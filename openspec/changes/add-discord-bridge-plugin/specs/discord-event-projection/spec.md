## Purpose

Renders live session activity into a bound Discord thread at an operator-chosen level of detail, defaulting to the least revealing option because mirrored content leaves the host permanently and is readable by every member of the channel.

## ADDED Requirements

### Requirement: Default mirror level is minimal
The default mirror level for a newly bound thread SHALL be assistant text plus tool names only. Tool arguments, tool results, file contents, diffs, and terminal output SHALL NOT be mirrored at that level.

#### Scenario: Agent edits a file under the default level
- **WHEN** a session performs a file edit and the thread is at the default mirror level
- **THEN** the thread shows that an edit tool ran and its target's basename at most
- **AND** the thread does not show the file's contents or the diff

#### Scenario: Agent runs a command under the default level
- **WHEN** a session runs a shell command at the default mirror level
- **THEN** the thread does not show the command's output

### Requirement: Operator-tunable mirror level
The mirror level SHALL be configurable per binding from the dashboard settings surface, across at least: names-only, names plus diffs, and full transcript. Raising the level SHALL affect subsequent events only.

#### Scenario: Operator raises the level mid-session
- **WHEN** an operator switches a thread from names-only to full transcript
- **THEN** subsequent events render in full
- **AND** already-posted messages are not rewritten to reveal previously filtered content

### Requirement: Explicitly pulled content is tier-gated
Content a principal explicitly requests — a diff, a file, a command's output — SHALL be gated by that principal's tier, not by the mirror level. The mirror level SHALL govern only the passive stream.

#### Scenario: Observer requests a diff under a names-only filter
- **WHEN** a principal explicitly requests content their tier permits
- **THEN** the content is delivered even though the passive mirror level would have omitted it

#### Scenario: Untiered user requests content
- **WHEN** a user who resolves to no tier explicitly requests content
- **THEN** the request is refused

### Requirement: Projection never silently truncates meaning
Where a Discord message-length limit or a rate limit prevents delivering an event in full, the plugin SHALL indicate that content was elided rather than presenting a partial rendering as complete.

#### Scenario: Assistant message exceeds the platform limit
- **WHEN** an assistant message is longer than a single Discord message permits
- **THEN** the thread shows the content split or truncated with an explicit elision marker

### Requirement: Bounded posting rate
The plugin SHALL coalesce and pace outbound messages so that a rapidly streaming session does not exceed the platform's rate limits or render the thread unreadable.

#### Scenario: Rapid token streaming
- **WHEN** a session streams output faster than the posting budget allows
- **THEN** events are coalesced into fewer messages
- **AND** no events are dropped without an elision marker

### Requirement: Mirroring is independent of authorization to act
Mirroring into a thread SHALL continue while the plugin is disarmed, and SHALL be unaffected by any individual principal's tier.

#### Scenario: Disarmed plugin
- **WHEN** the plugin is disarmed
- **THEN** session activity continues to appear in bound threads
