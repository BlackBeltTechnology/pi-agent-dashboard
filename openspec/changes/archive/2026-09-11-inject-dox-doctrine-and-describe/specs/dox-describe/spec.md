## Purpose

Populate empty Purpose cells in the directory `AGENTS.md` tree with LLM-authored one-line summaries so a freshly scaffolded tree becomes a searchable kb corpus.

## ADDED Requirements

### Requirement: Empty-purpose rows are enumerable without an LLM
The kb CLI SHALL provide `dox describe --list` that enumerates rows of every directory `AGENTS.md` whose Purpose cell is empty, grouped by `AGENTS.md` path, each with the row's subject path. It SHALL support `--json` output and `--dir <path>` to restrict the walk. It SHALL NOT call any model or write any file.

#### Scenario: List empty rows
- **WHEN** `dox describe --list` runs over a tree with some empty Purpose cells
- **THEN** it prints each `AGENTS.md` path with its empty-purpose subject paths and a total count

#### Scenario: Nothing to describe
- **WHEN** no Purpose cell is empty
- **THEN** it prints an empty list and exits 0

### Requirement: The describe skill plans, confirms, then fills only empty cells
The `dox-describe` skill SHALL (1) obtain the empty-row list, (2) present a plan — number of `AGENTS.md` files, number of rows, a rough cost estimate, and the per-run cap of 50 rows (rows beyond the cap are deferred to a re-run) — (3) ask the user to confirm, and only then (4) fan out one subagent per `AGENTS.md` file. Each subagent SHALL read every file it describes, write a one-line Purpose in the row schema (`| File | Purpose |`, symbols verbatim, key exports/contracts, no prose beyond the cap), and edit only its own `AGENTS.md`. Rows whose file cannot be read SHALL stay empty. After fan-out the skill SHALL run the DOX lint and reindex the kb. Re-running the skill SHALL touch only cells that are still empty.

#### Scenario: Plan then confirm
- **WHEN** the skill is invoked
- **THEN** it shows the plan and waits for confirmation before any subagent runs

#### Scenario: Cap reached
- **WHEN** the tree has 51 empty Purpose cells
- **THEN** one run fills at most 50 and reports 1 deferred row
- **AND** a second run fills the remaining row

#### Scenario: Fill is idempotent
- **WHEN** the skill runs a second time on a tree where all cells were filled
- **THEN** no `AGENTS.md` is modified

#### Scenario: Unreadable file
- **WHEN** a row's subject file cannot be read by the subagent
- **THEN** its Purpose cell remains empty and is reported at the end

#### Scenario: Post-run verification
- **WHEN** fan-out completes
- **THEN** the DOX lint runs and the kb index is rebuilt so the new purposes are searchable
