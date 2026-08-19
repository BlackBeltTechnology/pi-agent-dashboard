## ADDED Requirements

### Requirement: Additional accounts are captured without disturbing existing sign-ins
The client SHALL capture a provider account into a scratch configuration directory selected by `PI_CODING_AGENT_DIR`, and SHALL NOT read or write the member's real `auth.json` during the flow. The isolation guarantee is fixed; the mechanism that drives the login inside that directory is selected by spike (design D10) and this requirement holds for whichever candidate wins.

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
The service SHALL reject enrolment of an account already present in the pool and SHALL leave the existing account unchanged. Detection requires a stable per-account identity that survives token rotation; an OAuth credential is opaque (`access` / `refresh` / `expires`) and re-authorising the same account yields entirely fresh tokens, so token comparison cannot serve. The identity source SHALL be established by the enrolment spike before this requirement is implemented — for example an upstream identity endpoint called once at capture time and stored alongside the account.

#### Scenario: Same provider account enrolled twice
- **WHEN** a member uploads a credential whose derived provider account identity matches one already enrolled
- **THEN** the upload is rejected as a duplicate and the stored account is not overwritten

#### Scenario: Re-authorising an account yields fresh tokens but the same identity
- **WHEN** a member re-authorises an account that is already enrolled, producing entirely different token values
- **THEN** it is still recognised as the same account, so duplicate detection does not depend on token equality

### Requirement: An account can be removed from the pool by its owner
The service SHALL let an account's owner remove it, returning that provider account to the enrollable set.

#### Scenario: A dead account can be recovered
- **WHEN** an account has transitioned to `dead` and its owner removes it and enrols it afresh
- **THEN** enrolment succeeds rather than being rejected as a duplicate — without removal, duplicate detection would make `dead` a terminal state and the recovery edge unreachable

#### Scenario: Removing an account withdraws it from every member
- **WHEN** an owner removes an account other members were rotating onto
- **THEN** it leaves their pools at their next request, on the same path as unsharing
