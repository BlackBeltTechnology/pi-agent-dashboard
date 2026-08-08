## ADDED Requirements

### Requirement: `AGENTS.override.md` shadows directory context instead of appending

pi 0.84.1 recognizes `AGENTS.override.md` as a per-directory context override that REPLACES the context files for that directory rather than adding to them. pi's own loader owns injection into the agent (`dist/core/resource-loader.js` lists the override first among its candidates and returns on first match), so the dashboard SHALL NOT reimplement that resolution.

Where the dashboard keeps its OWN notion of which files are context files — the kb agents-chain walk, the kb index doc-typing, and the kb extension's context-file name set — it SHALL treat an `AGENTS.override.md` as shadowing its siblings in the same directory, so the same logical repository scope is not surfaced twice. Ancestor inheritance SHALL be unaffected: only the overridden directory is replaced.

#### Scenario: Override shadows the sibling AGENTS.md

- **WHEN** a directory contains both `AGENTS.override.md` and `AGENTS.md`
- **THEN** only the override's content SHALL be treated as that directory's context
- **AND** the sibling `AGENTS.md` SHALL NOT also be applied for that directory

#### Scenario: No override leaves inheritance untouched

- **WHEN** a directory contains no `AGENTS.override.md`
- **THEN** normal `AGENTS.md` ancestor inheritance SHALL apply unchanged

#### Scenario: Override shadows CLAUDE.md too

- **WHEN** a directory contains both `AGENTS.override.md` and `CLAUDE.md` and CLAUDE-file support is enabled
- **THEN** only the override SHALL be treated as that directory's context

#### Scenario: Override is doc-typed as a context file

- **WHEN** the kb indexer assigns a doc type to `AGENTS.override.md`
- **THEN** it SHALL be typed as an `agents` context file, not as an ordinary `doc`

#### Scenario: Pi owns injection; no dashboard feature-detection branch

- **WHEN** the running pi predates `AGENTS.override.md` support
- **THEN** that pi simply never loads such a file and normal `AGENTS.md` inheritance applies
- **AND** the dashboard SHALL NOT carry a version- or shape-gated fallback branch for it
