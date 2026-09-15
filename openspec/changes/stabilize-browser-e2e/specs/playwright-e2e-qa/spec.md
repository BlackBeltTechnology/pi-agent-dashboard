## ADDED Requirements

### Requirement: A full suite run is not bounded by a committed wall-clock budget

The committed Playwright configuration SHALL NOT set a global wall-clock timeout for the run. A plain `npm run test:e2e` SHALL be able to reach its final spec regardless of suite size; per-test and per-expectation timeouts, plus the harness-down short-circuit, remain the bounds on a pathological run. A caller that wants a wall-clock budget SHALL supply it on the command line (`--global-timeout`), and the CI job SHALL supply it as the job's own time limit.

#### Scenario: A full local run completes
- **WHEN** `npm run test:e2e` runs the entire suite against one healthy harness
- **THEN** the run SHALL terminate with a verdict for every spec, not a global-timeout abort

#### Scenario: A wedged harness still terminates the run
- **WHEN** the harness dies mid-run with no global timeout configured
- **THEN** the harness-down short-circuit SHALL skip the remaining specs and the run SHALL end

### Requirement: The suite is shardable across independent harnesses

The suite SHALL run correctly under Playwright sharding (`--shard=i/N`) where each shard boots and tears down its own harness in managed mode, so the shards share no container, port, or workspace. Each shard SHALL be able to emit a `blob` report, and the repository SHALL document merging shard reports into one HTML report.

#### Scenario: Shards partition the suite
- **WHEN** the suite runs as `--shard=1/4` … `--shard=4/4` on four machines
- **THEN** every spec SHALL run in exactly one shard
- **AND** each shard SHALL boot its own container and tear it down

#### Scenario: Merged report covers every shard
- **WHEN** the four blob reports are merged
- **THEN** the merged HTML report SHALL list every spec once with its shard's verdict

### Requirement: A red spec with a filed product bug is quarantined, not left red

A spec that fails because of a product defect (not spec drift) SHALL be marked with Playwright's `fixme` annotation carrying the tracking issue URL, so the baseline reports the gap as a known, linked skip rather than a failure. Spec drift SHALL be fixed in the spec. A `fixme` without an issue reference SHALL fail a repo-lint guard.

#### Scenario: Quarantined spec reports as fixme with a link
- **WHEN** a spec is annotated `test.fixme(true, "https://github.com/…/issues/<n>")`
- **THEN** the run SHALL report it as skipped-fixme carrying that URL, not as failed

#### Scenario: Unlinked fixme is refused
- **WHEN** a spec carries `test.fixme(` without an `issues/<n>` URL in its reason
- **THEN** the repo-lint test SHALL fail naming the spec
