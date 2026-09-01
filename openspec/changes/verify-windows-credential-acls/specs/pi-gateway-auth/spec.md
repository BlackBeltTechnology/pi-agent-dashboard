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
- **AND** a connection without a valid token SHALL be refused

#### Scenario: A second Windows user is refused the credential by the OS
- **WHEN** a second standard (non-administrator) OS user attempts to read
  `~/.pi/dashboard/local/token`, `identity.key`, or `paired-devices.json`
- **THEN** the read SHALL be denied by the operating system
- **AND** the denial SHALL be recorded from an actual read attempt, since an
  access control list that merely names no broad principal describes
  configuration rather than enforced behaviour
