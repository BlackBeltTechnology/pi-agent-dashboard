## ADDED Requirements

### Requirement: `ServerPluginContext` exposes a state-guarded file read

`ServerPluginContext` SHALL expose an optional `readFileGuarded(absPath): Promise<string | null>` for plugin routes that return file content. It SHALL apply the credential-and-state refusal of `trust-and-credential-boundaries` on the real path and answer `null` for a refused file, otherwise the UTF-8 content read through the opened-handle recheck. It SHALL NOT be trust-gated, and a plugin route that needs it SHALL refuse when it is absent.

#### Scenario: A credential file reads as refused
- **WHEN** a plugin route calls `readFileGuarded` with `~/.pi/agent/auth.json`, or a symlink resolving to it
- **THEN** the call SHALL resolve `null` and no bytes SHALL be returned

#### Scenario: The trust-gated state tier follows the request's caller
- **WHEN** a plugin route running for an unproven bare-loopback caller calls `readFileGuarded` with `~/.pi/dashboard/config.json`
- **THEN** the call SHALL resolve `null`
- **AND** for a locally trusted caller the same call SHALL return the content

#### Scenario: An ordinary file is returned
- **WHEN** a plugin route calls `readFileGuarded` with a regular file outside the state directory and the credential set
- **THEN** the call SHALL resolve the file's UTF-8 content

#### Scenario: A swapped-in credential file is refused after open
- **WHEN** the path is replaced by a link to a credential file between the real-path decision and the open
- **THEN** the call SHALL resolve `null` because the opened handle matches the credential file

#### Scenario: Other failures reject as filesystem errors
- **WHEN** a plugin route calls `readFileGuarded` with a path that does not exist
- **THEN** the call SHALL reject with the ordinary filesystem error, not resolve `null`

#### Scenario: Untrusted plugins may use it
- **WHEN** a plugin that is not trusted calls `readFileGuarded`
- **THEN** the call SHALL behave as for a trusted plugin

#### Scenario: Absent capability degrades, never reads directly
- **WHEN** a plugin route runs against a context without `readFileGuarded`
- **THEN** it SHALL refuse the request
- **AND** it SHALL NOT read the path with plain filesystem calls
