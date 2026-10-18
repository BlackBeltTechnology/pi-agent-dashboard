# playwright-e2e-qa Specification

## Purpose
TBD - created by archiving change add-playwright-e2e. Update Purpose after archive.

## Requirements

### Requirement: Browser-E2E suite lives at tests/e2e and is additive to VM QA
The repository SHALL provide a Playwright browser-E2E suite rooted at `tests/e2e/` with a root `playwright.config.ts` (`testDir: "tests/e2e"`, `baseURL: "http://localhost:18000"`, chromium project). This suite SHALL be additive — it SHALL NOT replace, port, or disable the VM smoke tests under `qa/tests/*.sh,*.ps1`, which retain ownership of clean-install and process-runtime verification across OSes.

The E2E suite SHALL be opt-in via `npm run test:e2e` and SHALL NOT run as part of the vitest unit run (`npm test`).

#### Scenario: E2E suite is separate from unit tests
- **WHEN** a developer runs `npm test`
- **THEN** the vitest unit suite SHALL run AND the Playwright E2E suite SHALL NOT be invoked

#### Scenario: VM QA untouched
- **WHEN** the Playwright suite lands
- **THEN** `qa/tests/*.sh` and `qa/tests/*.ps1` SHALL remain present and unmodified
- **AND** the VM QA Makefile targets SHALL continue to function

### Requirement: Playwright manages the Docker test container lifecycle

Playwright `globalSetup` SHALL spin up the Docker test harness (`docker/test-up.sh`) and wait until `GET <baseURL>/api/health` returns 200 before any spec runs. `globalTeardown` SHALL tear the container down (`docker/test-down.sh`, `compose down -v`), discarding all ephemeral state.

In managed mode, `globalSetup` SHALL NOT pre-pin or `:0`-probe the host ports. It SHALL let `test-up.sh` derive a free port pair within the disjoint windows from the throwaway workspace's `HOST_CWD`, then resolve the chosen ports from the throwaway workspace's `.pi-test-harness.json` state file and propagate them (`PW_E2E_PORT`/`PW_GATEWAY_PORT`) so `baseURL` and worker processes stay in sync with the container. This makes two parallel managed runs (different workspaces) non-colliding without an ephemeral-port race.

When `PW_E2E_USE_RUNNING=1` is set, `globalSetup` SHALL NOT spin up a container; it SHALL only assert that the attach port (`PW_E2E_PORT`, default `:18000`) is already healthy, and `globalTeardown` SHALL NOT tear anything down (the caller owns the container).

#### Scenario: Managed lifecycle (default)
- **WHEN** `npm run test:e2e` runs with `PW_E2E_USE_RUNNING` unset
- **THEN** globalSetup SHALL boot the container via `test-up.sh` WITHOUT exporting a pre-chosen port pair
- **AND** SHALL read the derived ports back from the workspace `.pi-test-harness.json` and set `baseURL` to match
- **AND** SHALL block until `/api/health` → 200 (or fail with a message naming `docker/test-up.sh`)
- **AND** after the run globalTeardown SHALL run `docker/test-down.sh`
- **AND** the host `~/.pi` state SHALL be byte-identical before and after

#### Scenario: Two parallel managed e2e runs do not race on ports

- **WHEN** `npm run test:e2e` runs concurrently in two different worktrees, both managed
- **THEN** each boots from its own throwaway workspace, yielding a distinct in-window port pair and distinct compose project
- **AND** neither run's container fails to publish its host port due to the other
- **AND** each Playwright `baseURL` targets its own container

#### Scenario: Attach to a running container (fast path)
- **WHEN** a developer has already run `docker/test-up.sh` and runs `PW_E2E_USE_RUNNING=1 npm run test:e2e`
- **THEN** globalSetup SHALL skip spin-up and only verify the attach port's health
- **AND** globalTeardown SHALL leave the container running

