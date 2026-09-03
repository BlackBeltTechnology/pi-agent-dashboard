## ADDED Requirements

### Requirement: Member keys are issued and stored hashed
The service SHALL issue keysync keys bound to a member, store only a cryptographic hash of each key, and display the key value exactly once at creation.

#### Scenario: Key shown once
- **WHEN** a member creates a new key
- **THEN** the plaintext key is returned in that response only, and no later request can retrieve it

#### Scenario: Verification is constant-time
- **WHEN** a presented key is compared against a stored hash
- **THEN** the comparison does not vary in duration with the position of the first differing byte

### Requirement: Key lifecycle states are distinguished
The service SHALL distinguish valid, revoked, expired, and unknown keys, and SHALL reject all but valid.

#### Scenario: Revoked key is refused
- **WHEN** a request presents a key that has been revoked
- **THEN** the request is rejected with an error code identifying revocation, distinct from an unknown key

#### Scenario: Expired key is refused
- **WHEN** a request presents a key past its expiry
- **THEN** the request is rejected with an error code identifying expiry

### Requirement: Failed authentication is rate-limited per source
The service SHALL apply an increasing delay to repeated failed key authentications from the same source address, and SHALL reset the delay after a success.

#### Scenario: Repeated failures slow down
- **WHEN** a source address submits successive invalid keys
- **THEN** each rejection is delayed by an increasing interval up to a bounded maximum

#### Scenario: Success clears the penalty
- **WHEN** a source address that has accrued a delay presents a valid key
- **THEN** the accrued delay is reset for that address
