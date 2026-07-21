# hermes-memory-distillation — delta

## ADDED Requirements

### Requirement: Distillation gate — two hard structural gates plus an advisory signal
An entry SHALL be distilled out of Hermes into a committed skill sidecar ONLY when it
passes BOTH hard gates: (1) **Shareability** — `target ≠ user` AND a secret/PII/absolute-
path scrub returns clean; and (2) **Maturity** — the entry is *settled*: `now -
last_referenced ≥ T_age`. Because the store bumps `last_referenced` on write/replace and
NEVER on read, maturity SHALL be interpreted as "not recently edited," not "used."
Reference-count SHALL NOT be used in v1. The "project-technical" judgment SHALL be advisory
(informing human approval) and SHALL NOT act as an automated gate. `T_age` SHALL default to
14 days and the classifier auto-drop cutoff to confidence 0.7, both config-tunable. Failing either hard
gate SHALL leave the entry untouched in Hermes.

#### Scenario: Recently-edited entry is not distilled (T_age boundary)
- **WHEN** a candidate entry's `last_referenced` is 13 days ago (inside the 14-day window)
- **THEN** the pass SHALL NOT author it into any skill sidecar
- **AND** an otherwise-identical entry last edited 15 days ago SHALL be eligible

#### Scenario: Scrub failure is a hard no-move
- **WHEN** a candidate entry contains a secret/token/PII/absolute-local-path the scrub cannot remove
- **THEN** the pass SHALL NOT write it to a committed file (no best-effort partial write)
- **AND** the entry SHALL remain in Hermes unchanged

#### Scenario: Settled, scrub-clean, non-user entry is eligible
- **WHEN** a candidate entry is `target ∈ {memory, failure}`, older than `T_age`, and scrub-clean
- **THEN** the entry SHALL be eligible for authoring into its routed host skill's sidecar

### Requirement: Human-confirmed subagent classification
The pass SHALL classify candidate entries to a host skill via subagent fan-out and SHALL
NOT move any entry out of Hermes before a human approves the routing table. Ambiguous or
low-confidence routes SHALL default to no-move.

#### Scenario: Classifier proposes, human approves
- **WHEN** the classifier emits a routing table `{entryId → hostSkill, confidence}`
- **THEN** no `memory(action:remove)` SHALL run until the routing table is approved

#### Scenario: Low-confidence route auto-drops (0.7 boundary)
- **WHEN** the classifier routes an entry with confidence 0.69
- **THEN** the entry SHALL be auto-dropped (no-move, stays in Hermes) without reaching the human table
- **AND** an entry routed at confidence 0.71 SHALL be surfaced in the approval table

### Requirement: Id-safe author-then-remove via the memory tool
The pass SHALL author (and verify) the sidecar write BEFORE removing the entry from
Hermes, and SHALL remove exclusively through the `memory` tool API — never a raw SQLite
DELETE. Because the tool matches by substring + target + project (not row id), removal
SHALL pass the entry's exact stored bytes as `old_text` and SHALL confirm exactly one row
was removed via a **row-count check** (pre/post diff or the sync's matched/removed count),
NOT the tool's `success` flag alone — a `failure`-target removal can match multiple
distinct-scoped copies and still report success.

#### Scenario: Crash between author and remove leaves no loss
- **WHEN** the pass authors a lesson into a sidecar and crashes before the Hermes remove
- **THEN** the entry SHALL still exist in Hermes (a recoverable duplicate, never a loss)

#### Scenario: Over-delete risk aborts the move
- **WHEN** the row-count check shows the `memory(action:remove)` call matched more than one row (shared substring, incl. distinct-scoped `failure` copies) or zero rows (reworded/missing)
- **THEN** the pass SHALL abort the move-out for that entry and flag it for manual handling
- **AND** no partial or sibling removal SHALL occur

#### Scenario: Removal preserves store sync
- **WHEN** an approved, authored entry is moved out and matches exactly one row
- **THEN** removal SHALL call `memory(action:remove)` with the exact stored bytes so the SQLite/MD single-owner sync stays consistent
- **AND** no direct DELETE on `sessions.db` SHALL occur

### Requirement: Host-skill trigger tuning with a config-conditional backstop
When a lesson is authored into a host skill, the pass SHALL ensure the host skill's
`description` NL triggers cover the lesson's situation, so the distilled lesson loads when
its phase is active. The `kb_search` off-phase backstop applies ONLY when `.pi` is a
configured kb source (it is in kb's `DEFAULT_EXCLUDE`); the pass SHALL verify this and warn
when `.pi` is absent from `knowledge_base.json` sources.

#### Scenario: Lesson's situation is added to triggers
- **WHEN** a lesson is authored into a host skill whose `description` does not cover the lesson's trigger situation
- **THEN** the pass SHALL propose an updated `description` that includes that situation

#### Scenario: Missing kb source is surfaced
- **WHEN** the current repo's `knowledge_base.json` does not list `.pi` as a source
- **THEN** the pass SHALL warn that distilled lessons will not be `kb_search`-retrievable off-phase

### Requirement: Cross-dedup against existing sidecar entries
Before authoring, the pass SHALL check the target `references/lessons.md` for an existing
equivalent entry — regardless of whether this pass or `distill-session-knowledge` authored
it — and SHALL skip authoring a duplicate.

#### Scenario: Near-match lesson from another distiller is not re-authored
- **WHEN** the target sidecar already holds a lesson whose normalized-content similarity to the candidate is ≥ 0.85 (authored by any distiller)
- **THEN** the pass SHALL NOT append a second copy
- **AND** the source Hermes entry MAY still be moved out (its knowledge is already captured)

### Requirement: Scope equals the session projectName; excludes personal and global entries
Candidate selection SHALL include ONLY `memory`/`failure` entries whose `project` equals
the current session's registered `projectName` — the same value the `memory` remove tool
scopes to — so removal can always target the row and no cross-project removal is attempted.
It SHALL exclude every `target = user` entry AND every `project IS NULL` (global) entry.

#### Scenario: Cross-project entries are never candidates
- **WHEN** an entry's `project` differs from the session's registered `projectName`
- **THEN** it SHALL NOT be a candidate (its removal could not be scoped and would miss)

#### Scenario: A worktree session distills only its own project
- **WHEN** the pass runs in a worktree whose `projectName` is `os-<change>`
- **THEN** candidates SHALL be limited to `project = os-<change>` entries
- **AND** the shared skill sidecars it writes remain available to every checkout of the repo

#### Scenario: Global entries are never candidates
- **WHEN** an entry has `project IS NULL` (a deliberately cross-project memory)
- **THEN** it SHALL NOT be distilled into any single project's skill

#### Scenario: User-target entries are never candidates
- **WHEN** an entry has `target = user`
- **THEN** it SHALL NOT appear in the candidate set regardless of maturity or content