### Requirement: Smoke spec proves the browser-to-container wiring
The suite SHALL ship at least one smoke spec that opens `baseURL` in a real browser, asserts the dashboard shell renders, and asserts one WebSocket-backed live signal reaches a connected state — proving `/ws` works through the browser, not only via the entrypoint probe.

#### Scenario: Smoke spec renders the shell and connects WS
- **WHEN** the smoke spec navigates to `/`
- **THEN** a stable dashboard root element SHALL be visible
- **AND** a WebSocket-driven connection indicator SHALL reach its connected state without a page reload

### Requirement: PI_E2E_SEED makes the Docker harness provider-ready

The Docker test harness SHALL, when `PI_E2E_SEED=1`, seed credentials and
network trust so browser-driven scenario specs can clear the LandingPage
onboarding gate and reach network-guarded endpoints. The seed SHALL run in
`docker/test-entrypoint.sh` before the base entrypoint, SHALL be a no-op when
the target files already exist, and SHALL default OFF so manual
`docker/test-up.sh` QA stays UI-only. `tests/e2e/global-setup.ts` SHALL set
`PI_E2E_SEED=1` for managed runs and SHALL blank host provider API keys so they
never leak into the disposable container.

The seeded trust boundary is the disposable container, not an address range: the
peer address the container observes for host traffic is not reliably private (a
host running a VPN or secure-DNS layer can present a public address), and a seed
narrower than the observed peer makes every browser request fail the network
guard nondeterministically. The seed SHALL therefore admit any peer by default
and SHALL accept an explicit override, the `PI_E2E_TRUSTED_NETWORKS` environment variable holding a comma-separated CIDR list, naming the networks to admit instead, for
hosts where a narrower list is wanted or where a spec needs a harness booted
narrow.

The same `PI_E2E_SEED` seed SHALL ALSO make the harness drive a key-free faux
model, so UI-spawned sessions can complete a prompt → streamed-events → rendered
DOM round-trip with no LLM credential. The seed SHALL stage the faux fixture as
a global auto-discovered pi extension at
`~/.pi/agent/extensions/faux-provider/index.ts` with its sibling
`faux-scenarios.ts` (subdir form, because the extension imports
`./faux-scenarios.js`), and SHALL seed `defaultModel: "faux/faux-1"` into the pi
config. No `-e` flag and no change to the dashboard spawn argv contract
(`sessionFlagsToArgv`) SHALL be required. Both seeds SHALL be no-ops when the
files already exist and SHALL default OFF.

#### Scenario: Seed clears the onboarding gate

- **WHEN** the container boots with `PI_E2E_SEED=1`
- **THEN** `~/.pi/agent/auth.json` SHALL contain a fake `anthropic` OAuth credential
- **AND** `/api/provider-auth/status` SHALL report `anthropic` `authenticated:true` so `providersReady` is true
- **AND** the LandingPage step-2 ("Add folder") and step-3 ("Start session") CTAs SHALL be enabled

#### Scenario: Seed opens the network guard for the in-container browser

- **WHEN** the container boots with `PI_E2E_SEED=1` and no trusted-network override
- **THEN** the harness config SHALL admit any peer address
- **AND** the browser (non-loopback source IP, possibly a public one on a VPN host) SHALL receive 200 from `/api/browse` so the pin-directory dialog can list directories

#### Scenario: Seed accepts a narrower override

- **WHEN** the container boots with `PI_E2E_SEED=1` and `PI_E2E_TRUSTED_NETWORKS` set to a comma-separated list of CIDRs (e.g. `PI_E2E_TRUSTED_NETWORKS=127.0.0.1/32`)
- **THEN** the seeded `trustedNetworks` in the harness config SHALL equal that list, entries trimmed and empty entries dropped
- **AND** a peer outside them SHALL be refused by the network guard

#### Scenario: An empty override falls back to any peer

- **WHEN** the container boots with `PI_E2E_SEED=1` and `PI_E2E_TRUSTED_NETWORKS` unset or containing no non-empty entry
- **THEN** the seeded `trustedNetworks` SHALL be `["0.0.0.0/0"]`

