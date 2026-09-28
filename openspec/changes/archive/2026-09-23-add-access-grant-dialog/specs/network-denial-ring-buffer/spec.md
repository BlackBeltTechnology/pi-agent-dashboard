## ADDED Requirements

### Requirement: A pending access request may actively raise a prompt

A recorded pending access request SHALL be able to raise a dialog on the
operator's screen rather than only waiting to be noticed in a review surface. The
denied request itself SHALL be answered immediately with its existing denial: it
SHALL NOT be suspended, because the requester on these planes is untrusted by
definition and may hold no channel to wait on.

An operator verdict SHALL apply to the requester's subsequent attempt. The
requester SHALL NOT be told that a prompt was raised, and SHALL learn nothing
beyond the outcome of its own retry.

#### Scenario: The denied caller is not held

- **WHEN** a denial on an untrusted plane raises a prompt
- **THEN** the denied request SHALL receive its existing denial immediately

#### Scenario: The verdict applies to the retry

- **GIVEN** an operator answered allow-always for a recorded denial
- **WHEN** the requester retries
- **THEN** the retry SHALL succeed

#### Scenario: A denied verdict changes nothing for the requester

- **WHEN** an operator denies
- **THEN** a retry SHALL be denied exactly as before

#### Scenario: Prompting adds no inbound surface

- **WHEN** prompting is enabled
- **THEN** the requester SHALL have no way to send anything it could not send with prompting disabled

### Requirement: Existing dedupe and caps govern prompting volume

Prompts raised from recorded denials SHALL respect the existing dedupe and
per-source caps rather than introducing a parallel mechanism. Entries that the
existing classification marks as not trustable SHALL NOT raise a prompt.

#### Scenario: Duplicate denials raise one prompt

- **WHEN** the same denial recurs while an entry is already pending
- **THEN** at most one dialog SHALL be outstanding for it

#### Scenario: A non-trustable entry does not prompt

- **WHEN** a recorded denial is classified as not trustable
- **THEN** no dialog SHALL be raised for it
