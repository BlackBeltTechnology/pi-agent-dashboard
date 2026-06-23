# research-doc-workflow — delta

## ADDED Requirements

### Requirement: Single indexed research-doc home

The project SHALL keep forward-looking research, exploration, plans, and roadmaps
in a single directory, `docs/research/`. The directory SHALL contain a
`README.md` index listing every document with a title, a one-line summary, and a
status. The home SHALL be referenced from `docs/file-index.md` so the index-first
Investigation Protocol surfaces it. No separate `docs/plan/`, `docs/plans/`, or
`docs/architecture-notes/` directory SHALL exist for this content.

#### Scenario: New session discovers research via the index

- **WHEN** an agent follows the index-first Investigation Protocol from `docs/file-index.md`
- **THEN** it SHALL find a "Standalone topic docs" row pointing at `docs/research/README.md`.

#### Scenario: Every research doc is indexed

- **WHEN** a document is added under `docs/research/`
- **THEN** a matching row SHALL exist in `docs/research/README.md` and all in-table links SHALL resolve.

### Requirement: Research placement convention

`AGENTS.md` SHALL state, in its OpenSpec Conventions, that a proposal's research
rationale belongs in the change's `design.md`, and that research which outlives
the change SHALL be saved under `docs/research/` and referenced from
`proposal.md`. The convention SHALL NOT instruct agents to add per-research
pointers to `AGENTS.md` itself.

#### Scenario: Evergreen research is promoted, not archived away

- **WHEN** research backing a proposal is reusable beyond that change
- **THEN** it SHALL be saved under `docs/research/` and linked from `proposal.md`, not left only in `design.md` (which is archived with the change).

### Requirement: research-doc-synthesis skill-plugin

The repository SHALL ship a `research-doc-synthesis` skill as a monorepo
skill-plugin at `packages/research-doc-skill/`. The package SHALL declare the
skill via the `pi.skills` field and include `.pi/skills/` in its `files`. The
package SHALL carry the monorepo lockstep version so `scripts/sync-versions.js`
is not violated by it. The skill SHALL NOT be placed under the gitignored
`.pi/skills/openspec-*` paths.

#### Scenario: Skill is discoverable and shippable

- **WHEN** the package is present in the workspace
- **THEN** pi SHALL discover `research-doc-synthesis` from `packages/research-doc-skill/.pi/skills/`, and `npm` SHALL recognize the workspace.

#### Scenario: Skill routes non-matching work elsewhere

- **WHEN** the need is single-change rationale, a quick lookup, library internals, or a pure codebase question
- **THEN** the skill SHALL direct the agent to `design.md`, `web_search`, the `librarian` skill, or `Explore` respectively, rather than producing a research doc.

### Requirement: Parallel fan-out synthesis into a stable skeleton

The skill SHALL achieve parallel web search by spawning multiple `@fast`
subagents, one per search angle, because in-agent multi-query search and stacked
tool calls execute sequentially. Each subagent SHALL return a compact synthesis
(findings plus source links), not raw page content. The skill SHALL synthesize
results into a fixed document skeleton (TL;DR, Question, Context, Findings,
Options & Tradeoffs, Recommendation, Risks, Sources); it SHALL NOT invent a
per-document structure.

#### Scenario: Concurrency comes from subagents

- **WHEN** the skill researches across multiple angles
- **THEN** it SHALL fan out one `@fast` subagent per angle rather than relying on a single agent's sequential multi-query search.

#### Scenario: Output uses the fixed skeleton

- **WHEN** the skill writes a document to `docs/research/`
- **THEN** the document SHALL follow the fixed skeleton, with content synthesized per topic and optional sections dropped only when empty.
