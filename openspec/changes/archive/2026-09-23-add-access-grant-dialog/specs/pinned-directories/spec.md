## ADDED Requirements

### Requirement: An unknown-working-directory denial may raise a dialog that pins the directory

An unknown-working-directory denial that is prompt-eligible MAY raise a dialog
naming the directory. An allow-always verdict SHALL pin that directory through
the existing pinned-directory store; an allow-once verdict SHALL permit only the
request that raised it and SHALL NOT pin anything.

The dialog SHALL name pinning explicitly, so the operator understands that the
persistent answer adds the directory to the pinned list shown in the Access
surface.

#### Scenario: Allow always pins

- **WHEN** the operator answers allow-always on an unknown-working-directory denial
- **THEN** the directory SHALL appear in the pinned directories
- **AND** it SHALL be revocable from the Access surface

#### Scenario: Allow once does not pin

- **WHEN** the operator answers allow-once
- **THEN** the pinned directories SHALL be unchanged
- **AND** a later request for the same directory SHALL be denied again

#### Scenario: The verdict does not pin a different directory

- **WHEN** an allow-always verdict is applied
- **THEN** exactly the directory named in the dialog SHALL be pinned
