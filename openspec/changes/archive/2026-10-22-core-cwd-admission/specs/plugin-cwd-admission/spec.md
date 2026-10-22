## ADDED Requirements

### Requirement: A non-directory cwd is refused, not indeterminate
The shared admission guard SHALL refuse a `cwd` that exists but is not a directory (for example a regular file inside a known repository). A git probe that cannot start because the `cwd` is not a directory (`ENOTDIR`) SHALL be read as "not a repository", never as a failed probe, so the guard SHALL NOT report such a `cwd` as `indeterminate`.

#### Scenario: Regular file inside a known repository
- **WHEN** the `cwd` names a regular file inside a repository whose main checkout is a known folder
- **THEN** the guard returns `refuse`
- **AND** the route responds with its refusal, not `503`
