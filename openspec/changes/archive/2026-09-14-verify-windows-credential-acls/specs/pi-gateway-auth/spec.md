## MODIFIED Requirements

### Requirement: Local bridge authorisation restricts access to the owning user
A bridge connecting over the local endpoint SHALL be authorised such that only
the owning operating system user can connect. On POSIX this SHALL be enforced by
ownership of the socket, and no additional token SHALL be required. On Windows,
where filesystem modes do not apply, it SHALL be enforced by a local credential
readable only by the owning user, and that restriction SHALL be established by
an OBSERVED read attempt rather than by inspecting the access control list
alone.

#### Scenario: Socket is owner-only on POSIX
- **WHEN** the dashboard binds the local bridge socket
- **THEN** the socket SHALL have mode `0600`
- **AND** its containing directory SHALL have mode `0700`

#### Scenario: Another user cannot connect on POSIX
- **WHEN** a process running as a different user attempts to connect to the socket
- **THEN** the connection SHALL be refused by the operating system

#### Scenario: Windows local bridge presents the local token
- **WHEN** a bridge connects to the loopback bridge listener on Windows
- **THEN** it SHALL present the local token in the `X-Pi-Local-Token` header
- **AND** that credential SHALL be read from the HOME-derived location
- **AND** the server SHALL verify it with a constant-time comparison

#### Scenario: Windows local bridge without the token is refused
- **WHEN** a process connects to the loopback bridge listener without a valid local token
- **THEN** the connection SHALL be refused
- **AND** it SHALL NOT be able to register any session id

#### Scenario: Local credential is not readable by other users
- **WHEN** the local token file is created
- **THEN** it SHALL be readable only by the owning operating system user
- **AND** on platforms where filesystem modes are not enforced, the guarantee SHALL be verified against the platform's own access control rather than assumed from the requested mode

#### Scenario: A second Windows user is refused the credential by the OS
- **WHEN** a second standard (non-administrator) OS user attempts to read
  `~/.pi/dashboard/local/token`, `identity.key`, or `paired-devices.json`
- **THEN** the read SHALL be denied by the operating system
- **AND** the denial SHALL be recorded from an actual read attempt, since an
  access control list that merely names no broad principal describes
  configuration rather than enforced behaviour
