## Purpose

Renders live session activity into a bound Discord thread at an operator-chosen level of detail, defaulting to the least revealing option because mirrored content leaves the host permanently and is readable by every member of the channel.

## ADDED Requirements

### Requirement: Default mirror level is minimal
The default mirror level for a newly bound thread SHALL be assistant text plus tool names only. At that level the layer SHALL NOT mirror structured event payloads — tool arguments, tool results, file contents, diffs, or terminal output.

The filter governs structured payloads only. Assistant prose is mirrored verbatim at every level and MAY itself contain quoted file content or command output; the layer SHALL NOT claim to redact assistant prose, and the settings surface and documentation SHALL state this boundary.

#### Scenario: Agent edits a file under the default level
- **WHEN** a session performs a file edit and the thread is at the default mirror level
- **THEN** the thread shows that an edit tool ran and its target's basename at most
- **AND** the thread does not show the file's contents or the diff

#### Scenario: Agent runs a command under the default level
- **WHEN** a session runs a shell command at the default mirror level
- **THEN** the thread does not show the command's output

#### Scenario: Assistant quotes a diff in its own prose
- **WHEN** the assistant's own message text quotes a diff and the thread is at the default mirror level
- **THEN** that prose is mirrored as written
- **AND** the documented posture states that the filter bounds structured payloads, not assistant prose

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
Where a Discord message-length limit or a rate limit prevents delivering an event in full, the layer SHALL indicate that content was elided rather than presenting a partial rendering as complete.

#### Scenario: Assistant message exceeds the platform limit
- **WHEN** an assistant message is longer than a single Discord message permits
- **THEN** the thread shows the content split or truncated with an explicit elision marker

### Requirement: Bounded posting rate
The layer SHALL coalesce and pace outbound messages so that posting to one channel never exceeds the platform's documented per-channel limit of 5 messages per 5 seconds. The coalescing window SHALL be derived from that limit rather than configured independently, so pacing cannot drift from the platform's actual constraint. At most one post per thread SHALL be in flight at a time.

#### Scenario: Rapid token streaming
- **WHEN** a session emits 100 mirrorable events within one second
- **THEN** the messages posted to that channel over the following 5 seconds number no more than 5
- **AND** no events are dropped without an elision marker

#### Scenario: Sustained streaming stays within budget
- **WHEN** a session streams continuously for 60 seconds
- **THEN** no 5-second window contains more than 5 posts to that channel
- **AND** the platform returns no rate-limit error

#### Scenario: One post in flight per thread
- **WHEN** a new event arrives while a post to that thread is still in flight
- **THEN** it is queued behind that post rather than issued concurrently

### Requirement: Mirroring is independent of authorization to act
Mirroring into a thread SHALL continue while the layer is disarmed, and SHALL be unaffected by any individual principal's tier.

#### Scenario: Disarmed layer
- **WHEN** the layer is disarmed
- **THEN** session activity continues to appear in bound threads
