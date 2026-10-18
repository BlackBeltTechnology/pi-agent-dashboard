## MODIFIED Requirements

### Requirement: The suite is shardable across independent harnesses

The suite SHALL run correctly under Playwright sharding (`--shard=i/N`) where each shard boots and tears down its own harness in managed mode, so the shards share no container, port, or workspace. Each shard SHALL be able to emit a `blob` report, and the repository SHALL document merging shard reports into one HTML report. A spec that requires a harness variant which cannot be the shared default — because enabling it changes behaviour for every other spec, or because it needs a dedicated lifecycle the shared Docker harness does not provide (its own dashboard process, its own identity issuer, or the `pi` CLI on `PATH`) — SHALL run on its own dedicated workflow leg rather than being left skipped in every shard, so no spec's coverage is silently dropped.

Ownership of such a spec SHALL be structural, not environmental: a spec directory owned by a dedicated Playwright configuration SHALL be excluded from the default configuration's test discovery, so the spec cannot both run on its leg and be collected by a shard. Whether a given runner happens to have the required binary installed SHALL NOT determine how many times a spec runs.

#### Scenario: Shards partition the suite
- **WHEN** the suite runs as `--shard=1/4` … `--shard=4/4` on four machines
- **THEN** every spec SHALL run exactly once — in exactly one shard, or on a dedicated variant-harness leg
- **AND** each shard SHALL boot its own container and tear it down

#### Scenario: Merged report covers every shard
- **WHEN** the four blob reports are merged
- **THEN** the merged HTML report SHALL list every spec collected by the default configuration once, with the verdict from its shard or from the browser-relay leg
- **AND** specs owned by a dedicated configuration (team, identity-matrix) SHALL NOT appear in the merged report; each such leg SHALL publish its own HTML report instead

#### Scenario: A config-owned directory is not collected by the default config
- **GIVEN** a spec directory whose specs are run by a dedicated Playwright configuration on its own CI leg
- **WHEN** the default configuration enumerates its tests
- **THEN** that directory's specs SHALL NOT appear in the default configuration's test list
- **AND** installing the binary those specs require on a shard runner SHALL NOT cause them to run a second time
- **AND** specs outside such directories that are gated by their own file-scope skip (e.g. `tests/e2e/browser-relay.spec.ts`) SHALL remain collected by the default configuration

#### Scenario: A spec needing the pi CLI runs on its leg
- **GIVEN** the specs under `tests/e2e/team/` and `tests/e2e/identity-matrix/` (the team specs and `multi-user.spec.ts` require the `pi` CLI to spawn real sessions; the other identity-matrix specs are owned by the same configuration)
- **WHEN** the browser-E2E workflow runs
- **THEN** a dedicated leg SHALL install the `pi` CLI and run each of those configurations
- **AND** every spec in those directories SHALL run on its configuration's leg and in no shard
- **AND** each `pi`-requiring spec SHALL produce a pass or fail verdict, or a `fixme` quarantine carrying a filed issue, rather than a skip for a missing `pi` binary

### Requirement: A dead harness SHALL be reported as such, not as mass test failure

The suite SHALL distinguish "the harness is down" from "this test failed". Before each test body it SHALL probe harness liveness with an explicit health request carrying a 10-second timeout. The harness SHALL be declared down only after **3 consecutive** probe failures, so that a harness merely slow under memory pressure — which is the measured state immediately preceding death — is not misreported as dead.

Once the harness is declared down, the current test SHALL fail with an unmistakable harness-down message naming the harness rather than the test's subject, and every subsequent test in the run SHALL be skipped rather than executed against a dead container. The probe SHALL run before the declaration is consulted, so that a retried test re-probes rather than reporting as skipped.

The harness-down message SHALL additionally state the cause when the harness's lifecycle-event record establishes one. In managed mode the suite knows the harness workspace and SHALL read the events file and the container ID (`containerId`) named in its state file; "this run's harness container" means exactly that container ID, and every match below SHALL be by container ID, never by project name alone (the events file is appended across boots of the same project). When the file holds a `destroy` event for that container ID that is not preceded by a teardown marker carrying the same container ID, the message SHALL say the container was destroyed by a foreign actor, quote the matching event line with its timestamp and acting project, and point to the events file. When no such record exists, the message SHALL say the cause is undetermined rather than asserting one. In attach mode (`PW_E2E_USE_RUNNING=1`) the suite does not own the harness workspace; the message SHALL report the cause as undetermined and SHALL point to the per-project events directory (`${TMPDIR:-/tmp}/pi-dash-test/`) where the booting workspace's recorder writes.

#### Scenario: Daemon death stops the run instead of cascading

- **WHEN** the dashboard daemon dies partway through a run
- **THEN** at most one test beyond the one already executing at the moment of death SHALL fail
- **AND** that failure SHALL identify the harness as down
- **AND** all remaining tests SHALL be reported as skipped, none as product failures

#### Scenario: A slow harness is not declared dead

- **WHEN** the liveness probe fails twice while the harness is under memory pressure and then succeeds
- **THEN** the harness SHALL NOT be declared down
- **AND** the run SHALL continue normally

#### Scenario: A healthy harness is unaffected

- **WHEN** the harness answers liveness probes normally
- **THEN** the probe SHALL not alter test outcomes, ordering, or reporting

#### Scenario: A foreign destroy is named, not guessed

- **GIVEN** a managed run whose events file contains a `destroy` for this run's harness container ID with no preceding teardown marker carrying that container ID
- **AND** the file may contain teardown markers from earlier boots of the same project, carrying other container IDs
- **WHEN** the harness is declared down
- **THEN** the harness-down message SHALL state that the container was destroyed by a foreign actor
- **AND** it SHALL quote the event line (timestamp and acting project) and name the file holding the full record

#### Scenario: Attach mode does not guess

- **GIVEN** a run with `PW_E2E_USE_RUNNING=1`
- **WHEN** the harness is declared down
- **THEN** the message SHALL report the cause as undetermined
- **AND** it SHALL name where the booting workspace keeps the events file

#### Scenario: Cause unknown is reported as unknown

- **GIVEN** a run whose lifecycle-event record contains no destroy event for its container
- **WHEN** the harness is declared down
- **THEN** the message SHALL report the harness as down with the cause undetermined
- **AND** it SHALL NOT attribute the death to a foreign actor
