# RLM Delegation Experiment

## ADDED Requirements

### Requirement: Pre-registered decision rule

The experiment SHALL commit its stop/go thresholds before any run executes, so a
directional N=5 result cannot be reinterpreted after the fact.

#### Scenario: Screen shows no lift

- **WHEN** the Stage 1 screen completes and arm B's pass rate is within ±10
  percentage points of arm A
- **THEN** the experiment records a null result and stops
- **AND** no Stage 2 confirmation run is started
- **AND** the RLM kernel port is recorded as unjustified by this evidence

#### Scenario: Screen shows lift

- **WHEN** arm B's pass rate is at least 10 percentage points above arm A
- **THEN** a Stage 2 confirmation run at N=15 is started on the same battery

#### Scenario: Tips arm dominates

- **WHEN** arm C's pass rate exceeds arm B's
- **THEN** the RLM thread is closed
- **AND** a separate change is opened for AGENTS.md quality

### Requirement: Battery validity gates

Every replayed-commit task SHALL be proven to discriminate before budget is spent
on it.

#### Scenario: Task is validated before use

- **WHEN** a task is added to `tasks.rlm.jsonl`
- **THEN** its `verify` command fails at `<commit>^`
- **AND** its `verify` command passes with the commit's real implementation applied
- **AND** a task failing either check is removed from the battery

#### Scenario: Worktree state is reset between runs

- **WHEN** a run completes for any arm
- **THEN** the worktree is restored with `git reset --hard HEAD` and `git clean -fd`
- **AND** a subsequent grep of the implementation file shows no residue from the prior run

### Requirement: Arm isolation

Arms SHALL differ only by the injected doctrine block, so any measured delta is
attributable to the treatment.

#### Scenario: Arm diff is asserted before running

- **WHEN** the experiment starts
- **THEN** each arm worktree's diff against HEAD is limited to the AGENTS.md doctrine block
- **AND** the run aborts if any other file differs

### Requirement: Capability-floor reporting

Results SHALL be reported per model, so a weak-model regression cannot be
averaged away into a false positive or negative.

#### Scenario: Floor probe inverts the frontier result

- **WHEN** the frontier model shows lift and the floor probe shows regression
- **THEN** the report records that delegation-first must not become unconditional doctrine
- **AND** the recommendation is scoped to models at or above the frontier tier

#### Scenario: Long and short buckets are reported separately

- **WHEN** the report is generated
- **THEN** pass rate is broken out for the long-context and short-context buckets
- **AND** an aggregate-only verdict is not emitted
