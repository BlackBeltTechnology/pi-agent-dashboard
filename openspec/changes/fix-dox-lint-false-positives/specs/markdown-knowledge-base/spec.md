# markdown-knowledge-base — delta

## MODIFIED Requirements

### Requirement: DOX tree health-check via `kb dox lint`

The system SHALL provide an on-demand `kb dox lint` command that audits the DOX
`AGENTS.md` tree deterministically (no LLM extraction) and reports drift: stale
rows (a row whose tracked source-hash differs from the file on disk), orphan rows
(a row whose path no longer exists), missing rows (a documented-eligible source
file in an area with no row), missing companions (a file past the configured
size/LOC threshold lacking its `<file>.agent.md`), broken pointer-map links (a
root/area pointer whose target path does not resolve), and over-threshold areas
(an `AGENTS.md` whose row count exceeds the configured cap and should sub-split).

The command SHALL resolve each row's path **relative to the directory of the
`AGENTS.md` that declares the row** (per the DOX schema "path relative to that
`AGENTS.md`"), NOT relative to the project root. The command SHALL treat a table
row as a DOX file row **only when it appears under a `# DOX —` heading**; rows in
any other table (routing, QA, prose) SHALL be ignored.

It SHALL support `--json` for machine consumption (CI gates) and SHALL exit
non-zero when issues are found. It SHALL support `--fix` that performs only the
deterministic subset — pruning orphan rows and inserting missing **path-only**
rows — and SHALL leave purpose authoring and prose to the LLM (the same
detect-don't-write rule as `kb dox init` and the Phase-2 hook). It SHALL NOT call
any LLM or embedding model.

#### Scenario: Row path resolves relative to its AGENTS.md

- **WHEN** `kb dox lint` audits a sub-directory `AGENTS.md` whose row
  `| \`api.ts\` |` names a file that exists in that same directory
- **THEN** the row SHALL NOT be reported as an orphan
- **AND** `kb dox lint --fix` SHALL NOT remove that row

#### Scenario: Non-DOX table rows are ignored

- **WHEN** `kb dox lint` audits an `AGENTS.md` containing a table under a
  non-`DOX —` heading (e.g. a routing table with `| \`Explore\` |`) or a glob
  cell (`| \`qa/packer/*.pkr.hcl\` |`)
- **THEN** those rows SHALL NOT be parsed as DOX file rows
- **AND** they SHALL NOT be reported as orphans

#### Scenario: Report drift

- **WHEN** `kb dox lint` runs over a project whose DOX tree has a stale row, an
  orphan row, and a missing row
- **THEN** it SHALL report each issue with its category, the AGENTS.md file, and
  the affected path
- **AND** it SHALL exit non-zero

#### Scenario: Clean tree passes

- **WHEN** `kb dox lint` runs over a DOX tree with no detected issues
- **THEN** it SHALL report no issues AND exit zero

#### Scenario: JSON output for CI

- **WHEN** `kb dox lint --json` runs
- **THEN** it SHALL emit the issue list as machine-readable JSON

#### Scenario: Deterministic fix only

- **WHEN** `kb dox lint --fix` runs on a tree with orphan rows and missing rows
- **THEN** it SHALL remove the orphan rows and insert missing rows with the path
  filled and the purpose left for the LLM
- **AND** it SHALL NOT author or alter any purpose text

#### Scenario: No LLM extraction

- **WHEN** `kb dox lint` runs
- **THEN** it SHALL NOT call any LLM or embedding model to derive its findings
