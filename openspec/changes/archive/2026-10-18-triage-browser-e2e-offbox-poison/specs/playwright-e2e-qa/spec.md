## MODIFIED Requirements

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

## ADDED Requirements

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
