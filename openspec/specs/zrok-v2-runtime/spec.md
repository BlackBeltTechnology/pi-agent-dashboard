# zrok-v2-runtime Specification

## Purpose
Headless zrok v2 enrollment plus runtime diagnostics (dual-binary resolution, api-v2 reachability, version compatibility).
## Requirements
### Requirement: Headless server-side enrollment
The whitelisted enroll executor SHALL run zrok enrollment with the `--headless` flag so it
never blocks on a TTY when executed server-side. The command SHALL be
`<resolved-zrok> enable <token> --headless`, where `<resolved-zrok>` is `zrok2` (preferred) or
`zrok` (fallback). The token SHALL remain a single validated argv element (allow-list regex,
never string-interpolated); `--headless` SHALL be a fixed literal, not a parameter. The token
validator SHALL accept a real v2 account token, which is as short as 12 characters (the
allow-list charset and the no-cmd.exe-metacharacter property are unchanged; only the minimum
length bound is lowered from 20 to 8).

#### Scenario: Enrollment runs headless
- **WHEN** the server executes the `zrok:auth-token` enroll recipe with a valid token
- **THEN** it SHALL invoke `enable <token> --headless` and SHALL NOT open `/dev/tty`

#### Scenario: Real 12-char v2 token accepted
- **WHEN** the token is a valid 12-character v2 account token
- **THEN** the validator SHALL accept it (it is no longer rejected by a min-length-20 bound)

#### Scenario: Invalid token rejected before spawn
- **WHEN** a token fails the allow-list validator (metacharacters, or outside 8–200 chars)
- **THEN** the executor SHALL refuse without spawning any process

#### Scenario: Binary resolution for enroll
- **WHEN** only `zrok2` is present (or only `zrok`)
- **THEN** the enroll executor SHALL use whichever resolves

### Requirement: api-v2 endpoint reachability check
The Doctor "zrok API reachable" check SHALL probe `api-v2.zrok.io`. When the machine is
enrolled, it SHALL prefer the `api_endpoint` recorded in the zrok environment file (so a
self-hosted or pinned controller is probed instead of the hosted default).

#### Scenario: Hosted default
- **WHEN** the machine is not enrolled (no environment file)
- **THEN** the check SHALL resolve `api-v2.zrok.io`

#### Scenario: Enrolled machine with recorded endpoint
- **WHEN** the environment file records `api_endpoint`
- **THEN** the check SHALL probe that host

#### Scenario: DNS failure
- **WHEN** the target host does not resolve
- **THEN** the check SHALL report a failure with a network/DNS remediation suggestion

### Requirement: zrok version compatibility check
Doctor SHALL include a "zrok version compatible" check that runs `<resolved-zrok> version`,
parses the semantic version, and reports compatibility with the hosted service. A major
version below 2 SHALL be reported as a warning with an upgrade remedy, because an outdated v1
client fails against the deprecated `api-v1.zrok.io` with an opaque HTTP 500 on enable and
share creation. Unparseable output SHALL degrade to a warning (unknown), never a hard crash.

#### Scenario: v2 client
- **WHEN** `zrok version` reports `v2.x` (including a `2.0.0-rc.N` pre-release)
- **THEN** the check SHALL report `ok`

#### Scenario: pre-v2 client (root cause of the 500)
- **WHEN** `zrok version` reports a version below `2.0.0` (zrok v1 shipped as the `0.4.x` line; there was no `1.x`)
- **THEN** the check SHALL report a warning with the remedy to upgrade (`brew upgrade zrok`, or re-download the `zrok2` release) and note that the deprecated `api-v1.zrok.io` returns 500 for outdated clients

#### Scenario: Unparseable version
- **WHEN** `zrok version` output cannot be parsed into a semver
- **THEN** the check SHALL report a warning (unknown version) and SHALL NOT throw

#### Scenario: Binary missing
- **WHEN** neither `zrok2` nor `zrok` resolves
- **THEN** the version check SHALL defer to the "zrok binary" check and report unavailable rather than error

