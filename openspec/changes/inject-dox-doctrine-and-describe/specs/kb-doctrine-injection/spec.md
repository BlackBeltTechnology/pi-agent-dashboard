## Purpose

The kb extension delivers the DOX doctrine (kb-first READ discipline, directory `AGENTS.md` WRITE discipline) to the agent per turn, governed by a layered `doctrine` setting, so projects no longer carry a drifting copy in their root `AGENTS.md`.

## ADDED Requirements

### Requirement: Doctrine is appended to the system prompt per turn
When the kb extension is loaded for a cwd and the resolved `doctrine.inject` is `kb`, the extension SHALL append the canonical READ doctrine to the system prompt on every agent turn, delimited by a recognisable `── dox doctrine ──` marker line. When `doctrine.inject` is `off`, nothing SHALL be appended. The appended text SHALL be the same canonical doctrine text previously seeded by `project-init`; this change SHALL NOT reduce the doctrine content.

#### Scenario: READ doctrine injected
- **WHEN** the extension is active in a cwd whose resolved `doctrine.inject` is `kb`
- **THEN** the system prompt for that turn contains the READ doctrine under the `── dox doctrine ──` marker

#### Scenario: Injection disabled
- **WHEN** the resolved `doctrine.inject` is `off`
- **THEN** the system prompt contains no `── dox doctrine ──` fragment
- **AND** `doctrine.write` has no effect

#### Scenario: Coexists with other prompt injectors
- **WHEN** another extension also modifies the system prompt in the same turn (e.g. the dashboard bridge context injector, which replaces everything after the last `Current working directory:` line)
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
- **THEN** the system prompt is left unchanged
- **AND** a `[kb]`-prefixed warning is emitted once per session

#### Scenario: Handler latency budget
- **WHEN** the handler runs 100 turns against a warm project config
- **THEN** p95 wall time of the handler (config reads + fragment build + insertion) is below 20 ms

#### Scenario: Extension reload does not stack handlers
- **WHEN** the extension is reloaded mid-session
- **THEN** the next turn's system prompt contains exactly one `── dox doctrine ──` fragment

### Requirement: WRITE doctrine is opt-in
The WRITE doctrine (maintain the directory `AGENTS.md` tree) SHALL be appended only when the resolved `doctrine.write` is `true`. The built-in default SHALL be `false`. A project file MAY enable it while the global file leaves it disabled.

#### Scenario: Default omits WRITE
- **WHEN** no layer sets `doctrine.write`
- **THEN** only the READ doctrine is injected

#### Scenario: Project enables WRITE over a global off
- **WHEN** the global file has `doctrine.write: false` and the project file has `doctrine.write: true`
- **THEN** both READ and WRITE doctrine are injected for that project

### Requirement: First-contact prompt when doctrine is unset
When neither the project nor the global config supplies a `doctrine` key, the extension SHALL append a one-time first-contact instruction that tells the agent to ask the user (via the interactive question tool) which mode to enable — `kb read`, `kb read + write`, `off`, or `ask later` — and, unless `ask later` is chosen, to record the choice in the PROJECT `.pi/dashboard/knowledge_base.json` by read-merge-write, preserving every other key in that file. The instruction SHALL state that in a non-interactive run the agent proceeds with defaults and writes nothing. The nudge SHALL fire at most once per session. Until a choice is recorded, defaults apply (READ injected, WRITE not). A project file that exists but lacks a `doctrine` key SHALL count as unset; a `doctrine` key holding an empty object SHALL count as a recorded choice.

#### Scenario: Unset doctrine triggers the nudge once
- **WHEN** a session starts in a cwd with no `doctrine` key in any config layer
- **THEN** the first turn's system prompt contains the first-contact instruction
- **AND** subsequent turns of the same session do not repeat it

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
When a loaded context file (e.g. a root `AGENTS.md`) already contains a seeded doctrine section — identified by a `dox:write`, `dox:read:kb` or `dox:read:manual` section delimiter, with or without the `<!-- dox-doctrine -->` marker — the extension SHALL skip injection for that cwd and SHALL, instead of the first-contact instruction and unless the resolved `doctrine.inject` is `off`, append a once-per-session migration instruction: tell the user the project carries a legacy doctrine copy and, on confirmation, replace the block from the marker through its last section delimiter with the pointer block, then proceed with the first-contact question. Declining SHALL leave the file untouched. A pointer-only block carrying the marker but no section delimiter SHALL NOT suppress injection.

#### Scenario: Legacy full seed present
- **WHEN** the root `AGENTS.md` carries a `dox:write`, `dox:read:kb` or `dox:read:manual` section delimiter
- **THEN** no doctrine fragment is injected
- **AND** the migration instruction is injected once for the session
- **AND** the first-contact instruction is not injected

#### Scenario: Migration accepted
- **WHEN** the user confirms the migration
- **THEN** the legacy block is replaced by the pointer block
- **AND** the next session injects the doctrine per the recorded config

#### Scenario: Pointer block present
- **WHEN** the root `AGENTS.md` carries only the marker and the pointer block
- **THEN** the doctrine fragment is injected per the resolved config
