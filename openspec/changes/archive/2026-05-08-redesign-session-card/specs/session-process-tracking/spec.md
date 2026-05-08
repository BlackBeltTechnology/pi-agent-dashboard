## ADDED Requirements

### Requirement: ProcessList removed from session card
The ProcessList component SHALL NOT render inside SessionCard. Process information SHALL remain available via `session.processes` data and SHALL be accessible in SessionSidebar/detail view.

#### Scenario: No process list in card
- **WHEN** a session has active child processes
- **THEN** ProcessList SHALL NOT render inside the SessionCard
