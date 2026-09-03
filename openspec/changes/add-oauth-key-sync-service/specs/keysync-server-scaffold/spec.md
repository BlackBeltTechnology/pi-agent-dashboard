## ADDED Requirements

### Requirement: Standalone deployable service
The keysync server SHALL be runnable as a standalone process with no dependency on any pi-dashboard package, exposing an npm `bin` entry and a docker image.

#### Scenario: Starts with no dashboard present
- **WHEN** the keysync binary is started on a host where no pi-dashboard server is installed or running
- **THEN** the service starts, binds its configured port, and reports healthy

#### Scenario: Restarts unattended after reboot
- **WHEN** the container is restarted with the KEK supplied through its configured environment or file source
- **THEN** the service resumes serving without any interactive unseal step

### Requirement: Schema migrations run on boot
The service SHALL apply pending database migrations at startup before accepting requests.

#### Scenario: Fresh database
- **WHEN** the service starts against an empty database file
- **THEN** it creates the full schema and begins serving

#### Scenario: Migration failure aborts startup
- **WHEN** a migration fails to apply
- **THEN** the service exits non-zero without binding its port, rather than serving against a partially migrated schema

### Requirement: Configuration is explicit and validated
The service SHALL validate required configuration at startup and refuse to start when a required value is absent.

#### Scenario: Missing KEK
- **WHEN** the service starts with no KEK configured
- **THEN** it exits non-zero with a message naming the missing configuration key
