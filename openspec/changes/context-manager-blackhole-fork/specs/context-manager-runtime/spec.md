## ADDED Requirements

### Requirement: The chassis owns the compaction and context hooks
In addition to the hooks the kernel owns, the context manager SHALL subscribe once to each of `turn_end`, `agent_before_settle`, `context`, `session_before_compact`, `agent_start`, `agent_end`, `agent_settled`, `session_compact` and `session_compact_failed`, and SHALL dispatch them to registered consumers only while the session is `active`, under the existing ordering, replace-by-owner, exactly-once and fault-isolation rules.

- `turn_end` / `agent_before_settle`: each consumer SHALL receive the event with `entries` as returned by the consumers before it; returned `entries` SHALL replace them; `continue` SHALL be the last value a consumer defined (an `undefined` is ignored), as pi merges its own handlers. A consumer that throws SHALL leave `entries` and `continue` unchanged.
- Every consumer of a boundary hook SHALL receive the `context` pi built for the chassis' handler; the chassis SHALL NOT claim to rebuild it between consumers.
- `context`: each consumer SHALL receive the messages as returned before it; returned `messages` SHALL replace them.
- `session_before_compact`: the first consumer returning a non-undefined result SHALL decide it, and later consumers SHALL NOT be called. A consumer that throws SHALL be skipped and the next one called.
- `agent_start`, `agent_end`, `agent_settled`, `session_compact`, `session_compact_failed`: every consumer SHALL be called and results SHALL be ignored.

#### Scenario: Boundary entries chain
- **WHEN** two `turn_end` consumers each append one custom entry draft
- **THEN** the returned `entries` hold the event's entries followed by both drafts in consumer order

#### Scenario: Throwing boundary consumer
- **WHEN** the first of two `agent_before_settle` consumers throws and the second appends a compaction draft
- **THEN** the returned `entries` hold the event's entries followed by the compaction draft

#### Scenario: Later continue wins
- **WHEN** one `turn_end` consumer returns `continue: true` and a later one returns `continue: false`
- **THEN** the chassis returns `continue: false`

#### Scenario: Throwing compaction consumer falls through
- **WHEN** the first `session_before_compact` consumer throws and the second returns a compaction
- **THEN** the second consumer's compaction is returned

#### Scenario: First compaction decision wins
- **WHEN** two `session_before_compact` consumers would both return a compaction
- **THEN** only the first is called and its result is returned

#### Scenario: Not active
- **WHEN** the session is `refused`
- **THEN** none of these hooks dispatches to a consumer and each returns no result

### Requirement: Consumers can contribute tools and /context subcommands
A consumer SHALL be able to register a tool with the context manager, which SHALL then apply the kernel's tool lifecycle to it: registered at `session_start` only when the session is `active`, re-added to the active tools on resume, and removed on `active`→`refused`. A consumer SHALL be able to register a `/context <name>` subcommand; the context manager SHALL dispatch `/context <name> [args]` to it in `active` sessions and, in any other state, SHALL print the state and not call it. A subcommand name SHALL be registered once; a second registration of the same name by another owner SHALL be refused with a `[context-manager]` warning.

#### Scenario: Consumer tool follows the lifecycle
- **WHEN** a consumer registers a tool and the session moves from `active` to `refused`
- **THEN** the tool is no longer among the active tools

#### Scenario: Subcommand in a refused session
- **WHEN** the user runs `/context memory` in a `refused` session
- **THEN** the output names the state and the subcommand handler is not called

#### Scenario: Duplicate subcommand
- **WHEN** two owners register the subcommand `export`
- **THEN** the second registration is refused and one `[context-manager]` warning names both owners
