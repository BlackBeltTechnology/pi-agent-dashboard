## ADDED Requirements

### Requirement: The resolved pi runtime is discoverable from Settings → General
Settings → General SHALL render a permanent, read-only summary of the resolved pi runtime, independent of pi version-skew state. The summary SHALL name both consumers — *Sessions spawn* and *Server imports* — with the version each currently resolves to, and SHALL offer an affordance that navigates to the pi runtime picker on Settings → Developer and brings it into view.

The summary SHALL be strictly read-only. It SHALL NOT write `~/.pi/dashboard/tool-overrides.json`, SHALL NOT issue `POST /api/pi/runtime`, and SHALL NOT issue `PUT`/`DELETE /api/tools/:name`. The picker and the Tools section remain the only writers of runtime overrides, and remain adjacent on Settings → Developer.

The summary SHALL source its values from the `piRuntime` shape on `GET /api/health` and SHALL NOT enumerate installs. The summary SHALL NOT initiate `/api/health` polling of its own: the poll is owned by the host panel, whose single polling instance feeds both the summary and the advisory. Because that shape carries versions and divergence only, the summary SHALL NOT label a consumer as automatic versus pinned; that distinction remains the picker's to render. Consumer versions in that shape are nullable; when a consumer's version is unresolved the summary SHALL render an unknown-version fallback (as the picker already does) and SHALL NOT fabricate a value.

Consumer divergence is defined on the realpath'd package directory, not on version equality. When the summary reports a divergence, it SHALL surface the server's `consumerMessage` verbatim alongside both consumers' resolved versions — which may be equal when two different installs hold the same version.

#### Scenario: Healthy pi, no version skew
- **WHEN** the dashboard is running a pi version at or above the recommended version and both consumers resolve to the same install
- **THEN** Settings → General SHALL still render the runtime summary naming both consumers and their shared version
- **AND** the summary SHALL NOT be suppressed by the absence of a version advisory

#### Scenario: Consumers diverge
- **WHEN** `GET /api/health` reports `piRuntime.consumerDiverged === true` with a non-null `consumerMessage`
- **THEN** the summary SHALL surface that message verbatim as a warning alongside both consumer versions
- **AND** this SHALL hold even when both consumers resolve to the same version, divergence being defined on the resolved install (realpath'd package directory), not on version equality

#### Scenario: A consumer version is unresolved
- **WHEN** `piRuntime.spawnVersion` or `piRuntime.moduleVersion` is null
- **THEN** the summary SHALL render an unknown-version fallback for that consumer
- **AND** SHALL NOT crash and SHALL NOT fabricate a version value

#### Scenario: Navigating to the picker
- **WHEN** the user activates the summary's change affordance
- **THEN** the panel SHALL navigate to Settings → Developer through the same rail navigation helper the Save Bar page chips use
- **AND** the pi runtime picker section SHALL be scrolled into view

#### Scenario: Summary performs no writes
- **WHEN** the runtime summary is rendered and the user interacts with it
- **THEN** no request to `POST /api/pi/runtime`, `PUT /api/tools/:name` or `DELETE /api/tools/:name` SHALL be issued from the summary

#### Scenario: Single health poller
- **WHEN** the summary and the version advisory are both rendered on Settings → General
- **THEN** exactly one `/api/health` polling instance SHALL feed both surfaces, owned by the host panel
- **AND** neither the summary nor the advisory SHALL schedule its own polling loop

#### Scenario: Server does not report piRuntime
- **WHEN** `GET /api/health` omits `piRuntime` or returns it as null — an older server, or a current server whose runtime discovery failed
- **THEN** the summary SHALL render nothing and SHALL NOT surface an error

#### Scenario: Health shape is not widened
- **WHEN** the runtime summary is implemented
- **THEN** the `piRuntime` shape on the unauthenticated `GET /api/health` SHALL continue to carry versions and divergence only
- **AND** SHALL NOT gain a filesystem path or a pinned/override indicator

### Requirement: The version advisory links to the picker
When the pi version advisory on Settings → General is rendered — in either of the alert states defined by the `pi-core-version-check` capability — it SHALL offer the same affordance as the permanent summary: navigation to the pi runtime picker on Settings → Developer through the rail navigation helper, with the picker scrolled into view. This requirement governs the affordance only; it SHALL NOT restate the advisory's triggering condition or copy, so the two capabilities cannot diverge at archive time. The advisory SHALL remain conditional per `pi-core-version-check`; the permanent summary is a separate element.

#### Scenario: Advisory in an alert state
- **WHEN** the advisory renders in either its Soft warning or Hard advisory state, as defined by `pi-core-version-check`
- **THEN** it SHALL offer the navigate-to-picker affordance in addition to its existing content
