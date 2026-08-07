## ADDED Requirements

### Requirement: `AGENTS.override.md` shadows directory context instead of appending

pi 0.84.1 recognizes `AGENTS.override.md` as a per-directory context override that REPLACES the context files for that directory rather than adding to them. Where the dashboard reasons about which context files apply to a directory, it SHALL treat an `AGENTS.override.md` as shadowing the sibling `AGENTS.md`, so the same logical repository scope is not injected twice.

#### Scenario: Override shadows the sibling AGENTS.md

- **WHEN** a directory contains both `AGENTS.override.md` and `AGENTS.md`
- **THEN** only the override's content SHALL be treated as that directory's context
- **AND** the sibling `AGENTS.md` SHALL NOT also be applied for that directory

#### Scenario: No override leaves inheritance untouched

- **WHEN** a directory contains no `AGENTS.override.md`
- **THEN** normal `AGENTS.md` ancestor inheritance SHALL apply unchanged

#### Scenario: Override is recognized as a context resource

- **WHEN** the dashboard enumerates context-file resources for a directory
- **THEN** `AGENTS.override.md` SHALL be classified as a context resource, not as an ordinary markdown file

#### Scenario: Floor pi without override support

- **WHEN** the running pi does not recognize `AGENTS.override.md`
- **THEN** the dashboard SHALL fall back to normal `AGENTS.md` inheritance with no crash and no behavior regression
