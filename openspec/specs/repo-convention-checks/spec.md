# repo-convention-checks Specification

## Purpose
TBD - created by archiving change wire-local-review-gate. Update Purpose after archive.
## Requirements
### Requirement: A single script enforces the mechanically-checkable AGENTS.md conventions

The project SHALL provide `scripts/check-conventions.mjs`, following the existing
`scripts/*.mjs` pattern (no new dependency, no rule engine). It SHALL cover
exactly four rules and SHALL exit non-zero when any gating rule is violated.
Every violation count SHALL be re-derived against the current tree at
implementation time rather than taken from the proposal text.

#### Scenario: Script exists and is runnable

- **WHEN** `node scripts/check-conventions.mjs` runs from the repo root
- **THEN** it reports a per-rule result for all four rules
- **AND** it requires no dependency beyond the existing toolchain

#### Scenario: Clean repo exits zero

- **WHEN** no gating rule is violated
- **THEN** the script exits 0

### Requirement: Diagrams use Mermaid, not ASCII box-drawing

The check SHALL flag a documentation file only when a box-drawing character
appears **inside a fenced code block** and the line is **not** a directory-tree
listing row. Directory trees using `├──`, `└──`, or a leading `│` SHALL NOT be
flagged. This rule is gating.

#### Scenario: ASCII box-drawn diagram detected

- **WHEN** a `docs/` or root markdown file contains a box-drawn diagram inside a fenced block
- **THEN** the check reports the file and line
- **AND** the script exits non-zero

#### Scenario: Directory-tree listings are not diagrams

- **WHEN** a file contains a fenced directory tree using `├──` / `└──` rows
- **THEN** the check reports no violation for those lines
- **AND** `README.md` and `docs/electron-session.md` remain clean under this rule

#### Scenario: Mermaid block passes

- **WHEN** a diagram is expressed in a ```mermaid fenced block
- **THEN** the check reports no violation for that diagram

### Requirement: Browser scenarios live in Playwright specs, not shell tests

The check SHALL flag a `qa/tests/*.sh` file only when it drives **rendered
browser UI**. WebSocket assertions, HTTP/health-endpoint assertions, and
display-server launches SHALL NOT be treated as violations, because those
scenarios legitimately belong to the per-OS VM matrix. This rule is gating and
ships as a regression guard: there are **zero** violations today.

#### Scenario: Browser-rendering assertion in a shell test

- **WHEN** a `qa/tests/*.sh` file asserts on rendered browser UI
- **THEN** the check reports the file
- **AND** the script exits non-zero

#### Scenario: Existing WS and health smokes are not violations

- **WHEN** the check runs against the current `qa/tests/` directory
- **THEN** `03-websocket.sh`, `04-ws-ticket-auth.sh`, and `10-faux-model.sh` are not flagged
- **AND** the rule reports zero violations

### Requirement: The root AGENTS.md carries no per-file index

The check SHALL flag a **table of file-purpose rows** in the root `AGENTS.md`. A
prose section that merely names Key Files and points to the directory tree SHALL
NOT be flagged. This rule is gating and serves as a regression guard.

#### Scenario: Per-file rows reintroduced

- **WHEN** the root `AGENTS.md` gains a table of per-file rows
- **THEN** the check reports the violation
- **AND** the script exits non-zero

#### Scenario: Current root AGENTS.md passes

- **WHEN** the check runs against the current root `AGENTS.md`, whose `## Key Files` section contains only a pointer
- **THEN** the check reports no violation

### Requirement: Touched proposals declare their discipline skills

The check SHALL require a `## Discipline Skills` line in every `proposal.md` the
current change touches. "Touched" SHALL be defined as added or content-modified
relative to a base supplied by an explicit `--base` flag. Pure renames SHALL NOT
count as touched. Proposals the change did not touch SHALL NOT be gated. This
rule is gating when a base is supplied, and reporting-only when it is not.

#### Scenario: Touched proposal missing the line

- **WHEN** the change adds or modifies a `proposal.md` with no `## Discipline Skills` section
- **THEN** the check reports the file
- **AND** the script exits non-zero

#### Scenario: Untouched legacy proposal is not gated

- **WHEN** an existing `proposal.md` lacks the line and the current change does not touch it
- **THEN** the check does not fail on that file

#### Scenario: A relocated proposal is not treated as authored

- **WHEN** the change moves a non-conforming `proposal.md` to a new path without changing its content
- **THEN** the rename is not treated as touching the file
- **AND** the gate does not fail on it

#### Scenario: Base is supplied explicitly by the caller

- **WHEN** `ship-it` step 4.4 invokes the check
- **THEN** it passes `--base origin/develop`, the same ref step 2.5 merges
- **AND** the touched set is resolved against that base, never against an inferred one

#### Scenario: Standalone invocation has no touched set

- **WHEN** the script runs without `--base`
- **THEN** the Discipline-Skills rule reports without gating
- **AND** the other three tree-absolute rules run normally

### Requirement: Wiring the checks does not land a permanently red gate

Every violation existing when a rule is wired SHALL be cleared in the same
change, so the gate is green the moment it becomes enforcing.

#### Scenario: Pre-existing violations cleared

- **WHEN** the convention checks are wired into `ship-it` step 4.4
- **THEN** the ASCII-diagram violations have been converted to Mermaid
- **AND** the over-cap `AGENTS.md` has been split
- **AND** the wired gate exits 0 on the change's own tree

#### Scenario: No harmful migration is mandated

- **WHEN** the browser-scenario rule is wired
- **THEN** no existing `qa/tests/*.sh` is migrated to Playwright
- **AND** the per-OS VM matrix is left intact

