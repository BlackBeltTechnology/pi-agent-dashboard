## ADDED Requirements

### Requirement: Social login for members
The service SHALL authenticate humans through GitHub and Google OAuth and issue a session for the management interface.

#### Scenario: First successful GitHub login
- **WHEN** a user completes the GitHub OAuth flow and their email is not yet known
- **THEN** a member record is created in the `revoked` role and no pooled account becomes reachable to them until an admin grants access

#### Scenario: Returning member login
- **WHEN** an existing member with role `member` completes login
- **THEN** a session is issued and the management interface is reachable

#### Scenario: Failed provider callback
- **WHEN** the OAuth callback returns an error or a mismatched state parameter
- **THEN** no session is issued and the attempt is recorded in the audit log

### Requirement: Member identity is separate from machine identity
The service SHALL treat a management session and a keysync member key as distinct credentials, and SHALL NOT accept one in place of the other.

#### Scenario: Session cannot drive the proxy
- **WHEN** a request to a proxy endpoint presents a management session cookie but no member key
- **THEN** the request is rejected with an authentication error

#### Scenario: Member key cannot administer
- **WHEN** a request to a management endpoint presents a member key but no session
- **THEN** the request is rejected with an authentication error
