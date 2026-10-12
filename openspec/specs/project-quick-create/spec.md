# project-quick-create Specification

## Purpose
Let a first-time user create a project directory by name alone, without browsing the filesystem. The server resolves a default projects root in the user's home directory and creates or reuses a named directory under it, never outside it.

## Requirements

### Requirement: Create or reuse a named project directory under the default projects root
The server SHALL expose `POST /api/browse/create-project` accepting a JSON body `{ name }`. It SHALL resolve the projects root as the `Projects` directory inside the server user's home directory, create the root when missing, and create `<root>/<name>`. On success it SHALL respond `{ success: true, data: { path, existed } }`, where `path` is the real (symlink-resolved) absolute path of the directory and `existed` reports whether that directory already existed before the call. Every failure SHALL respond `{ success: false, error, reason }`, where `reason` is a stable machine code drawn from `invalid_name`, `reserved_name`, `too_long`, `not_a_directory`, `root_not_a_directory`, `outside_root`, `home_missing` and `fs_error`. No failure SHALL leave a newly created target directory behind. The existing `/api/browse/mkdir` contract is unaffected.

#### Scenario: Fresh machine without a Projects directory
- **GIVEN** the home directory contains no `Projects` entry
- **WHEN** a client posts `{ name: "my-first-project" }`
- **THEN** both `<home>/Projects` and `<home>/Projects/my-first-project` exist afterwards
- **AND** the response is `{ success: true, data: { path: <real path of that directory>, existed: false } }`

#### Scenario: Projects root already present
- **GIVEN** `<home>/Projects` exists and contains no `demo` entry
- **WHEN** a client posts `{ name: "demo" }`
- **THEN** `<home>/Projects/demo` is created and the response reports `existed: false`

#### Scenario: Directory with that name already exists
- **GIVEN** `<home>/Projects/demo` already exists as a directory
- **WHEN** a client posts `{ name: "demo" }`
- **THEN** the response is successful with `existed: true` and the directory's absolute path
- **AND** the directory's contents are unchanged

#### Scenario: A file occupies the target name
- **GIVEN** `<home>/Projects/demo` exists and is a regular file
- **WHEN** a client posts `{ name: "demo" }`
- **THEN** the response status is 409 with `success: false`
- **AND** no filesystem entry is modified

#### Scenario: Home directory missing
- **GIVEN** the server user's home directory does not exist
- **WHEN** a client posts any valid name
- **THEN** the response status is 500 with `reason: "home_missing"` and nothing is created

#### Scenario: Unexpected filesystem error
- **WHEN** creating the target fails for a reason other than those above (for example permission denied)
- **THEN** the response status is 500 with `reason: "fs_error"` and no target directory is left behind

#### Scenario: A file occupies the projects root
- **GIVEN** `<home>/Projects` exists and is a regular file
- **WHEN** a client posts any valid name
- **THEN** the response status is 409 with `success: false`
- **AND** no filesystem entry is modified

### Requirement: Project names are a single portable path segment
The endpoint SHALL accept only a name that is valid on every supported platform: non-empty; no leading or trailing whitespace; not `.` or `..`; no trailing `.`; none of `/ \ : * ? " < > |`; no control character (U+0000–U+001F, U+007F–U+009F); not a Windows-reserved device name (`CON`, `PRN`, `AUX`, `NUL`, `CONIN$`, `CONOUT$`, `COM0`–`COM9`, `LPT0`–`LPT9`, and the superscript-digit variants `COM¹²³` / `LPT¹²³`; case-insensitive, with or without an extension); at most 255 bytes in UTF-8. A missing or non-string name SHALL be rejected before any filesystem access. An invalid name SHALL be rejected with status 400 and no filesystem change. A target the operating system rejects as too long SHALL be rejected with status 400 and no target created.

#### Scenario: Traversal attempt
- **WHEN** a client posts `{ name: "../outside" }`
- **THEN** the response status is 400 with `success: false`
- **AND** nothing is created outside or inside the projects root

#### Scenario: Windows-hostile names
- **WHEN** a client posts a name such as `con`, `aux.txt`, `a:b`, `name.` or one containing a newline
- **THEN** the response status is 400 with `success: false`

#### Scenario: Name too long
- **WHEN** a client posts a name longer than 255 bytes in UTF-8
- **THEN** the response status is 400 with `reason: "too_long"`

#### Scenario: Missing or non-string name
- **WHEN** a client posts `{}` or `{ name: 42 }`
- **THEN** the response status is 400 with `success: false`

### Requirement: The resolved directory stays inside the projects root
The real path of the created or reused directory SHALL be strictly inside (never equal to) the real path of the projects root (the invariant is stated against real paths: a projects root that is itself a symbolic link to a directory SHALL be accepted, and its children live under the link target). A target whose real path is outside the root's real path SHALL be rejected with status 400 and SHALL NOT be reported as success; a directory this request created before detecting the escape SHALL be removed. A target that is a symbolic link resolving to a directory inside the root SHALL be reused like any existing directory.

#### Scenario: Symlinked child escapes the root
- **GIVEN** `<home>/Projects/demo` is a symbolic link to a directory outside `<home>/Projects`
- **WHEN** a client posts `{ name: "demo" }`
- **THEN** the response status is 400 with `success: false`

#### Scenario: Symlinked child inside the root is reused
- **GIVEN** `<home>/Projects/demo` is a symbolic link to `<home>/Projects/real-demo`, a directory
- **WHEN** a client posts `{ name: "demo" }`
- **THEN** the response is successful with `existed: true` and the real path of `real-demo`

#### Scenario: Symlinked child pointing at the root itself
- **GIVEN** `<home>/Projects/demo` is a symbolic link to `<home>/Projects`
- **WHEN** a client posts `{ name: "demo" }`
- **THEN** the response status is 400 with `reason: "outside_root"`

#### Scenario: Dangling symlink at the projects root
- **GIVEN** `<home>/Projects` is a symbolic link whose target does not exist
- **WHEN** a client posts any valid name
- **THEN** the response status is 409 with `reason: "root_not_a_directory"` and nothing is created

#### Scenario: Dangling symlink at the target name
- **GIVEN** `<home>/Projects/demo` is a symbolic link whose target does not exist
- **WHEN** a client posts `{ name: "demo" }`
- **THEN** the response status is 409 and nothing is created

#### Scenario: Symlinked root is allowed
- **GIVEN** `<home>/Projects` is a symbolic link to an existing directory elsewhere
- **WHEN** a client posts `{ name: "demo" }`
- **THEN** `demo` is created inside the link target and the response is successful

### Requirement: The endpoint is guarded and tiered like directory creation
`POST /api/browse/create-project` SHALL be protected by the same network guard as the other `/api/browse/*` routes and SHALL be assigned the same route tier as `POST /api/browse/mkdir`. A request rejected by either gate SHALL NOT create any directory.

#### Scenario: Untrusted request
- **WHEN** a request the network guard rejects reaches the endpoint
- **THEN** it is rejected and no directory is created

#### Scenario: Insufficient tier
- **WHEN** a caller whose credentials do not reach the directory-creation tier posts to the endpoint
- **THEN** it is rejected and no directory is created
