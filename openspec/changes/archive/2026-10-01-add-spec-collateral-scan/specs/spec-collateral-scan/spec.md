## Purpose

An advisory scan that lists main-spec requirements an OpenSpec change may
contradict after archive — requirements outside the change's delta, and
unmodified requirements inside it, that name the code identifiers the change
touches — so planning reviewers can check a bounded candidate list.

## ADDED Requirements

### Requirement: The scan derives code-shaped identifiers from the change

The scan SHALL collect identifiers from the change's `proposal.md`, `design.md`,
`tasks.md` and every delta spec, taking backticked spans and bare code-like
tokens; any of these files that does not exist SHALL be read as empty. It SHALL keep only code-shaped identifiers: tokens containing `_`, `/`,
`@`, `:` or `.`; camel or Pascal case with an internal lower-to-upper transition
and at least 6 characters; upper-case constants of at least 5 characters; or
kebab-case with at least two hyphens. Scoped package names (`@scope/name`) and
API routes (`/api/...`) SHALL be kept whole; any other token containing `/` is a
file path and SHALL reduce to its basename including the extension, plus the
basename without extension when that stem itself passes the shape test. Capability names, OpenSpec
keywords (`ADDED`, `MODIFIED`, `REMOVED`, `RENAMED`, `REQUIREMENTS`, `SHALL`,
`MUST`, `WHEN`, `THEN`, `GIVEN`) and command-line flags (a `--` prefix followed by
a word with no further hyphen, such as `--json`) SHALL NOT count as identifiers;
CSS custom properties such as `--accent-green` SHALL count. Surrounding brackets
and punctuation, and a trailing `:<line>` or `:<line>-<line>` citation suffix,
SHALL be stripped before the shape test. Backticked spans pass the same shape
test as bare tokens. The excluded capability names are every capability
directory in the scanned specs corpus plus every capability the change's delta
specs name.

#### Scenario: Plain capitalised words are ignored

- **WHEN** the change text contains `Tasks`, `Popover` and `Apply` in backticks
- **THEN** none of them is used as an identifier

#### Scenario: Code identifiers are kept

- **WHEN** the change text contains `SessionOpenSpecActions`, `CORE_PACKAGE_NAMES`, `@earendil-works/pi-ai`, `stats_update` and `packages/server/src/pi-core-checker.ts`
- **THEN** the identifiers used include `SessionOpenSpecActions`, `CORE_PACKAGE_NAMES`, `@earendil-works/pi-ai`, `stats_update` and `pi-core-checker`

#### Scenario: OpenSpec keywords and flags are ignored

- **WHEN** the change text contains `MODIFIED`, `RENAMED`, `[--json]` and `--top`
- **THEN** none of them is used as an identifier

#### Scenario: Packages, routes and CSS variables survive; paths reduce

- **WHEN** the change text contains `@earendil-works/pi-ai`, `/api/pi-core/update`, `--accent-green` and `packages/client/src/index.css`
- **THEN** the identifiers used include `@earendil-works/pi-ai`, `/api/pi-core/update`, `--accent-green` and `index.css`
- **AND** `index` alone is not an identifier

#### Scenario: A code-shaped path stem is kept too

- **WHEN** the change text contains `packages/server/src/pi-core-checker.ts`
- **THEN** the identifiers used include both `pi-core-checker.ts` and `pi-core-checker`

#### Scenario: Missing optional artifacts are empty

- **WHEN** the change has no `design.md`
- **THEN** the scan completes with exit 0 using the remaining artifacts

#### Scenario: Capability names are excluded

- **WHEN** the change text mentions `plan-proposal-orchestrator` (an existing capability) and `spec-collateral-scan` (a capability only its own delta creates)
- **THEN** neither is used as an identifier

#### Scenario: Citation suffixes are stripped

- **WHEN** the change text cites `packages/server/src/pi-core-checker.ts:42` and `review-gate.ts:17-73`
- **THEN** the identifiers used include `pi-core-checker.ts` and `review-gate.ts`

### Requirement: Candidates are ranked by requirement-level evidence

