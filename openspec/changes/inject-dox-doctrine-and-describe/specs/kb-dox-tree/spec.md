## ADDED Requirements

### Requirement: Empty-purpose enumeration
The `dox describe --list` operation SHALL walk the same directory set as `dox init` and report every `| File | Purpose |` row whose Purpose cell is empty, grouped by `AGENTS.md` path. Output SHALL be human-readable by default and machine-readable with `--json`; `--dir <path>` SHALL restrict the walk to one subtree.

#### Scenario: Rows reported per AGENTS.md
- **WHEN** two `AGENTS.md` files each carry an empty-purpose row
- **THEN** the output lists both files, each with its empty subject paths

#### Scenario: JSON output
- **WHEN** `--json` is passed
- **THEN** the output is a JSON array of `{ agentsPath, subjects: string[] }` plus a total count
