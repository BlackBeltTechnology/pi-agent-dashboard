## ADDED Requirements

### Requirement: Additional accounts are captured without disturbing existing sign-ins
The client SHALL capture a provider account by running pi's own login against a scratch configuration directory, and SHALL NOT read or write the member's real `auth.json` during the flow.

#### Scenario: Existing credential untouched
- **WHEN** a member completes enrolment of a second account for a provider they are already signed in to
- **THEN** the member's existing `auth.json` entry for that provider is byte-identical to its prior contents

#### Scenario: Scratch directory is removed on success
- **WHEN** a capture completes and the credential is uploaded
- **THEN** the scratch directory and its contents are deleted

#### Scenario: Scratch directory is removed on failure
- **WHEN** a capture fails or is cancelled before completing
- **THEN** the scratch directory and its contents are deleted and nothing is uploaded

### Requirement: Orphaned scratch directories are swept
The client SHALL remove scratch directories left by an interrupted capture when it next starts.

#### Scenario: Sweep after a crash
- **WHEN** the client starts and finds a scratch directory from a previous process
- **THEN** the directory is deleted before any new capture begins

### Requirement: Duplicate enrolment is detected
The service SHALL reject enrolment of an account already present in the pool and SHALL leave the existing account unchanged.

#### Scenario: Same provider account enrolled twice
- **WHEN** a member uploads a credential whose provider account identity matches one already enrolled
- **THEN** the upload is rejected as a duplicate and the stored account is not overwritten
