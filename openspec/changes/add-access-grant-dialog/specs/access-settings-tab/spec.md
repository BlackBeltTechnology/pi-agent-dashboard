## ADDED Requirements

### Requirement: The Access surface shows pending prompts and recent verdicts

The Access page SHALL list the access requests currently pending a verdict and
the recent verdicts, each showing its plane, subject, and — for a verdict that
created a grant — the grant it produced. A pending entry SHALL be answerable from
this page, so the operator has a prompt-free path to the same outcome.

#### Scenario: A pending request is visible and answerable

- **WHEN** an access request is pending a verdict
- **THEN** it SHALL be listed on the Access page
- **AND** it SHALL be answerable there

#### Scenario: A verdict links to the grant it created

- **WHEN** an allow-always verdict created a grant
- **THEN** the Access page SHALL show which store the grant was written to

#### Scenario: The page works with prompting disabled

- **GIVEN** prompting is disabled
- **WHEN** denials are recorded
- **THEN** they SHALL still be listed and answerable on the Access page

### Requirement: The Access surface states when held prompts are unavailable

When configuration prevents a denied request from being suspended, the Access
page SHALL state that held prompts are unavailable and name the reason, rather
than silently offering only the deferred behaviour.

#### Scenario: Reporting-mode Host admission is surfaced

- **GIVEN** the Host-admission gate is in reporting mode
- **WHEN** the Access page is opened
- **THEN** it SHALL state that requests cannot be held pending a verdict, and why

#### Scenario: Prompting disabled is surfaced

- **GIVEN** prompting is disabled by configuration or environment
- **WHEN** the Access page is opened
- **THEN** it SHALL state that no dialog will be raised, and that recorded denials remain answerable there
