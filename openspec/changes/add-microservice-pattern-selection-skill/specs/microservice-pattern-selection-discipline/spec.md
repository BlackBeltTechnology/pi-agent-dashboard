## ADDED Requirements

### Requirement: microservice-pattern-selection ships inside the published eng-disciplines package

The `microservice-pattern-selection` skill SHALL live under
`packages/eng-disciplines/.pi/skills/microservice-pattern-selection/` and SHALL be
registered in that package's `pi.skills[]` manifest so any pi session that loads
`@blackbelt-technology/pi-dashboard-eng-disciplines` discovers it by
natural-language trigger. The skill directory SHALL contain only its canonical
files (`SKILL.md` + `references/*.md`) and SHALL NOT carry orphan per-file
`*.AGENTS.md` doc sidecars — its DOX detail lives inline in
`packages/eng-disciplines/AGENTS.md`, matching the package's sibling skills.

#### Scenario: eng-disciplines session discovers the skill

- **WHEN** a pi session loads the eng-disciplines package
- **THEN** `microservice-pattern-selection` appears in the available-skills list
- **AND** its NL triggers load the full SKILL.md body
- **AND** the skill is present in the package's `pi.skills[]` array

#### Scenario: no orphan doc sidecars in the package

- **WHEN** an auditor lists `*.AGENTS.md` files under the skill directory
- **THEN** none exist
- **AND** `packages/eng-disciplines/AGENTS.md` carries one inline DOX row per
  shipped file of the skill
- **AND** `npm pack --dry-run` for the package lists `SKILL.md` and every
  `references/*.md` file

### Requirement: Gate zero precedes any pattern routing

The skill SHALL, before consulting any cluster, determine whether the stated
problem involves more than one independently deployed unit or an operation
spanning such units. When it does not, the skill SHALL recommend the
non-distributed answer and SHALL stop without routing to a cluster.

#### Scenario: non-distributed problem is rejected before routing

- **WHEN** the user describes a problem inside a single deployable application
  with a single database
- **THEN** the skill states that the problem does not require a pattern from this
  language
- **AND** it recommends keeping one service and one database
- **AND** it does NOT name a cluster or recommend a pattern

#### Scenario: distributed problem passes the gate

- **WHEN** the user describes an operation spanning two independently deployed
  services
- **THEN** the skill proceeds to route the problem to a cluster

### Requirement: SKILL.md is a router and carries no pattern content

`SKILL.md` SHALL contain the gate-zero check, a symptom-to-cluster routing table,
the retrieval procedure, and hand-off lines. Pattern solutions, forces, and
consequences SHALL live only in `references/*.md` and SHALL be read on demand.

#### Scenario: routing selects one cluster file

- **WHEN** the skill is given a stated problem that passes gate zero
- **THEN** it names exactly one cluster file to read
- **AND** it reads that file before making a recommendation

#### Scenario: SKILL.md does not inline pattern bodies

- **WHEN** an auditor inspects `SKILL.md`
- **THEN** it contains no `Solution:` or `Consequences:` field for any pattern
- **AND** every pattern reference is a pointer to a `references/*.md` file

### Requirement: Cluster files use the fixed card schema

Each `references/*.md` file SHALL declare frontmatter carrying `cluster`, `kind`,
and `patterns`. It SHALL state the shared context, problem, and forces once at
file level, and SHALL represent each pattern as exactly one `##` heading whose
body carries `Solution`, `Consequences`, `Use when`, `Avoid when`, `Source`, and
`Depth` fields.

#### Scenario: shared forces are stated once per cluster

- **WHEN** a cluster file contains more than one pattern
- **THEN** the shared context, problem, and forces appear once at file level
- **AND** they are not repeated inside any pattern's `##` section

#### Scenario: every pattern is an addressable chunk

- **WHEN** the knowledge-base indexer chunks a cluster file
- **THEN** each pattern yields its own retrievable section
- **AND** that section's heading path names both the cluster and the pattern

#### Scenario: mandatory fields present on every card

- **WHEN** an auditor inspects any pattern `##` section
- **THEN** `Solution`, `Consequences`, `Source`, and `Depth` are all present
- **AND** `Source` is an absolute `https://microservices.io/patterns/…` URL

### Requirement: Pattern relations are encoded both as links and as prose

Relations between patterns (alternative, prerequisite, successor) SHALL be
written as relative markdown links between cluster files AND as readable text in
the same line, so that relation information survives retrieval methods that do
not expose a link graph.

#### Scenario: relation survives a plain-text search hit

- **WHEN** a single pattern section is retrieved in isolation by text search
- **THEN** the retrieved text names its alternatives, prerequisites, and
  successors
- **AND** no external graph lookup is required to learn them

#### Scenario: relation is walkable as a graph edge

- **WHEN** the knowledge base has indexed the cluster files
- **THEN** a neighbour query from one pattern's file surfaces the files holding
  its related patterns

### Requirement: Cluster kind dictates the reading protocol

Every cluster SHALL declare a `kind` of `decision`, `checklist`, `chain`, or
`single`, and the skill SHALL apply the protocol matching that kind: choose
exactly one for `decision`, adopt all applicable for `checklist`, respect
prerequisite ordering for `chain`, and perform an applicability check for
`single`.

