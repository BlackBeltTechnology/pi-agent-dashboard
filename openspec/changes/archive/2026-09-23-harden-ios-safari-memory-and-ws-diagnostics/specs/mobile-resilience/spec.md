## ADDED Requirements

### Requirement: Tool groups collapsed on mobile
On mobile viewports, a tool group SHALL NOT auto-expand while its tools are running; it SHALL stay collapsed until the user taps it, whatever the `toolGroupDefaultCollapsed` preference says. The live group header (running indicator and tool count) SHALL stay visible. On desktop viewports, existing behaviour is unchanged.

#### Scenario: Running tool group stays collapsed on mobile
- **WHEN** a tool group with a running tool renders on a mobile viewport and `toolGroupDefaultCollapsed` is `false`
- **THEN** the group renders collapsed, showing only its live header

#### Scenario: Tap expands a running group on mobile
- **WHEN** the user taps a collapsed running tool group on a mobile viewport
- **THEN** the group expands and stays expanded until the user collapses it

#### Scenario: Desktop auto-expand unchanged
- **WHEN** a tool group with a running tool renders on a desktop viewport and `toolGroupDefaultCollapsed` is `false`
- **THEN** the group auto-expands as before
