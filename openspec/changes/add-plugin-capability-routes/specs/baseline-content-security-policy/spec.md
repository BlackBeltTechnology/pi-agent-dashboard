## MODIFIED Requirements

### Requirement: Mode-dependent header emission

The server SHALL emit the CSP as a report-only header in `report` mode and as an enforcing header in `enforce` mode, and SHALL emit no CSP header when the mode is `off`. These rules govern the server's own pages; a response from a plugin app mount (`serveApp`) SHALL additionally carry that app's declared enforcing `Content-Security-Policy` in every mode.

#### Scenario: Report mode emits report-only header
- **WHEN** the mode is `report`
- **AND** the server responds to a request for one of its own paths
- **THEN** the response SHALL include a `Content-Security-Policy-Report-Only` header
- **AND** the response SHALL NOT include a `Content-Security-Policy` header, unless it is a plugin app mount response

#### Scenario: Enforce mode emits enforcing header
- **WHEN** the mode is `enforce`
- **AND** the server responds to a request for one of its own paths
- **THEN** the response SHALL include a `Content-Security-Policy` header
- **AND** the response SHALL NOT include a `Content-Security-Policy-Report-Only` header

#### Scenario: Off mode emits no header
- **WHEN** the mode is `off`
- **THEN** the server SHALL register no CSP hook
- **AND** no CSP header SHALL be added to any response by the baseline; a plugin app mount response SHALL still carry its own declared policy

#### Scenario: Plugin app keeps its policy in every mode
- **WHEN** a request is served by a `serveApp` mount declared with a `csp`
- **THEN** the response SHALL include that `Content-Security-Policy` value in `report`, `enforce` and `off` modes
- **AND** in `report` mode the baseline `Content-Security-Policy-Report-Only` header MAY also be present