#### Scenario: Seed stages a key-free faux model

- **WHEN** the container boots with `PI_E2E_SEED=1`
- **THEN** `~/.pi/agent/extensions/faux-provider/index.ts` and its sibling `faux-scenarios.ts` SHALL exist (auto-discovered global extension)
- **AND** the pi config SHALL set `defaultModel` to `faux/faux-1`
- **AND** a session spawned through the dashboard UI SHALL load the faux provider (no "No API provider registered for api: faux") and select `faux/faux-1` with no LLM credential

#### Scenario: Default stays UI-only

- **WHEN** `docker/test-up.sh` runs WITHOUT `PI_E2E_SEED`
- **THEN** no credential, trusted-network, faux-extension, or `defaultModel` seed SHALL be written
- **AND** the harness SHALL remain UI-only

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

### Requirement: Faux fixture routes scenarios per session via prompt sentinel

The faux fixture (`qa/fixtures/faux-provider.ext.ts`) SHALL select its scripted
scenario per prompt from a `[[faux:<scenario-id>]]` sentinel in the latest user
message, looking the id up in the shared `qa/fixtures/faux-scenarios.ts`
catalog. Step selection within a multi-step scenario SHALL be derived from the
count of assistant turns since that user message, so multi-step scenarios (e.g.
`ask-select-roundtrip`) replay in order. When no sentinel is present the fixture
SHALL fall back to the `FAUX_SCRIPT` env scenario, preserving the existing
server-Vitest and VM-smoke behaviour. Per-session isolation SHALL rely on each
session being its own `pi --mode rpc` process (own extension instance + faux
state); no cross-session coordinator SHALL be introduced.

#### Scenario: Sentinel selects the scenario

- **WHEN** a prompt containing `[[faux:tool-read]]` is sent to a faux-backed session
- **THEN** the faux stream SHALL emit the `tool-read` scenario's scripted events

#### Scenario: No sentinel falls back to FAUX_SCRIPT

- **WHEN** a prompt with no `[[faux:…]]` sentinel is sent
- **THEN** the fixture SHALL serve the scenario named by the `FAUX_SCRIPT` env (existing default behaviour), and the existing server-Vitest + `qa/tests/10-faux-model.sh` SHALL remain green

#### Scenario: Concurrent sessions stay independent

- **WHEN** two faux-backed sessions receive prompts with different sentinels
- **THEN** each SHALL stream its own scenario, because each runs in its own pi process with its own faux state

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

### Requirement: Browser availability is verified before the container boots
Playwright `globalSetup` SHALL verify that the Chromium browser binary required by the installed Playwright version is present **before** it spins up or health-checks the Docker test harness. The check SHALL resolve the executable via the `@playwright/test` module (not the `node_modules/.bin/playwright` shim), so a missing bin symlink SHALL NOT block the suite.

When the browser is missing, `globalSetup` SHALL fail fast with a non-zero exit and a message that (a) names the exact remediation command `npx playwright install chromium` and (b) references change `self-heal-host-playwright-browser`. The Docker container SHALL NOT be booted in this case.

#### Scenario: Missing browser fails before container boot
- **WHEN** a developer runs the suite via a direct path (`npx playwright test`, UI mode, or `PW_E2E_USE_RUNNING=1`) and the Chromium binary is absent
- **THEN** globalSetup SHALL exit non-zero within seconds, before `docker/test-up.sh` is spawned
- **AND** the error message SHALL contain `npx playwright install chromium`
- **AND** no Docker container SHALL be started

#### Scenario: Present browser proceeds to lifecycle
- **WHEN** the Chromium binary is present
- **THEN** the preflight SHALL pass silently
- **AND** globalSetup SHALL proceed to the existing managed-boot or `PW_E2E_USE_RUNNING` health-check path unchanged

