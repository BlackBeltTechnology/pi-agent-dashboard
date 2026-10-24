## MODIFIED Requirements

### Requirement: Secret references and resolvers
A definition SHALL reference secrets as `store:<id>/<name>`, `env:<NAME>`, or
`keychain:<service>/<account>`. The `keychain:` resolver SHALL be read-only: on
macOS via `security find-generic-password … -w`, on Linux via
`secret-tool lookup`, both resolved through `ToolRegistry` and run with a 10 s
timeout. The dashboard SHALL NOT write keychain entries, with one exception: the
host data-key entry (service `pi-dashboard-credential-key`) owned by
`credential-at-rest-encryption`. The `keychain:` resolver SHALL refuse any ref
whose service is `pi-dashboard-credential-key`, before running any tool. A ref that cannot be
resolved (binary missing, keyring locked, no session bus, unsupported OS,
timeout, reserved host data-key service) SHALL make the service `unavailable` with reason `secret-unavailable`,
and SHALL NOT fall back to another backend.

#### Scenario: Keychain ref on Linux without a session bus
- **WHEN** a service references `keychain:pi-dashboard/obs` and `secret-tool` cannot reach a keyring
- **THEN** `ensure` SHALL report `unavailable` with reason `secret-unavailable`
- **AND** the store file SHALL NOT be consulted for that secret

#### Scenario: Keychain ref on Windows
- **WHEN** a service references a `keychain:` secret on win32
- **THEN** `ensure` SHALL report `unavailable` with reason `secret-unavailable`

#### Scenario: Host data key cannot be referenced
- **WHEN** a service references `keychain:pi-dashboard-credential-key/data-key-v1`
- **THEN** `ensure` SHALL report `unavailable` with reason `secret-unavailable`
- **AND** no keychain tool SHALL be run
