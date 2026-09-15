## ADDED Requirements

### Requirement: Approval refuses a paired-device credential and bounds the label
The approval action SHALL refuse any request whose only credential is a
paired-device bearer token, independent of the caller's network position. An
optional operator-supplied `label` on approval SHALL be trimmed and SHALL be
accepted only when it is 1..64 bytes of UTF-8 — the same bound as direct token
issuance; a label outside that bound SHALL be rejected with `400` and no device
SHALL be approved. When no label is supplied the pending device's own label is
kept.

#### Scenario: Paired device cannot approve a pending device
- **GIVEN** a pending device awaiting approval
- **WHEN** a request authenticated only by an existing paired-device bearer posts the correct code and confirm code to the approval route
- **THEN** the server SHALL respond `401`
- **AND** the pending device SHALL remain pending and its token SHALL NOT verify

#### Scenario: Oversized approval label is rejected
- **WHEN** an operator posts a valid code and confirm code with a `label` of 65 bytes of UTF-8
- **THEN** the server SHALL respond `400`
- **AND** the pending device SHALL remain pending

#### Scenario: Label absent keeps the pending label
- **WHEN** an operator approves without a `label`
- **THEN** the paired device SHALL carry the label recorded at redemption
