## ADDED Requirements

### Requirement: A dialog is never raised for a subject no answer can grant

A denial whose subject is refused by the forbidden-subject rule SHALL NOT raise
a dialog on any plane. It SHALL be refused at once with an outcome stating that
the subject is ungrantable, and the refusal SHALL be written to the server log
naming the plane and the subject, under a label distinct from the registry's own
refusal transitions. An operator SHALL never be offered an allowing answer that the
resumed request would then refuse.

#### Scenario: An ancestor of the home directory is not prompted

- **GIVEN** prompting is enabled, the host gate enforces, and the home directory lies beneath the denied directory
- **WHEN** an eligible filesystem denial names that directory
- **THEN** no dialog SHALL be raised
- **AND** the denial SHALL report the subject as ungrantable
- **AND** the server log SHALL name the plane and the subject

#### Scenario: A grantable subject is still prompted

- **GIVEN** prompting is enabled and the host gate enforces
- **WHEN** an eligible filesystem denial names a directory that is not forbidden
- **THEN** a dialog SHALL be raised
