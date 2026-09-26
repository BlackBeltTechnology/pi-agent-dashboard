## MODIFIED Requirements

### Requirement: Doctrine is appended to the system prompt per turn
When the kb extension is loaded for a cwd and the resolved `doctrine.inject` is `kb`, the canonical READ doctrine SHALL be delivered in the system prompt on every agent turn, delimited by a recognisable `── dox doctrine ──` marker line. When the context manager is not active for the session, the kb extension SHALL append it to the system prompt. When the context manager is active, the kb extension SHALL NOT touch the system prompt; the doctrine SHALL instead be delivered inside the context manager's pinned block (the `context` prompt section, or the block the context manager inserts into a prompt forced by an earlier handler), byte-identical across turns with unchanged inputs. When `doctrine.inject` is `off`, nothing SHALL be delivered. The delivered text SHALL be the same canonical doctrine text previously seeded by `project-init`; this change SHALL NOT reduce the doctrine content.

#### Scenario: READ doctrine injected
- **WHEN** the extension is active in a cwd whose resolved `doctrine.inject` is `kb`
- **THEN** the system prompt for that turn contains the READ doctrine under the `── dox doctrine ──` marker

#### Scenario: Delivered in the pinned section under the context manager
- **WHEN** the context manager is active and `doctrine.inject` is `kb`
- **THEN** the system prompt contains exactly one `── dox doctrine ──` fragment, inside the context manager's pinned block

#### Scenario: Injection disabled
- **WHEN** the resolved `doctrine.inject` is `off`
- **THEN** the system prompt contains no `── dox doctrine ──` fragment
- **AND** `doctrine.write` has no effect

#### Scenario: Coexists with other prompt injectors
- **WHEN** another extension also modifies the system prompt in the same turn (e.g. the dashboard bridge context injector, which appends its fragment to a forced system prompt)
- **THEN** both fragments are present, regardless of handler order

#### Scenario: Config resolved per turn from the session cwd
- **WHEN** the project config file is written during a session
- **THEN** the next turn's injection reflects the new `doctrine` value without restarting the session

#### Scenario: Malformed project config
- **WHEN** `.pi/dashboard/knowledge_base.json` in the session cwd is invalid JSON or fails validation
- **THEN** the built-in defaults apply for that turn (READ injected, WRITE not)
- **AND** no first-contact instruction is injected
- **AND** a `[kb]`-prefixed warning is emitted to the console once per session

#### Scenario: Doctrine file unreadable
- **WHEN** the bundled canonical doctrine file cannot be read
- **THEN** no doctrine and no doctrine nudge is delivered
- **AND** a `[kb]`-prefixed warning is emitted once per session

#### Scenario: Handler latency budget
- **WHEN** the delivering path runs 100 turns against a warm project config (kb extension's handler, or, with the context manager active, kb extension's pinned provider plus the context manager's `before_agent_start` handler)
- **THEN** p95 wall time of that path (config reads + fragment build + insertion) is below 20 ms

#### Scenario: Extension reload does not stack handlers
- **WHEN** the extension is reloaded mid-session
- **THEN** the next turn's system prompt contains exactly one `── dox doctrine ──` fragment

### Requirement: First-contact prompt when doctrine is unset
When neither the project nor the global config supplies a `doctrine` key, the extension SHALL deliver a one-time first-contact instruction that tells the agent to ask the user (via the interactive question tool) which mode to enable — `kb read`, `kb read + write`, `off`, or `ask later` — and, unless `ask later` is chosen, to record the choice in the PROJECT `.pi/dashboard/knowledge_base.json` by read-merge-write, preserving every other key in that file. The instruction SHALL be appended to the system prompt, or, while the context manager is active, delivered as an item of the context manager's per-turn message so the pinned section stays byte-stable. The instruction SHALL state that in a non-interactive run the agent proceeds with defaults and writes nothing. The nudge SHALL fire at most once per session. Until a choice is recorded, defaults apply (READ injected, WRITE not). A project file that exists but lacks a `doctrine` key SHALL count as unset; a `doctrine` key holding an empty object SHALL count as a recorded choice.

#### Scenario: Unset doctrine triggers the nudge once
- **WHEN** a session starts in a cwd with no `doctrine` key in any config layer
- **THEN** the first turn carries the first-contact instruction, in the system prompt or, with the context manager active, in its per-turn message
- **AND** subsequent turns of the same session do not repeat it

#### Scenario: Pinned section unaffected by the nudge
- **WHEN** the context manager is active and the first-contact nudge fires on turn 1
- **THEN** the pinned section text on turn 1 and turn 2 is byte-identical

#### Scenario: Recorded choice suppresses the nudge
- **WHEN** the project config contains a `doctrine` key
- **THEN** no first-contact instruction is injected

#### Scenario: Ask later
- **WHEN** the user answers `ask later`
- **THEN** no config file is written
- **AND** the nudge fires again in the next session

#### Scenario: Existing project config without doctrine key
- **WHEN** the project config exists with other keys (e.g. `readDiscipline`) but no `doctrine`
- **THEN** the first-contact instruction is injected
- **AND** recording a choice leaves the other keys intact

### Requirement: Legacy seeded doctrine is not double-loaded and is offered a migration
When a loaded context file (e.g. a root `AGENTS.md`) already contains a seeded doctrine section — identified by a `dox:write`, `dox:read:kb` or `dox:read:manual` section delimiter, with or without the `<!-- dox-doctrine -->` marker — the extension SHALL skip injection for that cwd and SHALL, instead of the first-contact instruction and unless the resolved `doctrine.inject` is `off`, deliver a once-per-session migration instruction: tell the user the project carries a legacy doctrine copy and, on confirmation, replace the block from the marker through its last section delimiter with the pointer block, then proceed with the first-contact question. The migration instruction SHALL be appended to the system prompt, or, while the context manager is active, delivered as an item of its per-turn message, with the pinned doctrine suppressed. Declining SHALL leave the file untouched. A pointer-only block carrying the marker but no section delimiter SHALL NOT suppress injection.

#### Scenario: Legacy full seed present
- **WHEN** the root `AGENTS.md` carries a `dox:write`, `dox:read:kb` or `dox:read:manual` section delimiter
- **THEN** no doctrine fragment is injected
- **AND** the migration instruction is delivered once for the session
- **AND** the first-contact instruction is not delivered

#### Scenario: Legacy seed under the context manager
- **WHEN** the context manager is active and the root `AGENTS.md` carries a legacy seed delimiter
- **THEN** the pinned section contains no `── dox doctrine ──` fragment
- **AND** the migration instruction arrives once in the per-turn message

#### Scenario: Migration accepted
- **WHEN** the user confirms the migration
- **THEN** the legacy block is replaced by the pointer block
- **AND** the next session injects the doctrine per the recorded config

#### Scenario: Pointer block present
- **WHEN** the root `AGENTS.md` carries only the marker and the pointer block
- **THEN** the doctrine fragment is injected per the resolved config
