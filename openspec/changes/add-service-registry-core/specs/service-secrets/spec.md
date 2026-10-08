## ADDED Requirements

### Requirement: Service secret store
Service secrets SHALL be stored in `~/.pi/dashboard/services-secrets.json`,
keyed `<serviceId>/<name>`, separate from `services.json`, `config.json`,
`auth.json` and `plugin-credentials.json`. Writes SHALL use the shared lock +
atomic-write module with mode `0600`. A corrupt file SHALL be backed up
byte-exact, and **every** write SHALL be refused while the file is corrupt, so
a write can never replace other services' secrets with a fresh file. While the
file is unreadable, services that need a `store:` secret SHALL report
`unavailable` with reason `secret-unavailable`, and `status` SHALL name the
backup path.
Removing a service SHALL delete its stored secrets.

#### Scenario: Secrets file is owner-only
- **WHEN** a secret is stored
- **THEN** `services-secrets.json` SHALL have mode `0600`

#### Scenario: Removing a service removes its secrets
- **WHEN** service `neo4j` is removed
- **THEN** no `neo4j/*` key SHALL remain in `services-secrets.json`

#### Scenario: Corrupt store refuses writes
- **WHEN** `services-secrets.json` is not valid JSON
- **THEN** a secret write SHALL be refused, the corrupt file SHALL be preserved byte-exact, and other services' secrets SHALL NOT be replaced

### Requirement: Secret sources are explicit
A secret SHALL come from exactly one source:
- **generated**: `generate: { bytes }`, created when the service is added;
- **user-entered**: through the secret write route, or
  `pi-dashboard service secret set <id> <name>` reading the value from stdin and
  never from argv;
- **imported**: through an explicit user action naming the source file.

The dashboard SHALL NOT read third-party configuration files for secrets without
such an action, and SHALL NOT offer any surface that returns a stored secret
value.

#### Scenario: Generated secret on add
- **WHEN** a service whose definition declares `secrets.password.generate` is added
- **THEN** a random value SHALL be stored under `<id>/password`
- **AND** the add response SHALL report `configured: true` without the value

#### Scenario: CLI secret entry does not use argv
- **WHEN** `pi-dashboard service secret set obs password` runs with the value on stdin
- **THEN** the value SHALL be stored
- **AND** it SHALL NOT appear in any process argv

### Requirement: Secret references and resolvers
A definition SHALL reference secrets as `store:<id>/<name>`, `env:<NAME>`, or
`keychain:<service>/<account>`. The `keychain:` resolver SHALL be read-only: on
macOS via `security find-generic-password … -w`, on Linux via
`secret-tool lookup`, both resolved through `ToolRegistry` and run with a 10 s
timeout. The dashboard SHALL NOT write keychain entries. A ref that cannot be
resolved (binary missing, keyring locked, no session bus, unsupported OS,
timeout) SHALL make the service `unavailable` with reason `secret-unavailable`,
and SHALL NOT fall back to another backend.

#### Scenario: Keychain ref on Linux without a session bus
- **WHEN** a service references `keychain:pi-dashboard/obs` and `secret-tool` cannot reach a keyring
- **THEN** `ensure` SHALL report `unavailable` with reason `secret-unavailable`
- **AND** the store file SHALL NOT be consulted for that secret

#### Scenario: Keychain ref on Windows
- **WHEN** a service references a `keychain:` secret on win32
- **THEN** `ensure` SHALL report `unavailable` with reason `secret-unavailable`

### Requirement: Secret values never leave the delivery channel
No secret value SHALL appear in any `ensure` payload, REST response, CLI output,
log line, error message, process argv, or container `inspect` output. REST and
CLI SHALL report only `configured: boolean` per secret name. Secret write and
import routes SHALL accept only authenticated or locally trusted callers
(honouring strict local-proof mode), and SHALL NOT echo the value. A child
process launched through `service exec` receives secret values by design. Its
own output is outside this requirement.

#### Scenario: ensure carries no secret
- **WHEN** `ensure` is called for a service with a configured password
- **THEN** the payload SHALL contain no secret value

#### Scenario: Trusted-network unauthenticated secret write rejected
- **WHEN** an unauthenticated caller from a configured trusted network writes a secret
- **THEN** the write SHALL be rejected and the store SHALL be unchanged

### Requirement: Container secret delivery uses mounted files
For OCI services, each secret SHALL be written to
`~/.pi/dashboard/services-run/<id>/secrets/<name>` (directory `0700`, file
`0600`) and mounted read-only at `/run/secrets/<name>`. The OCI driver SHALL NOT
pass secret values with `-e` or `--env-file`. A definition MAY set a non-secret
env var whose value is the mount path. The secrets directory SHALL be removed
when the service is removed.

#### Scenario: Secret absent from container inspect
- **WHEN** a managed OCI service with a stored secret is started
- **THEN** the secret value SHALL NOT appear in the runtime's `inspect` output for that container
- **AND** the container SHALL be able to read it at `/run/secrets/<name>`

### Requirement: Process secret delivery via child env only
For native and attached start commands, and for `pi-dashboard service exec`,
secrets SHALL be injected only into the spawned child's environment. For `exec`
the name SHALL be `SVC_<ID>_<NAME>` (uppercased, with non-alphanumerics replaced
by `_`). For start commands it SHALL be the definition's declared env names.
Secrets SHALL NOT appear in the child's argv or in the calling process's
environment.

#### Scenario: exec injects into the child only
- **WHEN** `pi-dashboard service exec obs -- node script.js` runs
- **THEN** `script.js` SHALL see `SVC_OBS_PASSWORD`
- **AND** the value SHALL NOT appear in any process argv
- **AND** the invoking shell's environment SHALL NOT contain it
