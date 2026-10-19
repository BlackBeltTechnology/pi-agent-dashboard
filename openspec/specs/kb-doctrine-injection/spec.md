# kb-doctrine-injection Specification

## Purpose
The kb extension delivers the DOX doctrine (kb-first READ discipline, directory `AGENTS.md` WRITE discipline) to the agent per turn, governed by a layered `doctrine` setting, so projects no longer carry a drifting copy in their root `AGENTS.md`.

## Requirements

### Requirement: Doctrine is appended to the system prompt per turn
When the kb extension is loaded for a cwd and the resolved `doctrine.inject` is `kb`, the extension SHALL add the canonical READ doctrine to the system prompt on every agent turn, as the structured custom section named `dox_doctrine` (`event.systemPromptOptions.sections.dox_doctrine`), whose content begins with the recognisable `── dox doctrine ──` marker line. When `doctrine.inject` is `off`, no `dox_doctrine` section SHALL be contributed. The text SHALL be the same canonical doctrine text previously seeded by `project-init`; this change SHALL NOT reduce the doctrine content. First-contact and legacy-migration instructions SHALL be delivered through the same `dox_doctrine` section. The extension SHALL NOT return a `systemPrompt` value and SHALL NOT set `forceSystemPrompt`.

#### Scenario: READ doctrine injected
- **WHEN** the extension is active in a cwd whose resolved `doctrine.inject` is `kb`
- **THEN** the system prompt for that turn contains the READ doctrine under the `── dox doctrine ──` marker inside the `dox_doctrine` section
- **AND** the handler returns no `systemPrompt`

#### Scenario: Injection disabled
- **WHEN** the resolved `doctrine.inject` is `off`
- **THEN** the system prompt contains no `── dox doctrine ──` fragment
- **AND** `doctrine.write` has no effect

#### Scenario: Coexists with other prompt injectors
- **WHEN** another extension also contributes to the system prompt in the same turn, either as a structured section (e.g. the dashboard bridge `dashboard_session` section) or as a tool/prompt guideline (e.g. the roles plugin's Agent guideline)
- **THEN** all contributions are present in the system prompt sent to the provider, regardless of handler order

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
- **THEN** no `dox_doctrine` section is contributed
- **AND** a `[kb]`-prefixed warning is emitted once per session

#### Scenario: Handler latency budget
- **WHEN** the handler runs 100 turns against a warm project config
- **THEN** p95 wall time of the handler (config reads + fragment build + section write) is below 20 ms

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

### Requirement: Every kb retrieval tool is listed in the system prompt
Each tool the kb extension registers (`kb_search`, `kb_get`, `kb_neighbors`, `kb_guard_pause`) SHALL declare a one-line prompt snippet, so pi lists it in the system prompt's `<tools>` section whenever it is active. Each SHALL also contribute at least one usage guideline to the `<rules>` section. The `kb_guard_pause` guideline SHALL state that it is for bulk exploration only, never a way to skip a kb lookup.

#### Scenario: All kb tools appear in the tools section
- **WHEN** an agent run starts with `kb_search`, `kb_get`, `kb_neighbors` and `kb_guard_pause` active
- **THEN** the system prompt's `<tools>` section SHALL contain one line for each of the four tools

#### Scenario: kb tool guidelines appear in the rules section
- **WHEN** an agent run starts with the kb tools active
- **THEN** the `<rules>` section SHALL contain at least one guideline mentioning each of `kb_get`, `kb_neighbors` and `kb_guard_pause`
- **AND** the `kb_guard_pause` guideline SHALL say it must not be used to skip a kb lookup

#### Scenario: Inactive tool is not listed
- **WHEN** `kb_guard_pause` is not in the active tool set
- **THEN** neither its `<tools>` line nor its guideline SHALL appear
