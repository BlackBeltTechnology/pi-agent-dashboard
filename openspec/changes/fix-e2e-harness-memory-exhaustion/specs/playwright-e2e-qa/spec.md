## ADDED Requirements

### Requirement: A spec SHALL release every session it spawns

The E2E suite SHALL reap dashboard sessions per test, so that live-session memory is bounded by the largest single test rather than by the whole run. After each test body completes — pass or fail — the suite SHALL shut down every session that appeared during that test.

The reap SHALL use the shutdown path that records the session as manually closed (`closedReason:"manual"`) as well as terminating its process. It SHALL NOT use a path that terminates the process while leaving the session's liveness marker set, because such a session remains a cold-start recovery candidate and reappears in the session list, corrupting the very snapshot this requirement depends on.

Reaping SHALL be delta-based: the set of session ids present before the test body is snapshotted, and only ids absent from that snapshot are shut down. The post-body read SHALL settle adaptively before the delta is computed — polling until the session count has been stable for 1 second, capped at 5 seconds — so that a session still registering when the body ended is classified as spawned-during-test rather than becoming permanently invisible to every later snapshot. Sessions the harness created before the run — notably the `PI_E2E_INDEPENDENT_SESSION` pi that `docker/test-entrypoint.sh` launches for the reconnect scenario — SHALL therefore survive untouched.

Reaping SHALL be a default, not an opt-in: it SHALL run automatically for every spec without per-file registration, and a spec that bypasses it SHALL fail a guard test rather than silently leak.

Shutting down a session that is already gone SHALL be treated as success, not as a teardown failure — including a session a spec deliberately ended itself as part of its assertions.

The reap SHALL wait for each shutdown's completion signal, which the server emits only after the session's process has been terminated. A reap that returns before termination would leave dying sessions visible to the next test's snapshot, where they would be misclassified as pre-existing and never reaped.

#### Scenario: Sessions spawned by a test do not outlive it

- **WHEN** a spec spawns one or more sessions and the test body finishes
- **THEN** each spawned session SHALL be shut down before the next test starts
- **AND** the session list SHALL no longer report those session ids
- **AND** the corresponding headless pi processes SHALL no longer be resident in the container

#### Scenario: A reaped session is not a recovery candidate

- **WHEN** a session is reaped and the server subsequently cold-starts
- **THEN** that session SHALL NOT be offered as an interrupted-session recovery candidate
- **AND** it SHALL NOT reappear in the session list as a restored session

#### Scenario: Reaping runs after a failing test too

- **WHEN** a test fails mid-assertion after spawning a session
- **THEN** the spawned session SHALL still be shut down
- **AND** the reported failure SHALL remain the original assertion failure, not a teardown error

#### Scenario: A pre-existing harness session is never reaped

- **WHEN** the harness booted with `PI_E2E_INDEPENDENT_SESSION=1` and a spec runs to completion
- **THEN** the independent (non-dashboard-spawned) session SHALL remain live afterwards
- **AND** the reconnect-after-restart scenario SHALL still find it

#### Scenario: Already-terminated session is tolerated

- **WHEN** a test's session has already exited by the time reaping runs
- **THEN** the not-found outcome SHALL be treated as success
- **AND** the test result SHALL be unchanged

#### Scenario: A spec cannot opt out of reaping by accident

- **WHEN** a spec file under `tests/e2e/` imports `test` directly from the raw Playwright entry point instead of the suite's shared fixture module
- **THEN** a guard test SHALL fail
- **AND** its message SHALL name the offending file and the one-line correction

#### Scenario: Existing per-spec afterEach hooks still observe a live session

- **WHEN** a spec that registers its own `afterEach` state-restoration hook runs
- **THEN** that hook SHALL execute while the session is still live
- **AND** the reap SHALL run after it

#### Scenario: Reap failure never replaces the test's own failure

- **WHEN** the reap cannot reach the harness because the daemon died during the test
- **THEN** the reap error SHALL be reported as a diagnostic
- **AND** the test's reported failure SHALL remain its original assertion failure

### Requirement: Residual live sessions SHALL stay within a declared budget

After reaping, the suite SHALL assert that the number of live sessions is at or below a declared budget, so that sessions the per-test delta cannot see — those registering after the snapshot, those spawned outside a test body, or those an agent spawned — surface at the spec that caused them instead of as a container collapse many specs later.

