## ADDED Requirements

### Requirement: Apple-tools provisioning probe

The doctor skill SHALL include an Apple-tools provisioning probe that reports the terminal state of the write-suppressed provisioning traversal, so a half-provisioned host is diagnosable from the standard diagnostic entry point rather than requiring the operator to know the package-specific command.

#### Scenario: Probe reports an unprovisioned macOS host

- **WHEN** the doctor runs on a macOS host with no iMCP application present
- **THEN** it reports the Apple-tools provisioning state
- **AND** names the installer command as the remediation

#### Scenario: Probe reports a provisioned host

- **WHEN** the doctor runs on a fully provisioned host
- **THEN** it reports the state pending permission grants
- **AND** names the menu-bar activation step as the remaining manual action

#### Scenario: Probe is silent-clean on a non-macOS host

- **WHEN** the doctor runs on a non-macOS host
- **THEN** the Apple-tools probe reports the unsupported-platform state
- **AND** does not report it as a fault requiring remediation

### Requirement: Probe derives state live and never writes

The probe SHALL derive its verdict from the same write-suppressed check used by the command-line and settings surfaces, and SHALL NOT mutate any configuration as a side effect of diagnosis.

#### Scenario: Diagnosis performs no writes

- **WHEN** the doctor's Apple-tools probe runs in any environment
- **THEN** no configuration file is created or modified
- **AND** no application installation is attempted

#### Scenario: Verdict matches the other surfaces

- **WHEN** the doctor probe and the command-line check run against the same host state
- **THEN** both report the same terminal state

#### Scenario: Probe degrades gracefully when the package is absent

- **WHEN** the doctor runs on a host where the Apple-tools package is not installed
- **THEN** the probe reports the package as absent
- **AND** the remaining doctor probes complete normally
