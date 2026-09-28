## ADDED Requirements

### Requirement: A network denial may be answered by prompt

A recorded network denial MAY raise a dialog naming the denied source. An
allow-always verdict SHALL add the corresponding entry to the trusted-networks
configuration; an allow-once verdict SHALL NOT be offered on this plane, because
the denied request is never suspended and there is nothing to allow once.

#### Scenario: Allow always trusts the source

- **WHEN** an operator answers allow-always on a network denial
- **THEN** the trusted-networks configuration SHALL gain the entry
- **AND** the source's next attempt SHALL be admitted

#### Scenario: Allow once is not offered

- **WHEN** a dialog is raised for a network denial
- **THEN** it SHALL offer only allow-always and deny

#### Scenario: The entry is revocable

- **WHEN** an entry added by a verdict is revoked from the Access surface
- **THEN** the source SHALL be denied again
