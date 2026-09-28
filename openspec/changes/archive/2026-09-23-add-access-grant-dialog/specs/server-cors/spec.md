## ADDED Requirements

### Requirement: An origin denial may be answered by prompt

A recorded CORS origin denial MAY raise a dialog naming the denied origin, so the
operator can admit it without first having to diagnose an opaque browser failure.
An allow-always verdict SHALL add the origin to the configured allowed origins.
The denied request SHALL NOT be suspended.

The origin SHALL be displayed exactly as received, escaped for display, so a
crafted origin string cannot misrepresent itself in the dialog.

#### Scenario: Allow always admits the origin

- **WHEN** an operator answers allow-always on an origin denial
- **THEN** the origin SHALL be added to the configured allowed origins
- **AND** a subsequent request from it SHALL be admitted

#### Scenario: The origin is rendered safely

- **WHEN** a dialog displays a denied origin
- **THEN** the value SHALL be escaped and SHALL NOT be interpreted as markup

#### Scenario: The wildcard admission path is not widened

- **WHEN** a verdict admits an origin
- **THEN** exactly that origin SHALL be added
- **AND** no wildcard or pattern SHALL be created from it
