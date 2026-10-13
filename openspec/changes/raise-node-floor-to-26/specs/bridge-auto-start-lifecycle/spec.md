## MODIFIED Requirements

### Requirement: Auto-start skips and refusals are loud and greppable

Whenever the auto-start path does NOT launch — because a dashboard already
answers on the resolved port, the endpoint is pinned, the worktree refusal
fires, or the resolved port is occupied by another service, or no Node satisfying the server engines range was resolved — the durable
auto-start log (`appendAutoStartLog`) SHALL gain a line naming the ports
involved. When the resolved port serves, auto-start SHALL return it without
consulting discovery, and SHALL NOT emit any port-mismatch record or warning.
A port-mismatch record SHALL arise only on the path where the resolved port was
probed, found silent, and discovery then yielded a verified candidate; that
record SHALL name both ports and raise a warning notification. A line SHALL NOT
assert that the resolved port is silent unless that has been established by a
probe. The post-launch attach path SHALL NOT raise a "resolved port silent"
warning on a transient health miss after a successful launch. Every such line
SHALL be greppable in the server log.

#### Scenario: Attaching to an already-serving dashboard logs the port
- **GIVEN** a dashboard already serving on the resolved port
- **WHEN** auto-start attaches without launching
- **THEN** the auto-start log names the port it attached to
- **AND** records that no launch happened

#### Scenario: Discovery elsewhere while the resolved port is silent warns both ports
- **GIVEN** discovery finds a dashboard serving at port 18697
- **AND** the resolved port 8000 has been probed and answers nothing
- **WHEN** auto-start decides what to do
- **THEN** a warning names both 8000 and 18697
- **AND** no launch happens

#### Scenario: Resolved port serves — discovery is not consulted and nothing is recorded
- **GIVEN** the resolved port 8000 answers `/api/health`
- **WHEN** auto-start decides what to do
- **THEN** the resolved port 8000 SHALL be returned without consulting discovery
- **AND** no port-mismatch record and no warning or toast SHALL be produced

#### Scenario: Transient post-launch health miss raises no silent warning
- **GIVEN** auto-start has successfully launched a server on the resolved port
- **AND** the immediate post-launch health probe misses transiently
- **WHEN** the post-launch attach path evaluates what to return
- **THEN** no "resolved port silent" warning SHALL be raised
- **AND** the resolved port SHALL be preferred once its bootstrap-aware probe answers

#### Scenario: Two servers in one container is detectable end to end
- **GIVEN** the e2e harness container
- **WHEN** its startup completes and a spec spawns a session
- **THEN** exactly one dashboard SHALL answer `/api/health` inside the
  container
- **AND** `tests/e2e/faux-text.spec.ts` SHALL pass, as the canary any other
  E2E verdict depends on

#### Scenario: No qualifying Node is logged
- **GIVEN** no dashboard answers on the resolved port
- **AND** server-spawn runtime resolution returns unresolved
- **WHEN** auto-start runs
- **THEN** the launch step is not invoked
- **AND** the durable auto-start log gains one line naming the resolved port, the required Node range and every skipped candidate with its reason