### Requirement: npm path self-installs the browser
The `package.json` SHALL provide `pretest:e2e` and `pretest:e2e:ui` scripts that run `playwright install chromium`, so the browser is installed automatically before the corresponding `test:e2e` / `test:e2e:ui` scripts run. When the browser is already present the hook SHALL be a fast no-op and SHALL NOT re-download.

The manual `npx playwright install chromium` step in `tests/e2e/README.md` SHALL be demoted from a required prerequisite to a fallback note.

#### Scenario: First run on a fresh host self-heals
- **WHEN** a developer with no installed Chromium runs `npm run test:e2e`
- **THEN** the `pretest:e2e` hook SHALL install Chromium first
- **AND** the suite SHALL then run without a manual prerequisite step

#### Scenario: Warm run does not re-download
- **WHEN** Chromium is already installed and `npm run test:e2e` runs
- **THEN** the `pretest:e2e` hook SHALL complete as a no-op without downloading a browser

### Requirement: Playwright version is pinned for deterministic browser revision
The root `@playwright/test` dependency SHALL be pinned to an exact version (no `^`/`~` range) so the required Chromium revision is deterministic and transitive minor bumps SHALL NOT silently change it or trigger an unrequested browser download. Upgrading Playwright SHALL be an explicit dependency change.

#### Scenario: Transitive bump does not move the browser revision
- **WHEN** dependencies are reinstalled without an explicit Playwright version change
- **THEN** the resolved `@playwright/test` version SHALL be unchanged
- **AND** no new Chromium revision SHALL be required or downloaded

### Requirement: A spec SHALL release every session it spawns

The E2E suite SHALL reap dashboard sessions per test, so that the live-session set is bounded by the largest single test rather than by the whole run. After each test body completes — pass or fail — the suite SHALL shut down every session that appeared during that test.

This requirement governs **release of the session record**. Whether the session's operating-system process actually terminates is a property of the server's shutdown path, not of the suite, and is specified separately — see the `tmux` session-shutdown change. Under `PI_SPAWN_STRATEGY=tmux` the server releases the record without terminating the process, so a suite-level requirement asserting process death would be unsatisfiable no matter how correct the reap is.

The reap SHALL use the shutdown path that records the session as manually closed (`closedReason:"manual"`). It SHALL NOT use a path that leaves the session's liveness marker set, because such a session remains a cold-start recovery candidate and reappears in the session list, corrupting the very snapshot this requirement depends on.

Reaping SHALL be delta-based: the set of session ids present before the test body is snapshotted, and only ids absent from that snapshot are shut down. The post-body read SHALL settle adaptively before the delta is computed — polling until the session count has been stable for 1 second, capped at 5 seconds — so that a session still registering when the body ended is classified as spawned-during-test rather than becoming permanently invisible to every later snapshot. Sessions the harness created before the run — notably the `PI_E2E_INDEPENDENT_SESSION` pi that `docker/test-entrypoint.sh` launches for the reconnect scenario — SHALL therefore survive untouched.

Reaping SHALL be a default, not an opt-in: it SHALL run automatically for every spec without per-file registration, and a spec that bypasses it SHALL fail a guard test rather than silently leak.

Shutting down a session that is already gone SHALL be treated as success, not as a teardown failure — including a session a spec deliberately ended itself as part of its assertions.

The reap SHALL wait for each shutdown's completion signal (`session_removed`) before returning, so that a dying session is not still visible to the next test's snapshot, where it would be misclassified as pre-existing and never reaped. That signal attests that the server has released the record; it does NOT attest that the process exited, because the server broadcasts it unconditionally.

Liveness SHALL be judged by the session's own liveness fields, not by mere presence in the session list. The session list retains a record until the server removes it, so a shut-down session lingers with `live:false`/`status:"ended"`; counting such records as live would make the residual budget fire continuously while the container is healthy, and would make the reap send a redundant shutdown and then block on an acknowledgement that has already been delivered.

#### Scenario: Sessions spawned by a test do not outlive it

- **WHEN** a spec spawns one or more sessions and the test body finishes
- **THEN** each spawned session SHALL be shut down before the next test starts
- **AND** the session list SHALL no longer report those session ids

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

