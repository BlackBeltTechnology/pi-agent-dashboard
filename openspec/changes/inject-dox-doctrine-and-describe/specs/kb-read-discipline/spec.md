## MODIFIED Requirements

### Requirement: New projects inherit the substitution table

The READ discipline, including the substitution table using `kb agents` / `kb_search`, SHALL be delivered to new projects by the kb extension's per-turn doctrine injection rather than by text seeded into the root `AGENTS.md`. `project-init` SHALL seed only a marker + pointer block naming the extension and the project settings file. The manual (`dox:read:manual`) variant is no longer produced.

#### Scenario: kb-wired seed carries the table
- **WHEN** `project-init` seeds a project and the kb extension is loaded there
- **THEN** the agent's system prompt carries the substitution table via injection
- **AND** the root `AGENTS.md` carries only the marker + pointer block

#### Scenario: Manual seed carries a degraded table
- **WHEN** `project-init` seeds a project and the kb extension is not loaded
- **THEN** no degraded table is seeded
- **AND** the root `AGENTS.md` pointer block names the extension and the settings file that provide the doctrine

### Requirement: Runtime enforcement may replace per-turn pressure, never per-turn routing
Where the guard is active, the compliance-pressure portion of the per-turn READ doctrine MAY be reduced, because the guard delivers it at the moment of violation. The routing portion — which kb call to run, which retrieval lane to select, and which corpus each tool indexes — SHALL be retained in the per-turn doctrine regardless of guard status, because a violation-time nudge cannot carry it.

#### Scenario: Routing survives any trim
- **WHEN** the per-turn READ doctrine is reduced on the strength of runtime enforcement
- **THEN** the tool-substitution rows, the retrieval-lane selection rule, and the corpus boundaries SHALL remain present
- **AND** the fall-through rule SHALL remain present

#### Scenario: A surface the guard cannot observe keeps its doctrine
- **WHEN** an agent surface exists where the guard's hooks do not fire
- **THEN** the per-turn doctrine for that surface SHALL NOT be reduced

#### Scenario: Seeded projects keep the full doctrine
- **WHEN** the kb extension injects the READ doctrine into a project
- **THEN** the injected text SHALL carry the full table irrespective of whether the guard is enabled, because injection is the project's only carrier of the doctrine
