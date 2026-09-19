## ADDED Requirements

### Requirement: A path grant may originate from a verdict

A path-anchor grant SHALL be creatable from an operator verdict on a denial, in
addition to the Access surface. A grant created this way SHALL be
indistinguishable in effect from one created in the Access surface — same
subtree semantics, same canonical subject, same revocation — and SHALL record
that its origin was a verdict.

#### Scenario: A verdict-created grant admits only its subtree

- **WHEN** a grant is created from an allow-always verdict
- **THEN** it SHALL admit exactly the subtree the Access-surface equivalent would admit

#### Scenario: The grant's origin is recorded

- **WHEN** a grant is created from a verdict
- **THEN** the Access surface SHALL show that it originated from a prompt

#### Scenario: A verdict-created grant is revocable

- **WHEN** a verdict-created grant is revoked
- **THEN** it SHALL stop admitting its subtree, exactly as any other grant does

#### Scenario: No grant is created without an explicit answer

- **WHEN** a prompt expires, is dismissed, or is denied
- **THEN** no path grant SHALL be created