#### Scenario: A closed-but-listed session is not treated as live

- **WHEN** a session has been shut down but its record is still present in the session list with its liveness fields marking it closed
- **THEN** the reap SHALL NOT count it toward the residual budget
- **AND** the reap SHALL NOT issue a second shutdown for it, nor wait for an acknowledgement it has already received

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

The suite SHALL distinguish "the harness is unusable" from "this test failed". Before each test body it SHALL probe harness liveness with an explicit health request carrying a 10-second timeout. The harness SHALL be declared down only after **3 consecutive** probe failures, so that a harness merely slow under memory pressure — which is the measured state immediately preceding death — is not misreported as dead.

The liveness endpoint is a public exception to the harness's network policy and therefore answers normally while the harness refuses every other caller. A harness that is alive but refuses the suite's own credential-free client **by harness policy** is as unusable as a dead one, so the suite SHALL ALSO treat such a refusal as a declaration that the harness is unusable. That declaration SHALL be immediate — a policy refusal is a verdict, not a transient, and SHALL NOT be subject to the 3-strike counter.

The refusal SHALL be observed by the suite's own credential-free connection made before each test body (its pre-test session snapshot); that connection SHALL no longer silently discard an HTTP refusal. A harness-policy refusal is an HTTP 403 whose machine-readable error is one of an explicit list of harness-policy literals — `network_not_allowed` (network guard) and `host_not_allowed` (host gate) — identified from the refusal's status and error fields, never by matching message text. Only a harness-policy refusal SHALL raise the declaration. An HTTP 401, and an HTTP 403 with any other or absent error literal (for example an identity-plane `forbidden`), SHALL NOT raise it; the current test SHALL instead fail with a diagnostic naming the status, the error literal and the reported reason. A transport failure SHALL NOT raise it either, and remains governed by the liveness probe.

Only an *unexpected* refusal is a verdict. The refusal check SHALL be disarmed — a refusal neither raises the declaration nor fails the test, and the test proceeds without its pre-test snapshot as before — in two cases: (a) for the whole run, when the harness's recorded boot baseline does not admit the suite's credential-free client (a harness deliberately booted narrow); and (b) for any test that runs while a narrowing declared through the suite's narrowing mechanism is active, including one declared before the test at describe scope. In case (b) the pre-test credential-free connection SHALL be skipped with a note naming the declaring spec.

Once the harness is declared unusable — dead or refusing — the current test SHALL fail with an unmistakable message naming the harness rather than the test's subject, and every subsequent test in the run SHALL be skipped rather than executed against it. A refusal declaration's message SHALL carry the status and the refusal reason the harness reported, so the run names its own cause without log mining. For a harness-down declaration the probe SHALL run before the declaration is consulted, so that a retried test re-probes rather than reporting as skipped. A refusal declaration is sticky for the rest of the run: it is not re-evaluated by a later probe or connection, so a retry of the test that observed the refusal, and every later test, SHALL be reported as skipped.

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

#### Scenario: A refusing harness stops the run instead of timing out every spec

- **WHEN** the harness answers the liveness probe successfully but refuses the suite's pre-test connection with HTTP 403 and error `network_not_allowed`
- **THEN** the harness SHALL be declared unusable on that first refusal
- **AND** the current test SHALL fail with a message naming the harness, the refusal status and the reported reason
- **AND** every remaining test SHALL be skipped rather than run to its own timeout

#### Scenario: A retried test after a refusal declaration is skipped

- **WHEN** the harness has been declared unusable by a harness-policy refusal and the test that observed it is retried
- **THEN** the retry SHALL be reported as skipped
- **AND** the refusal declaration SHALL NOT be cleared by the retry

#### Scenario: A declared describe-scope narrowing does not stop the run

- **WHEN** a spec narrows harness trust through the suite's narrowing mechanism before its first test (describe scope), so the suite's credential-free client would be refused
- **THEN** the pre-test connection for that spec's tests SHALL be skipped with a note naming the spec
- **AND** the harness SHALL NOT be declared unusable and those tests SHALL run