Each identifier SHALL be weighted by `ln(N / df)` — N the number of capability
specs, df the number containing it — and by three when at least one of its occurrences is in a sentence of the change that
removes, replaces, renames, drops, retires, hides, narrows or forbids something
(the weight is the maximum over its occurrences). An identifier SHALL be dropped
when the number of capability specs containing it exceeds the larger of 2 and
4% of the corpus size rounded down; an identifier contained in no capability
spec matches nothing. A requirement's score SHALL be the sum of the weights of the identifiers occurring
in its block; an occurrence SHALL count only when the characters before and
after it are not letters, digits, underscores or hyphens. A capability outside the delta
SHALL be scored by its best-scoring requirement.

#### Scenario: One strong identifier outranks many weak ones

- **WHEN** capability A has one requirement naming a rare identifier the change removes, and capability B has many requirements each naming a different common identifier
- **THEN** A ranks above B

#### Scenario: Change intent raises weight

- **WHEN** two identifiers are equally rare and only one appears in a sentence that removes it
- **THEN** a requirement naming the removed one scores higher than one naming the other

#### Scenario: Ubiquitous identifiers are dropped

- **WHEN** the corpus has 657 capability specs and an identifier appears in 27 of them
- **THEN** it contributes to no requirement's score
- **AND** an identifier appearing in 26 of them still contributes

#### Scenario: Small corpora keep the floor of two

- **WHEN** the corpus has 20 capability specs
- **THEN** an identifier appearing in 2 of them contributes
- **AND** an identifier appearing in 3 of them is dropped

#### Scenario: Occurrences are token-bounded

- **WHEN** the change names `pi-core-version` and a requirement only contains `pi-core-version-check`
- **THEN** that occurrence does not match `pi-core-version`
- **AND** a requirement containing `pi-core-version.ts` or `(pi-core-version)` does match

### Requirement: The scan reports two bounded lists and never gates

The scan SHALL report (a) capabilities not in the delta set that have at least
one requirement matching an identifier, each with its best requirement and
matched identifiers, and (b) requirements of delta capabilities
that exist in the main specs, are not named under `## MODIFIED` or `## REMOVED`
nor as a `FROM:` of `## RENAMED`, and match at least one identifier. Each list
SHALL be sorted by score, then capability name (and, in the second list, then
requirement name), and then limited to the top N entries overall (default 10); the output SHALL state how
many entries of each list were omitted by the limit. Output SHALL be markdown by
default and JSON on request (`{ t1: { entries, omitted }, t2: { entries,
omitted }, identifiers: [{ id, weight }] }`), and SHALL name the identifiers
used for matching — those remaining after the shape test, the stoplist and the
frequency cap. The scan SHALL
read each main spec file at most once. It SHALL exit 0 whenever it completes,
whatever it finds, and SHALL exit 2 on any failure — a usage error such as an
unknown change or a missing specs directory, or a runtime error such as an
unreadable file — naming the change or path involved. It SHALL never exit 1.

#### Scenario: Unmodified requirement in a delta capability is listed

- **WHEN** a delta spec only ADDs to capability C, and C's existing requirement R names identifiers the change touches
- **THEN** R appears in the second list

#### Scenario: Modified requirement is not listed

- **WHEN** the delta names requirement R under `## MODIFIED`
- **THEN** R does not appear in the second list

#### Scenario: The limit is global and announced

- **WHEN** 3 delta capabilities together have 14 matching unmodified requirements and N is 10
- **THEN** the second list has exactly 10 entries, the highest-scoring overall
- **AND** the output states that 4 were omitted

#### Scenario: Findings do not fail the scan

- **WHEN** both lists are non-empty
- **THEN** the exit code is 0

#### Scenario: Unknown change is a usage error

- **WHEN** the scan is run for a change directory that does not exist
- **THEN** the exit code is 2 and the message names the change

#### Scenario: Output is deterministic

- **WHEN** the scan runs twice on the same inputs
- **THEN** both outputs are identical

#### Scenario: A runtime failure is not a gate verdict

- **WHEN** one main spec file cannot be read
- **THEN** the exit code is 2 and the message names that file

#### Scenario: JSON carries the omitted counts

- **WHEN** the scan runs with JSON output and the first list was capped
- **THEN** the JSON's `t1.omitted` equals the number of capped entries

#### Scenario: Each main spec is read once

- **WHEN** the scan runs over a corpus of 700 capability specs
- **THEN** each spec file is read at most once