#### Scenario: checklist cluster does not manufacture a choice

- **WHEN** the user's problem routes to a `checklist` cluster
- **THEN** the skill presents the applicable patterns as complementary
- **AND** it does not ask the user to choose one instead of another

#### Scenario: chain cluster enforces prerequisite ordering

- **WHEN** the user's problem routes to a `chain` cluster
- **THEN** the skill names the prerequisite pattern before its successors
- **AND** it does not recommend a successor pattern in isolation

#### Scenario: decision cluster yields exactly one recommendation

- **WHEN** the user's problem routes to a `decision` cluster
- **THEN** the skill recommends exactly one pattern from that cluster
- **AND** it states why the rejected alternatives lost on the cluster's forces

### Requirement: Every recommendation states its drawbacks

The skill SHALL NOT recommend a pattern without stating that pattern's
consequences or drawbacks.

#### Scenario: recommendation includes consequences

- **WHEN** the skill recommends any pattern
- **THEN** the response includes that pattern's `Consequences` content
- **AND** the response names at least one condition under which the pattern
  should be avoided

### Requirement: Card content is provenance-marked by source depth

Each pattern card SHALL carry a `Depth` marker of `A`, `B`, or `C`. Content
supplied from outside the source page SHALL be annotated as not originating from
the source page. Cards marked `C` SHALL remain short pointer cards and SHALL NOT
be expanded into full cards from outside sources.

#### Scenario: externally supplied trade-off is marked

- **WHEN** a card carries forces or drawbacks that its source page does not
  contain
- **THEN** that content is annotated as not present on the source page

#### Scenario: thin source yields a thin card

- **WHEN** the source page for a pattern contains only a stub or a book pointer
- **THEN** the card is marked `Depth: C`
- **AND** the card is a short pointer card rather than a full-length card

### Requirement: The reference set covers the whole pattern language

The `references/` directory SHALL cover all 55 patterns of the source pattern
language, partitioned across cluster files with no pattern omitted and no pattern
appearing in two clusters.

#### Scenario: coverage is complete and non-overlapping

- **WHEN** an auditor collects the `patterns` frontmatter lists of every cluster
  file
- **THEN** the union contains 55 distinct pattern slugs
- **AND** no slug appears in more than one cluster file

### Requirement: Retrieval degrades without a knowledge base

The skill SHALL be usable when neither a knowledge-base index nor a
content-indexing tool is available, by routing to and reading a cluster file
directly. Index-backed search SHALL be an accelerator and SHALL NOT be a
precondition for producing a recommendation.

#### Scenario: bare environment still produces a recommendation

- **WHEN** the skill runs in a project with no knowledge-base index and no
  content-indexing tool
- **THEN** it routes via the SKILL.md table and reads the cluster file directly
- **AND** it produces a recommendation with consequences

### Requirement: Knowledge-base registration is project-scoped, consented, and verified

When registering the skill's `references/` directory as a knowledge-base source,
the skill SHALL register it in the project-scoped configuration rather than the
global configuration, SHALL obtain user confirmation before writing, and SHALL
verify after writing that the source is present in the resolved configuration.
Declining registration SHALL NOT block the skill.

#### Scenario: registration is confirmed before any config write

- **WHEN** the skill determines its references directory is not a registered
  source
- **THEN** it asks the user before modifying any configuration file

#### Scenario: declining registration leaves the skill usable

- **WHEN** the user declines registration
- **THEN** no configuration file is modified
- **AND** the skill continues and still produces a recommendation

#### Scenario: registration is verified rather than assumed

- **WHEN** registration has been performed
- **THEN** the skill confirms the references directory appears in the resolved
  configuration's sources before relying on index-backed search

#### Scenario: existing project sources are preserved

- **WHEN** the project configuration already declares knowledge-base sources
- **THEN** registration leaves those existing sources intact
- **AND** the references directory is added alongside them

#### Scenario: re-running registration is a no-op

- **WHEN** the references directory is already a registered source
- **THEN** the skill does not prompt again and does not rewrite the configuration

### Requirement: Trigger boundaries with sibling disciplines are explicit

The skill SHALL hand off to `security-hardening` for implementing access-token
security and to `observability-instrumentation` for implementing observability
patterns, and its description SHALL avoid those skills' trigger verbs so that a
request to implement does not load this skill instead.

#### Scenario: security cluster hands off implementation

- **WHEN** the user is routed to the security cluster
- **THEN** the cluster file states that this skill selects the pattern and
  `security-hardening` implements it

#### Scenario: observability cluster hands off implementation

- **WHEN** the user is routed to the observability cluster
- **THEN** the cluster file states that this skill selects the patterns and
  `observability-instrumentation` implements them

### Requirement: Source attribution is recorded without reproducing source text

The package `NOTICE` SHALL record attribution for the microservices.io pattern
language as a derivation of concepts, distinct from the MIT reproduction wording
used for the package's MIT-licensed derived skills. Card bodies SHALL be original
prose.

#### Scenario: NOTICE carries a distinct attribution block

- **WHEN** an auditor reads `packages/eng-disciplines/NOTICE`
- **THEN** it contains an attribution entry for microservices.io
- **AND** that entry does not claim the content is reproduced under the MIT
  License