#### Scenario: A harness booted narrow does not stop the run

- **WHEN** the run targets a harness whose recorded boot baseline refuses the suite's credential-free client
- **THEN** a refusal at the pre-test connection SHALL NOT declare the harness unusable and SHALL NOT fail the test

#### Scenario: A host-gate refusal also stops the run

- **WHEN** the suite's pre-test connection is refused with HTTP 403 and error `host_not_allowed`
- **THEN** the harness SHALL be declared unusable on that first refusal

#### Scenario: An authentication refusal is not a harness verdict

- **WHEN** the suite's pre-test connection is refused with HTTP 401
- **THEN** the suite SHALL NOT declare the harness unusable
- **AND** the current test SHALL fail with a diagnostic naming the status

#### Scenario: An unknown 403 is not a harness verdict

- **WHEN** the suite's pre-test connection is refused with HTTP 403 and an error literal outside the harness-policy list (for example `forbidden`) or none
- **THEN** the suite SHALL NOT declare the harness unusable
- **AND** the current test SHALL fail with a diagnostic naming the status and the error literal, if any

#### Scenario: A transport error is not a refusal

- **WHEN** the suite's client cannot reach the harness at all (connection refused, DNS failure, timeout)
- **THEN** the suite SHALL NOT declare a policy refusal
- **AND** the liveness probe and its 3-strike counter SHALL remain the only path to a harness-down declaration

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

### Requirement: A full suite run is not bounded by a committed wall-clock budget

The committed Playwright configuration SHALL NOT set a global wall-clock timeout for the run. A plain `npm run test:e2e` SHALL be able to reach its final spec regardless of suite size; per-test and per-expectation timeouts, plus the harness-down short-circuit, remain the bounds on a pathological run. A caller that wants a wall-clock budget SHALL supply it on the command line (`--global-timeout`), and the CI job SHALL supply it as the job's own time limit.

#### Scenario: A full local run completes
- **WHEN** `npm run test:e2e` runs the entire suite against one healthy harness
- **THEN** the run SHALL terminate with a verdict for every spec, not a global-timeout abort

#### Scenario: A wedged harness still terminates the run
- **WHEN** the harness dies mid-run with no global timeout configured
- **THEN** the harness-down short-circuit SHALL skip the remaining specs and the run SHALL end

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

### Requirement: A red spec with a filed product bug is quarantined, not left red

A spec that fails because of a product defect (not spec drift) SHALL be marked with Playwright's `fixme` annotation carrying the tracking issue URL, so the baseline reports the gap as a known, linked skip rather than a failure. Spec drift SHALL be fixed in the spec. A `fixme` without an issue reference SHALL fail a repo-lint guard. A file-level (top-level, outside any test or describe body) conditional `test.skip` removes a whole spec file from every shard, so the same repo-lint guard SHALL require its reason to carry an issue URL or the exact job id of a CI leg that runs specs; a job that runs no specs (e.g. a report-merge job) and a Playwright config name SHALL NOT satisfy the rule. Indented conditional `test.skip` calls (inside a test, describe or helper body; runtime guards) SHALL NOT be subject to this rule.

#### Scenario: Quarantined spec reports as fixme with a link
- **WHEN** a spec is annotated `test.fixme(true, "https://github.com/…/issues/<n>")`
- **THEN** the run SHALL report it as skipped-fixme carrying that URL, not as failed

#### Scenario: Unlinked fixme is refused
- **WHEN** a spec carries `test.fixme(` without an `issues/<n>` URL in its reason
- **THEN** the repo-lint test SHALL fail naming the spec

#### Scenario: Unattributed file-level skip is refused
- **WHEN** a spec file carries a top-level `test.skip(<condition>, "<reason>")` whose reason names neither an `issues/<n>` URL nor a CI leg
- **THEN** the repo-lint test SHALL fail naming the spec file

