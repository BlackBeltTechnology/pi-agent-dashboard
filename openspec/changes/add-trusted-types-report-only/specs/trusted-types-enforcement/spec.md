## ADDED Requirements

### Requirement: Trusted Types is reported, never enforced, in this change

The CSP SHALL carry `require-trusted-types-for 'script'` only in the `Content-Security-Policy-Report-Only` header. The enforcing `Content-Security-Policy` header SHALL NOT include a Trusted Types directive in this change.

#### Scenario: Report-only header carries the directive
- **WHEN** the dashboard serves an HTML document with `PI_DASHBOARD_CSP` set to a non-off mode
- **THEN** the response SHALL include `Content-Security-Policy-Report-Only` containing `require-trusted-types-for 'script'`
- **AND** the enforcing `Content-Security-Policy` header SHALL NOT contain `require-trusted-types-for`

#### Scenario: Violations reach the existing report sink
- **WHEN** a Trusted Types violation occurs in the browser
- **THEN** the violation SHALL be reported to the same `report-uri`/`report-to` endpoint used by the baseline CSP

### Requirement: A single named default policy sanitizes HTML sinks

The client SHALL register exactly one default TrustedTypes policy at bootstrap when `window.trustedTypes` is available. The default policy SHALL sanitize string input with DOMPurify before returning TrustedHTML.

#### Scenario: Default policy registered once
- **WHEN** the client bootstraps in a browser that supports Trusted Types
- **THEN** `trustedTypes.defaultPolicy` SHALL be set exactly once
- **AND** a second registration attempt SHALL NOT throw or replace it

#### Scenario: Non-Trusted-Types browsers unaffected
- **WHEN** the client bootstraps in a browser without `window.trustedTypes`
- **THEN** bootstrap SHALL proceed without error and no policy SHALL be created

### Requirement: Mermaid SVG passes through a named, reviewed policy

The Mermaid colorize step SHALL produce its output through a named TrustedTypes policy. No other non-sanitized TrustedHTML path SHALL exist in the Mermaid pipeline.

#### Scenario: Mermaid output is pixel-identical
- **WHEN** the reference Mermaid diagram set is rendered before and after this change
- **THEN** every diagram SHALL render with no visible pixel difference outside a documented tolerance

### Requirement: Measured violation budget is tracked

A repository e2e measurement SHALL record the Trusted Types violation count per route. The recorded count SHALL NOT increase between releases without an explicit budget change in this spec.

#### Scenario: Budget recorded
- **WHEN** the measurement spec runs against the production build
- **THEN** it SHALL write the per-route violation count to a tracked artifact
- **AND** a count above the recorded budget SHALL fail the spec
