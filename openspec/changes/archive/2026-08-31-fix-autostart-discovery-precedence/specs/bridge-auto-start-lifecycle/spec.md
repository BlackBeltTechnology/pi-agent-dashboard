# bridge-auto-start-lifecycle — delta

## ADDED Requirements

### Requirement: The resolved port's status is established before discovery can win

Auto-start SHALL determine whether the resolved port is serving BEFORE a
discovered candidate may be adopted, in BOTH the pre-launch discovery path and
the post-launch attach path. A discovered dashboard SHALL NOT be returned while
the resolved port answers `GET /api/health`. The resolved-port probe SHALL use
bootstrap-aware settings (a non-default timeout and at least one retry) so a
server that is mid-startup is not misread as silent.

#### Scenario: Resolved port serves and pre-launch discovery finds another
- **GIVEN** the resolved port 8000 answers `/api/health`
- **AND** discovery finds a local dashboard on port 8588
- **WHEN** auto-start decides what to do
- **THEN** the resolved port 8000 SHALL be returned
- **AND** no launch happens

#### Scenario: Resolved port is silent and pre-launch discovery finds another
- **GIVEN** the resolved port 8000 answers nothing after the bootstrap-aware probe
- **AND** discovery finds a local dashboard on port 8588 that answers `/api/health`
- **WHEN** auto-start decides what to do
- **THEN** port 8588 SHALL be returned
- **AND** no launch happens

#### Scenario: Post-launch attach does not adopt a foreign advertiser over the just-launched server
- **GIVEN** auto-start has successfully launched a server on the resolved port 8000
- **AND** the resolved port 8000 answers `/api/health`
- **AND** discovery during the post-launch attach window also finds a local dashboard on port 8588
- **WHEN** auto-start resolves the address to connect to
- **THEN** the resolved port 8000 SHALL be returned
- **AND** the choice SHALL NOT depend on which advertisement arrived first

#### Scenario: Bootstrap-aware probe does not misread a mid-startup server as silent
- **GIVEN** the resolved port's server is mid-startup and its first health probe times out
- **AND** a subsequent retry within the probe budget answers `/api/health`
- **WHEN** auto-start evaluates the resolved port
- **THEN** the resolved port SHALL be treated as serving
- **AND** no discovered candidate SHALL displace it

### Requirement: A discovered candidate is verified before adoption

A candidate obtained from discovery SHALL be adopted only after `GET
/api/health` succeeds at its advertised host and HTTP port. An unverifiable
candidate SHALL NOT suppress the launch step, and its rejection SHALL be
recorded in the durable auto-start log with the candidate endpoint and the
reason.

#### Scenario: Unreachable candidate does not suppress launch
- **GIVEN** the resolved port answers nothing
- **AND** discovery finds a local dashboard whose `/api/health` does not answer
- **AND** `autoStart` is `true`
- **THEN** the candidate SHALL be rejected
- **AND** the rejection SHALL be recorded with the candidate endpoint and the reason
- **AND** auto-start SHALL proceed to the launch step

#### Scenario: Candidate health cannot be determined within the probe timeout
- **GIVEN** the resolved port answers nothing
- **AND** a discovered candidate's health probe does not resolve within its timeout
- **THEN** the candidate SHALL be rejected
- **AND** the rejection SHALL be recorded with the candidate endpoint and the reason

### Requirement: A foreign service on the resolved port does not strand discovery

When the resolved port is occupied by a non-dashboard service (`portConflict`),
auto-start SHALL still consult discovery for a verified relocated dashboard
before refusing to launch. The existing "port occupied by another service"
refusal SHALL apply only after discovery yields no verified candidate.

#### Scenario: Foreign service on the resolved port with a relocated dashboard
- **GIVEN** the resolved port 8000 answers HTTP but is not a dashboard (`portConflict`)
- **AND** discovery finds a local dashboard on port 8588 that answers `/api/health`
- **WHEN** auto-start decides what to do
- **THEN** port 8588 SHALL be returned
- **AND** the port-conflict refusal SHALL NOT fire

#### Scenario: Foreign service on the resolved port with no relocated dashboard
- **GIVEN** the resolved port 8000 answers HTTP but is not a dashboard (`portConflict`)
- **AND** discovery finds no verified local dashboard
- **THEN** auto-start SHALL refuse with the "port occupied by another service" log line
- **AND** no launch happens

### Requirement: Selection among multiple local candidates is deterministic

When discovery returns more than one local dashboard, auto-start SHALL prefer
the candidate whose port equals the resolved port, otherwise the lowest port,
and SHALL break a port tie by host string so the ordering is total. Selection
SHALL NOT depend on the order in which advertisements arrive.

#### Scenario: A candidate matching the resolved port wins
- **GIVEN** discovery returns local dashboards on ports 8588 and 8000
- **AND** the resolved port is 8000
- **THEN** the candidate on port 8000 SHALL be selected

#### Scenario: No candidate matches the resolved port
- **GIVEN** discovery returns local dashboards on ports 8611 and 8588
- **AND** neither matches the resolved port
- **THEN** the candidate on port 8588 SHALL be selected
- **AND** the same input in any arrival order SHALL yield the same selection

#### Scenario: Two candidates share the lowest port
- **GIVEN** discovery returns two local dashboards on the same port with different hosts
- **AND** neither matches the resolved port
- **THEN** selection SHALL be resolved by host string
- **AND** the same input in any arrival order SHALL yield the same selection

## MODIFIED Requirements

### Requirement: Auto-start skips and refusals are loud and greppable

Whenever the auto-start path does NOT launch — because a dashboard already
answers on the resolved port, the endpoint is pinned, the worktree refusal
fires, or the resolved port is occupied by another service — the durable
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