The budget SHALL be documented as a tripwire on the residual set, distinct from the container's maximum concurrent-session capacity, and SHALL be recorded together with the measured inputs it was derived from. On breach, the failure SHALL name the session ids and cwds that exceeded it.

#### Scenario: Leak surfaces at its origin

- **WHEN** a test leaves sessions live beyond the declared budget after reaping
- **THEN** that test SHALL fail with a message listing the offending session ids and cwds
- **AND** the failure SHALL occur at that test, not at a later unrelated spec

#### Scenario: Budget derivation is recorded

- **WHEN** the budget value is read
- **THEN** it SHALL be accompanied by the measured inputs it derives from (container memory cap, dashboard server RSS, per-session RSS range)
- **AND** it SHALL state that it bounds residual sessions, not peak capacity

### Requirement: A dead harness SHALL be reported as such, not as mass test failure

The suite SHALL distinguish "the harness is down" from "this test failed". Before each test body it SHALL probe harness liveness with an explicit health request carrying a 10-second timeout. The harness SHALL be declared down only after **3 consecutive** probe failures, so that a harness merely slow under memory pressure — which is the measured state immediately preceding death — is not misreported as dead.

Once the harness is declared down, the current test SHALL fail with an unmistakable harness-down message naming the harness rather than the test's subject, and every subsequent test in the run SHALL be skipped rather than executed against a dead container. The probe SHALL run before the declaration is consulted, so that a retried test re-probes rather than reporting as skipped.

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

## MODIFIED Requirements

### Requirement: Spawn round-trip and VCS/terminal/navigation scenarios

The suite SHALL include browser scenario specs that exercise a spawned session.
Specs SHALL select on existing app `data-testid`s and SHALL be idempotent with
respect to shared-container state: a spec SHALL NOT assume a session card left
behind by an earlier spec, and SHALL pin the baked git fixture and spawn when
none is present. Reuse of an existing card is permitted as an optimisation but
SHALL NOT be relied upon, because sessions are reaped per test. A spec SHALL
assert the session-card branch indicator (`git-branch-btn`) for git VCS — not the
worktree-only `composer-git-group`.

#### Scenario: Spawn round-trip renders a session card

- **WHEN** a session is spawned in the baked git fixture
- **THEN** a `session-card-desktop` SHALL become visible, proving the browser↔server↔bridge `/ws` round-trip

#### Scenario: Git VCS indicator renders

- **WHEN** a session is running in the git fixture
- **THEN** the `git-branch-btn` (title "Switch branch") SHALL become visible, proving git status was read from the repo

#### Scenario: Inline terminal mounts a live xterm

- **WHEN** the selected session's `open-inline-terminal-button` is clicked
- **THEN** an xterm pane SHALL mount, exposing its "Terminal input" textarea over the terminal WebSocket

#### Scenario: Settings route mounts without crashing

- **WHEN** the settings view is opened from the dashboard
- **THEN** `settings-content` SHALL be visible
- **AND** no uncaught `pageerror` SHALL have fired during navigation

#### Scenario: A spec starting against an empty container still passes

- **WHEN** a spec runs immediately after a previous spec's sessions were reaped, leaving no session card
- **THEN** the spec SHALL pin the fixture and spawn its own session
- **AND** SHALL reach its assertions without depending on prior shared-container state

### Requirement: Faux-backed model round-trip scenario specs

The suite SHALL include browser scenario specs that send a sentinel prompt
through the UI composer and assert the scripted assistant response renders in the
DOM — proving the `prompt → faux model → bridge → /ws → renderer` round-trip
without an LLM credential. Specs SHALL select on existing app `data-testid`s and
SHALL be idempotent with respect to shared-container state, spawning their own
session rather than relying on one left behind by an earlier spec.

#### Scenario: Plain text round-trip renders

- **WHEN** a spec sends `[[faux:plain-text]]` through the composer of a spawned session
- **THEN** the scripted assistant text (`PLAIN_TEXT_MARKER`) SHALL become visible in the rendered message DOM

#### Scenario: Tool-call renderer round-trip

- **WHEN** a spec sends `[[faux:tool-read]]`
- **THEN** the `read` tool renderer SHALL mount, proving a faux tool-call streamed and rendered

#### Scenario: Interactive ask_user round-trip

- **WHEN** a spec sends `[[faux:ask-select]]`
- **THEN** the interactive select widget SHALL mount, proving a faux `ask_user` tool-call streamed and rendered
