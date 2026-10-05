## ADDED Requirements

### Requirement: Remote resolution does not block the event loop

The `git` and `https` resolvers SHALL run external processes (`git`, `tar`, `unzip`) asynchronously, never via synchronous child-process APIs. Each git invocation SHALL be bounded by a timeout.

#### Scenario: Clone does not stall the host process

- **WHEN** a git source is cloned inside a long-running host process
- **THEN** the host's event loop continues serving other work while the clone runs

#### Scenario: Git timeout

- **WHEN** a git invocation exceeds 120 seconds
- **THEN** the child process is killed and resolution of that source fails with a timeout error

#### Scenario: Hardening flags preserved

- **WHEN** the resolver invokes git
- **THEN** the argv carries the same protocol-restriction, address-pinning, and redirect flags required by the `untrusted-content-ingestion` capability

### Requirement: Classifiable not-trusted failure

When a remote source is not recorded as trusted and `promptTrust` returns false, resolution SHALL fail with an exported error type that callers can distinguish from network, timeout, and extraction failures.

#### Scenario: Not-trusted error is classifiable

- **WHEN** a remote source is not recorded as trusted and `promptTrust` returns false
- **THEN** resolution throws the not-trusted error type and performs no network access

### Requirement: Trust persistence is atomic and reports failure

Recording trust SHALL write the trust store atomically: a temporary file in the same directory, then a rename. It SHALL return whether the write was persisted. A failed write SHALL leave the previous store contents intact.

#### Scenario: Successful grant persisted

- **WHEN** trust is recorded and the store is writable
- **THEN** the call returns true and the entry is present on the next read

#### Scenario: Failed write reported

- **WHEN** the trust store directory is not writable
- **THEN** the call returns false, logs the failure, and the previous store contents are unchanged