#### Scenario: File-level skip naming its CI leg is accepted
- **WHEN** a spec file's top-level conditional `test.skip` reason names the CI leg that runs it (e.g. `e2e-browser-relay`)
- **THEN** the repo-lint test SHALL pass

#### Scenario: A non-spec job or a config name does not satisfy the rule
- **WHEN** a top-level conditional `test.skip` reason names only `merge-report` or only `playwright.team.config.ts`
- **THEN** the repo-lint test SHALL fail naming the spec file

#### Scenario: A CI job id only matches as a whole token
- **WHEN** a top-level conditional `test.skip` reason mentions `e2e` only as part of other text (e.g. "e2e flake") or a near-miss id (e.g. `e2e-browser-relax`)
- **THEN** the repo-lint test SHALL fail naming the spec file

#### Scenario: In-test runtime guard is not subject to the rule
- **WHEN** `test.skip(!port, "harness health does not expose the bound gateway port")` appears indented inside a test or helper body
- **THEN** the repo-lint test SHALL NOT flag it

### Requirement: A spec SHALL NOT leave harness-global configuration narrowed for later specs

Specs share one harness, and some must narrow harness-global configuration to assert a refusal or to exercise an authenticated path. Narrowing it is permitted; leaving it narrowed is not, because the next spec, the suite's own session-reap client, and the browser all lose access with no path back.

The configuration this requirement governs is the trust-bearing set — every key that changes who the harness admits: the network-trust list that admits credential-free callers, the host list unioned into it, the URL-prefix list that bypasses authentication, the host gate's admitted-host list and mode, and the strict-local-proof switch.

A spec that changes any of them — by direct write or through the UI — SHALL do so through the suite's narrowing mechanism, which records the prior values and registers the narrowing as active until restored. A test-scope narrowing's restoration SHALL run even when the test fails or times out, and SHALL complete before the suite's own post-test session release and before the post-test verification, by construction rather than by reliance on fixture teardown order. A narrowing that must span several tests of one serial group MAY be declared at describe scope through the same mechanism; its restoration runs when the group ends, and the worker-start re-assert below covers a worker killed before then. Because the suite's credential-free client is refused during such a group, sessions spawned by its tests SHALL be released when the group's narrowing is restored, before the next group's first test — a stated exception to per-test session release, limited to declared describe-scope narrowings. Restoration in a spec's own ad-hoc hook, outside the mechanism, SHALL NOT satisfy this requirement. A repository check SHALL fail when a spec writes a trust-bearing key outside the mechanism; every existing such write SHALL be migrated.

Teardown cannot cover a worker killed without warning (out-of-memory, signal, job cancellation), which is the observed failure mode. The suite SHALL therefore record the harness's own trust-bearing configuration once, after the harness boots and before any spec runs, and SHALL re-assert that recorded baseline once per worker, before that worker's first test, idempotently — so that a worker started after a predecessor was killed mid-narrowing restores the harness instead of inheriting it narrowed. Recording the baseline includes one credential-free admission check; if that check gets no HTTP answer at all (connection refused, timeout), the suite SHALL retry it within the existing harness readiness wait and, if it still gets no answer, SHALL abort the run before any spec with a message naming the failure — it SHALL NOT record the client as not admitted, which would silently disarm the refusal check. The re-assert SHALL restore the recorded baseline, never a fixed wide seed, so a harness deliberately booted narrow stays narrow. A cancelled run as a whole is out of scope: no later spec survives it.

Restoration and verification SHALL use an operator credential the suite holds, not the credential-free client, because the narrowed state is precisely the state in which the credential-free client is refused. That credential exists only when the harness has authentication configured. On a harness without it, a spec that attempts a runtime narrowing SHALL fail with a message stating that it must run on a harness booted narrow for it. If the credential exists but the harness rejects it, the suite SHALL declare the harness unusable at worker start, naming the rejection, rather than run without isolation.

