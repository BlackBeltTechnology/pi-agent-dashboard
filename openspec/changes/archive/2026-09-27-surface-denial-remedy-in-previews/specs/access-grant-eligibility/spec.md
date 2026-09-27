## ADDED Requirements

### Requirement: A request can declare itself ineligible to raise a dialog

A request SHALL be able to state explicitly that it must not raise a dialog.
Such a request SHALL take the ineligible path even when sent by a client that
holds a live prompt capability. The declaration SHALL only ever remove
eligibility, never confer it.

#### Scenario: A declared-ineligible request from a capability holder does not prompt

- **GIVEN** a client holding a live prompt capability
- **WHEN** it issues a request declared ineligible that is then denied
- **THEN** no dialog SHALL be raised
- **AND** the denial SHALL be recorded as ineligible

#### Scenario: The declaration cannot confer eligibility

- **GIVEN** a client without a prompt capability
- **WHEN** it issues a request carrying the declaration
- **THEN** the request SHALL remain ineligible
