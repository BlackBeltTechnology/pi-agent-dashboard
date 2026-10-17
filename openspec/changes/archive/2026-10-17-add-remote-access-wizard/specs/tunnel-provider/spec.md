## MODIFIED Requirements

### Requirement: Readiness is polled only while the Gateway dialog is open
Readiness evaluation shells out per provider (`which`, plus `zerotier-cli listnetworks` and
`tailscale serve status --json`), so it SHALL NOT run unconditionally in the background. The client
SHALL evaluate readiness once immediately when the Remote access dialog (the former Gateway dialog)
opens and once each time the operator returns to its landing, so the landing and task hints are
current, and SHALL poll every 5 seconds only while a
provider-dependent step (Choose provider, Install, Enable, Go online) is the current step. Polling
SHALL stop when no such step is current and when the dialog closes.

A poll SHALL be skipped while a previous evaluation is still in flight, so a slow provider
CLI cannot queue overlapping subprocess batches.

#### Scenario: Poll starts on open
- **WHEN** the Remote access dialog opens
- **THEN** readiness SHALL be evaluated immediately
- **AND** re-evaluated every 5 seconds thereafter while a provider-dependent step is current

#### Scenario: Poll stops on close
- **WHEN** the Remote access dialog closes
- **THEN** no further readiness evaluation SHALL be scheduled

#### Scenario: Overlapping polls are suppressed
- **GIVEN** an evaluation has not yet returned when the next 5-second tick fires
- **WHEN** the tick fires
- **THEN** the tick SHALL be skipped rather than starting a second concurrent evaluation

#### Scenario: Manual refresh is available
- **WHEN** the user activates the refresh control
- **THEN** a readiness evaluation SHALL run immediately without waiting for the next tick

#### Scenario: Landing does not poll
- **GIVEN** the dialog shows the status landing or a non-provider step
- **WHEN** 5 seconds pass after the initial evaluation
- **THEN** no further readiness evaluation SHALL be scheduled

### Requirement: Per-provider connection status
The server SHALL report, for every provider the configuration plans to run, one of
`connected` (up now), `failed` (last connect failed, with reason), `dropped` (was connected,
now gone, with reason when known) or `idle` (not attempted). The report SHALL be computed
in memory without shelling out. An operator Disconnect SHALL reset every provider to `idle`.
The gated `/api/tunnel-status-detail` SHALL carry the per-provider list and the providers
this server connected; the ungated `/api/tunnel-status` SHALL carry only the counts
`gateway: { connected, expected }`, never provider names or errors.

#### Scenario: Partial connection
- **GIVEN** zrok failed and tailscale connected
- **WHEN** the status is read
- **THEN** zrok SHALL be `failed` with its reason and tailscale `connected`
- **AND** the ungated counts SHALL be `{ connected: 1, expected: 2 }`

#### Scenario: A tunnel that dies behind the dashboard reads dropped
- **GIVEN** a provider was connected by this server
- **WHEN** its tunnel goes away without an operator Disconnect
- **THEN** it SHALL be reported `dropped`, not `connected` and not `idle`

#### Scenario: Toggle and toolbar follow the live state
- **WHEN** the Remote access dialog or the Gateway settings page is open
- **THEN** the Connect/Disconnect toggle SHALL re-read the status every 5s (skipped while an action is in flight) and list each provider's state and reason
- **AND** the toggle SHALL offer Disconnect iff this server holds at least one provider, independent of OS-level daemons the readiness board sees
- **AND** the toolbar indicator SHALL follow the Remote access button states (`qr-code-dialog`): green when all planned providers are connected, amber when some are, red when a planned provider failed or dropped, and otherwise blue when the server listens on the network or grey
- **AND** a Gateway with a connected non-zrok provider SHALL NOT be reported "not set up" merely because zrok is absent

### Requirement: Setup content is driven by readiness
The Gateway settings page and the Remote access dialog's provider steps SHALL render the
primary provider's readiness state, and the steps they offer for a provider SHALL depend on that state rather than being a fixed list. A step whose precondition
is already satisfied SHALL NOT be presented as outstanding work.

#### Scenario: Not installed shows the install step
- **WHEN** a provider is `not-installed`
- **THEN** the install step SHALL be shown
- **AND** the enroll and connect controls SHALL NOT be offered as actionable

#### Scenario: Not set shows the enroll step
- **WHEN** a provider is `not-set`
- **THEN** the install step SHALL be shown as satisfied
- **AND** the enroll step SHALL be the outstanding action

#### Scenario: Disconnected offers connect
- **WHEN** a provider is `disconnected`
- **THEN** install and enroll SHALL be shown as satisfied
- **AND** connect SHALL be the outstanding action

#### Scenario: Connected shows the live endpoint
- **WHEN** a provider is `connected`
- **THEN** its reachable URL SHALL be shown
- **AND** disconnect SHALL be offered

#### Scenario: State is conveyed by more than colour
- **WHEN** a readiness state is rendered
- **THEN** it SHALL carry a text label, not colour alone (WCAG 1.4.1)
