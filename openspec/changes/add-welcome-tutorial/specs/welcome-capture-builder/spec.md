## ADDED Requirements

### Requirement: Stable tour anchors in the client
Client components referenced by the tutorial SHALL carry `data-tour="<id>"` attributes. Every anchor referenced by the shot manifest or anatomy SHALL exist in client source; a missing anchor SHALL fail the lint gate.

#### Scenario: Renamed anchor breaks the gate
- **GIVEN** the manifest references `data-tour="E-directory-card"`
- **WHEN** that attribute is removed from the client
- **THEN** the welcome lint test SHALL fail

### Requirement: Live specimens
The tutorial SHALL render self-contained client components as specimens using typed fixtures inside a `SpecimenProvider` that supplies a mock store, mock API, in-memory storage, theme and language. Specimens SHALL NOT perform network requests to the dashboard. The welcome bundle SHALL NOT import `monaco-editor`, `xterm` or `mermaid`.

#### Scenario: Specimen follows component changes
- **WHEN** a specimen's component changes its props in a type-incompatible way
- **THEN** the welcome build SHALL fail type checking

#### Scenario: Forbidden import
- **WHEN** a welcome module imports `monaco-editor`
- **THEN** the lint gate SHALL fail

### Requirement: Reproducible screenshot builder
A capture command SHALL produce `shots/{lang}/{light|dark}/{id}.webp` for every manifest entry by driving a dashboard with a fixture HOME. Each entry SHALL declare route, viewport, setup steps, anchor, masks and optional network stubs. Captures SHALL freeze the clock, disable animations and set theme and language before load. Masked regions SHALL be applied to every capture.

#### Scenario: Same inputs, same output
- **WHEN** the builder runs twice on the same commit and fixtures
- **THEN** outputs SHALL be pixel-identical within the diff threshold

#### Scenario: Secret regions masked
- **GIVEN** an entry masks `[data-tour=secret]`
- **WHEN** it is captured in any mode or language
- **THEN** the region SHALL be masked in the output

### Requirement: Runtime screenshot refresh
The first-party tutorial SHALL offer "Refresh screenshots", which runs the same manifest against the user's own server when a supported browser driver is available, writing to `~/.pi/dashboard/welcome/shots`, and SHALL offer "Reset to shipped". Without a driver it SHALL keep the shipped figures and explain why.

#### Scenario: No browser driver
- **GIVEN** neither Playwright Chromium nor `agent-browser` is available
- **WHEN** the user clicks Refresh screenshots
- **THEN** the shipped figures SHALL remain and a notice SHALL explain the missing driver

### Requirement: Drift detection
The build SHALL fail when a figure id is missing from the manifest or unused, when i18n keys differ between languages, or when a referenced anchor is missing. CI SHALL run the capture builder when client or welcome sources change and SHALL report visual differences against the committed baseline as a non-blocking warning with a diff artifact.

#### Scenario: Visual drift is report-only
- **WHEN** a client change alters a captured screen
- **THEN** CI SHALL annotate a warning and upload the diff artifact without failing the run

#### Scenario: Missing translation blocks the build
- **WHEN** a key exists in `en` but not in `hu`
- **THEN** the welcome build SHALL fail
