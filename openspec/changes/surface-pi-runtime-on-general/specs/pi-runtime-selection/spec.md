## ADDED Requirements

### Requirement: The resolved pi runtime is discoverable from Settings → General
Settings → General SHALL render a permanent, read-only summary of the resolved pi runtime, independent of pi version-skew state. The summary SHALL name both consumers — *Sessions spawn* and *Server imports* — with the version each currently resolves to, and SHALL offer an affordance that navigates to the pi runtime picker on Settings → Developer and brings it into view.

The summary SHALL be strictly read-only. It SHALL NOT write `~/.pi/dashboard/tool-overrides.json`, SHALL NOT issue `POST /api/pi/runtime`, and SHALL NOT issue `PUT`/`DELETE /api/tools/:name`. The picker and the Tools section remain the only writers of runtime overrides, and remain adjacent on Settings → Developer.

The summary SHALL source its values from the `piRuntime` shape on `GET /api/health` and SHALL NOT enumerate installs. Because that shape carries versions and divergence only, the summary SHALL NOT label a consumer as automatic versus pinned; that distinction remains the picker's to render.

#### Scenario: Healthy pi, no version skew
- **WHEN** the dashboard is running a pi version at or above the recommended version and both consumers resolve to the same install
- **THEN** Settings → General SHALL still render the runtime summary naming both consumers and their shared version
- **AND** the summary SHALL NOT be suppressed by the absence of a version advisory

#### Scenario: Consumers diverge
- **WHEN** `GET /api/health` reports `piRuntime.consumerDiverged === true` with a non-null `consumerMessage`
- **THEN** the summary SHALL surface that message as a warning alongside both consumer versions

#### Scenario: Navigating to the picker
- **WHEN** the user activates the summary's change affordance
- **THEN** the panel SHALL navigate to Settings → Developer through the existing dirty-gated page navigation
- **AND** the pi runtime picker section SHALL be scrolled into view

#### Scenario: Summary performs no writes
- **WHEN** the runtime summary is rendered and the user interacts with it
- **THEN** no request to `POST /api/pi/runtime`, `PUT /api/tools/:name` or `DELETE /api/tools/:name` SHALL be issued from the summary

#### Scenario: Server does not report piRuntime
- **WHEN** `GET /api/health` omits `piRuntime` or returns it as null
- **THEN** the summary SHALL render nothing and SHALL NOT surface an error

#### Scenario: Health shape is not widened
- **WHEN** the runtime summary is implemented
- **THEN** the `piRuntime` shape on the unauthenticated `GET /api/health` SHALL continue to carry versions and divergence only
- **AND** SHALL NOT gain a filesystem path or a pinned/override indicator

### Requirement: The version advisory links to the picker
When the pi version advisory on Settings → General is rendered — in either its recommended-upgrade or below-minimum state — it SHALL offer the same affordance that navigates to the pi runtime picker and brings it into view. The advisory SHALL remain conditional on version skew; the permanent summary is a separate element.

#### Scenario: Advisory in below-minimum state
- **WHEN** the advisory renders because the running pi is below the minimum version
- **THEN** it SHALL offer the navigate-to-picker affordance in addition to its existing upgrade-command disclosure

#### Scenario: Advisory absent on a healthy install
- **WHEN** pi is at or above the recommended version
- **THEN** the advisory SHALL NOT render
- **AND** the permanent runtime summary SHALL still render