After each test, the suite SHALL verify that the trust-bearing configuration is as it was before the test, and SHALL fail the test that left it changed, naming the spec and the observed difference. Every comparison of trust-bearing values SHALL first fill each key's default — an absent list-valued key equals an empty list — and SHALL then require an exact, order-sensitive match: a list holding the same entries in a different order is a difference. Before each test that runs with no active declared narrowing, the configuration SHALL equal the recorded boot baseline; a difference SHALL be re-asserted from the baseline and SHALL fail that test naming the last spec that declared a narrowing.

A spec that cannot restore the harness — because the narrowed state removes its own means of writing the configuration back — SHALL NOT run on the shared harness at all; it SHALL run against a harness booted narrow for it, and SHALL document that requirement in the spec file.

#### Scenario: A timed-out spec still restores the harness

- **WHEN** a spec narrows harness-global trust-bearing configuration and its test then times out mid-body
- **THEN** the narrowed configuration SHALL be restored before the next spec starts
- **AND** the next spec SHALL reach the harness normally

#### Scenario: A killed worker does not poison its successor

- **WHEN** a worker is killed while a spec holds a narrowed harness, so no teardown runs
- **THEN** the next worker SHALL re-assert the recorded boot baseline of the trust-bearing configuration before running its first test
- **AND** the specs that worker runs SHALL reach the harness normally

#### Scenario: A leaked narrowing is attributed to its own spec

- **WHEN** a spec ends with trust-bearing configuration different from the value observed before that test
- **THEN** that test SHALL fail with a message naming the spec and the difference
- **AND** later specs SHALL NOT be the first place the failure appears

#### Scenario: A describe-scope narrowing is not reported as a breach by its own tests

- **WHEN** a serial group declares a narrowing at describe scope and its tests run
- **THEN** the post-test verification of those tests SHALL NOT report a difference
- **AND** after the group ends the configuration SHALL equal the recorded boot baseline before the next test

#### Scenario: An absent list key equals an empty list, order is significant

- **WHEN** a trust-bearing list-valued key is absent before a test and an empty list after it
- **THEN** the post-test verification SHALL NOT report a difference
- **AND** when a list holds the same entries in a different order after the test, the verification SHALL report a difference

#### Scenario: A baseline admission check with no answer aborts the run

- **WHEN** the credential-free admission check made while recording the boot baseline gets no HTTP answer and still gets none at the end of the harness readiness wait
- **THEN** the run SHALL abort before any spec, naming the failure
- **AND** the baseline SHALL NOT record the credential-free client as not admitted

#### Scenario: A harness booted narrow is not widened

- **WHEN** the harness is booted with a narrow trusted-network list and a worker starts
- **THEN** the worker-start re-assert SHALL leave that narrow list unchanged

#### Scenario: Narrowing without a credential fails loudly

- **WHEN** a spec attempts a runtime narrowing on a harness that has no authentication configured
- **THEN** that spec SHALL fail with a message stating it must run on a harness booted narrow for it
- **AND** the shared harness configuration SHALL NOT be changed

#### Scenario: A rejected credential stops the run

- **WHEN** the suite's operator credential is refused by the harness at worker start
- **THEN** the harness SHALL be declared unusable with a message naming the rejection status

#### Scenario: A correctly restoring spec is not reported as a breach

- **WHEN** a spec narrows the configuration and its declared restoration runs
- **THEN** the post-test verification SHALL observe the restored value
- **AND** the spec's own sessions SHALL be released against the restored harness

#### Scenario: Verification works while the harness is narrowed

- **WHEN** the suite reads or writes the trust-bearing configuration while the harness admits only authenticated callers
- **THEN** it SHALL use a credential the suite holds
- **AND** a refusal of the credential-free client SHALL NOT be mistaken for a configuration difference

#### Scenario: An unrestorable spec is not run on the shared harness

- **WHEN** a spec's assertions require a narrowed harness it cannot write back
- **THEN** that spec SHALL be run against a harness booted narrow for it
- **AND** it SHALL state that requirement in the spec file rather than mutating the shared harness
