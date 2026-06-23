# cross-session-distillation — delta

## ADDED Requirements

### Requirement: Promote only recurring patterns

The miner SHALL cluster similar candidates across sessions by signature (tool sequence +
error class + file/topic) and SHALL promote a cluster to a written artifact only when it
appears in at least N sessions (default N=3). Clusters below threshold SHALL be held in a
candidates file, not written to a sink, and promoted automatically once a later session
raises the count to N.

#### Scenario: Recurring cluster promoted

- **WHEN** the same fault signature appears in three distinct sessions and N=3
- **THEN** the cluster SHALL be promoted for distillation

#### Scenario: Below-threshold cluster held back

- **WHEN** a candidate signature appears in fewer than three sessions and N=3
- **THEN** it SHALL be held in the candidates file and not written to any sink

### Requirement: Distill with provenance and route to existing sinks

Each promoted cluster SHALL be distilled into a structured artifact carrying provenance
`{sessionIds, model, date, confidence}` and an expiry note for model-limitation
workarounds. Before writing, the miner SHALL query the target sink and merge into an
existing entry when matched, else create. Procedures SHALL route to `skill_manage`;
faults and corrections to the `memory` tool (`failure`); ask_user decisions to `project`
memory (category convention); narrative how-tos to `docs/` followed by `ctx_index`. A
correction that establishes a rule SHALL ALSO patch the relevant AGENTS.md rule, via the
docs subagent in caveman style within the doc protocol's token budget. Each artifact SHALL
carry confidence that decays over time/model change and refreshes on fresh recurrence;
artifacts below the confidence floor SHALL be flagged stale for prune. The miner SHALL
default to dry-run, mutating no sink unless an explicit apply flag is given.

#### Scenario: Dry-run mutates nothing

- **WHEN** the miner runs without the apply flag
- **THEN** it SHALL emit a routing plan and write to no sink

#### Scenario: Re-apply creates no duplicates

- **WHEN** the miner applies over a corpus it already processed
- **THEN** matched artifacts SHALL merge into existing entries and create zero duplicates

#### Scenario: Artifact carries provenance

- **WHEN** an artifact is distilled
- **THEN** it SHALL include sessionIds, model, date, and confidence

#### Scenario: Correction patches AGENTS.md

- **WHEN** a promoted correction establishes a reusable rule
- **THEN** the miner SHALL write a `failure`/correction memory entry
- **AND** SHALL patch the relevant AGENTS.md rule via the docs subagent in caveman style

#### Scenario: Confidence decays without recurrence

- **WHEN** a written artifact is not seen again over time or the model changes
- **THEN** its confidence SHALL decay
- **AND** once below the confidence floor it SHALL be flagged stale for prune
