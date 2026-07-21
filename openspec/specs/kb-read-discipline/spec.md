# kb-read-discipline Specification

## Purpose

Steer agents to the `kb_*` tools before raw source search. The docs-first READ
discipline is expressed as a mechanical tool-substitution table (reflex → exact
`kb_*` command) in the root `AGENTS.md` and in the `project-init` seeded
doctrine, so agents reflex-run the cheap kb call instead of grepping source.
Established by change `steer-agents-to-kb-tools` after measured under-use of the
kb surface (grep/rg dominating `kb_search` ~10:1, mostly symbol lookups).

## Requirements

### Requirement: The READ discipline is a mechanical tool-substitution table

The docs-first READ discipline SHALL be expressed as a tool-substitution table
that maps a raw-search reflex (`grep`/`rg`/`cat`/`Read`) to the exact `kb_*`
invocation to run first, rather than as prose. The table SHALL name the
symbol-lookup case explicitly and SHALL present `kb_neighbors` and `kb_get` as
the follow-through after `kb_search`.

#### Scenario: Symbol-lookup row exists with an exact command
- **WHEN** an agent reads the root `AGENTS.md` READ discipline
- **THEN** a table row maps "find where a function / type / const lives" to `kb_search --doc-type agents "<Symbol>"`
- **AND** the row states the tree indexes key exported symbols per file

#### Scenario: Chain-through tools are named
- **WHEN** the READ discipline table is present
- **THEN** it includes a row routing "chase imports / callers" to `kb_neighbors`
- **AND** a row routing "read one doc section in full" to `kb_get`

#### Scenario: Framing leads with cost, not compliance
- **WHEN** the READ discipline is rendered
- **THEN** it presents the kb-first rule as faster/cheaper with the exact command
- **AND** it does not rely on "STOP" / "you violated the protocol" scare framing to carry the rule

### Requirement: Fall-through to raw search stays explicit and loops back

The substitution table SHALL preserve an explicit fall-through: raw `rg` / source
read is permitted when the tree misses, and the agent SHALL then add the missing
row per the WRITE discipline. The table SHALL NOT read as "kb replaces grep."

#### Scenario: Tree miss permits grep then requires a row
- **WHEN** `kb_search` returns nothing relevant for a lookup
- **THEN** the discipline permits `rg` / source read as the fall-through
- **AND** it directs the agent to add the missing `AGENTS.md` row afterward

### Requirement: New projects inherit the substitution table

The `project-init` seeded READ discipline SHALL carry the substitution table. The
kb-wired variant (`dox:read:kb`) SHALL use `kb agents` / `kb_search`; the manual
variant (`dox:read:manual`) SHALL carry a degraded same-shape table that walks
the directory `AGENTS.md` chain instead of calling `kb_search`.

#### Scenario: kb-wired seed carries the table
- **WHEN** `project-init` seeds a project whose kb toolset is wired
- **THEN** the root `AGENTS.md` READ block contains the substitution table using `kb agents` / `kb_search`

#### Scenario: Manual seed carries a degraded table
- **WHEN** `project-init` seeds a project without the kb toolset
- **THEN** the root `AGENTS.md` READ block contains a same-shape table whose lookup rows walk the directory `AGENTS.md` chain

### Requirement: The coding template does not steer to blind source reads

The `project-init` `coding` profile `AGENTS.md` template SHALL NOT instruct
"read the file first" without a kb-first qualifier. It SHALL direct the agent to
consult the doc tree (`kb agents <path>` / `kb_search`) before opening the
specific file.

#### Scenario: Template routes through the tree first
- **WHEN** the `coding` profile template renders its "Think Before Coding" guidance
- **THEN** the never-speculate rule reads "consult the doc tree (`kb agents <path>` / `kb_search`) first, then read the specific file"
- **AND** no line instructs reading a source file as the first investigation step
