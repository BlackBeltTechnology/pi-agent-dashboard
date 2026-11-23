## MODIFIED Requirements

### Requirement: Selection is computed from a base ref and yields a mode, a reason, and shard assignments
The selector SHALL take a git base ref and the checked-out tree. It SHALL collect test files from the root vitest config **and** the real-process config. It SHALL NOT set `RUN_BUDGET_TESTS`, so those configs do not collect budget files. It SHALL produce:
- a mode, `full` or `affected`;
- a human-readable reason;
- the selected test files, split into the parallel phase and the real-process phase;
- the parallel-phase files assigned to a fixed number of shards;
- a flag for whether the packaging scenarios are required;
- the budget-lane files: every git-tracked budget file, that is a `*.budget.test.*` name ending in a JavaScript or TypeScript extension (a snapshot or other non-code file is not one), found by a filename scan, in every mode.

Budget-lane files SHALL NOT be assigned to a unit shard, the real-process set or the packaging-scenario set. Only the nightly budget job consumes the budget-lane list. The budget-lane list SHALL NOT depend on vitest enumeration, so it is the same when the selector cannot enumerate tests.

The diff SHALL be computed without rename detection, so that both the old and new path of a rename, and every deleted path, count as changed. Given the same tree, the same frozen-lockfile install, and the same base ref, the output SHALL be identical.

#### Scenario: Deterministic output
- **WHEN** the selector runs twice on the same tree and install against the same base ref
- **THEN** both runs SHALL produce identical mode, reason, file sets and shard assignments

#### Scenario: Real-process files are routed to their own phase
- **WHEN** a diff touches a module reached by `packages/server/src/rpc-keeper/__tests__/keeper.test.ts`, a real-process test collected only by the real-process config
- **THEN** that file SHALL be listed in the real-process set and in no parallel shard

#### Scenario: Budget files never land in a shard
- **WHEN** another layer selects `packages/kb-plugin/src/server/__tests__/kb-search-perf.budget.test.ts`, or the mode is `full`
- **THEN** that file SHALL be in no unit shard, no real-process set and no packaging-scenario list
- **AND** it SHALL be listed in the budget-lane files

#### Scenario: Budget files are listed without enumeration
- **WHEN** the selector falls back to a full run because it could not enumerate tests
- **THEN** the budget-lane list SHALL still name every tracked budget file

#### Scenario: Rename counts both sides
- **WHEN** the diff renames `packages/p/src/a.ts` to `packages/p/src/b.ts`
- **THEN** both paths SHALL be treated as changed

### Requirement: Every shard proves it ran what it was assigned
Each unit shard, the real-process job, the packaging-scenarios job, and the nightly budget job SHALL compare the test files its vitest run actually executed against the files the selector assigned to it. It SHALL fail when any assigned file did not execute. The budget job SHALL also fail when an assigned file reports no executed case or any skipped case, so that an environment gate cannot turn a budget file into a silent pass. A shard with no assigned files SHALL skip vitest and succeed. The budget job SHALL instead run vitest also when no file is assigned to it, so that it always uploads a report and an empty lane is green.

#### Scenario: Path mismatch is caught
- **WHEN** an assigned file does not match vitest's collected file (e.g. a path-form mismatch)
- **THEN** the shard SHALL fail naming the unexecuted file

#### Scenario: Empty shard
- **WHEN** the selector assigns no files to a shard
- **THEN** that shard SHALL run no vitest and SHALL succeed

#### Scenario: An empty budget lane is green
- **WHEN** the selector lists no budget-lane files
- **THEN** the nightly budget job SHALL succeed and upload its report
- **AND** the nightly report SHALL NOT list the budget job as having no report

#### Scenario: A skipped budget case fails the budget job
- **WHEN** the blender budget file runs in the budget job and its cases skip because the real Blender runtime is unavailable
- **THEN** the budget job SHALL fail naming that file
