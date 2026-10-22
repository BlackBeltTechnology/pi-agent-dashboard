## MODIFIED Requirements

### Requirement: Known-folder admission

The cwd guard SHALL admit a `cwd` only when it matches the host-provided known-folder set — the union of active session cwds, pinned directories and workspace folders — or is admitted by the git-repo-main rule below, and SHALL reject every other `cwd` whose admission it could decide. When a git probe needed to decide admission fails (timeout, spawn error, missing binary), the guard SHALL neither admit nor reject: the outcome is indeterminate (`plugin-cwd-admission`) and the route SHALL respond `503` with `error: "cwd-admission-unavailable"`. When the host does not provide the known-folder service, the guard SHALL fall back to admitting active session cwds alone.

#### Scenario: Known cwd admitted
- **WHEN** a request carries a `cwd` that is present in the known-folder set
- **THEN** the guard admits it and the operation proceeds to open the store

#### Scenario: Unknown cwd rejected before any disk access
- **WHEN** a request carries a `cwd` that is not in the known-folder set and does not resolve to a git repo whose main working tree is a known folder
- **THEN** the guard responds `403` with body `{ "error": "cwd not allowed" }`
- **AND** no store is opened and no config or trust-store read is performed

#### Scenario: Missing cwd rejected
- **WHEN** a request omits the `cwd` parameter
- **THEN** the guard responds `400` with body `{ "error": "Missing cwd" }`

#### Scenario: Undecidable cwd is neither admitted nor rejected
- **WHEN** a request carries a `cwd` that is not directly known and the git probe deciding its main checkout times out
- **THEN** the route responds `503` with `error: "cwd-admission-unavailable"`
- **AND** no store is opened and no config or trust-store read is performed
