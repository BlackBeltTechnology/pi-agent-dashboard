## MODIFIED Requirements

### Requirement: Optional git diff enrichment
When the session cwd is a git repository, the server SHALL optionally include aggregate `git diff HEAD` output per file AND optional per-file and aggregate line-change counts derived from `git diff --numstat HEAD`.

#### Scenario: Git repo with uncommitted changes
- **WHEN** the session cwd is a git repository
- **AND** a file has uncommitted changes vs HEAD
- **THEN** the file entry SHALL include `gitDiff` with the unified diff output from `git diff HEAD -- <path>`
- **AND** the file entry SHALL include `additions` and `deletions` (non-negative integers) from `git diff --numstat HEAD`
- **AND** the response SHALL include `totalAdditions` and `totalDeletions` summing all files
- **AND** `isGitRepo` SHALL be `true`

#### Scenario: Non-git repository
- **WHEN** the session cwd is not a git repository
- **THEN** `isGitRepo` SHALL be `false`
- **AND** no `gitDiff` fields SHALL be present
- **AND** `additions`, `deletions`, `totalAdditions`, `totalDeletions` SHALL be absent

#### Scenario: Git not available or errors
- **WHEN** git commands fail (e.g., corrupted repo, git not installed)
- **THEN** the endpoint SHALL still return the event-based changes with `isGitRepo: false`
- **AND** SHALL NOT fail the request
- **AND** SHALL omit the numstat-derived count fields

#### Scenario: Binary or unmergeable file in numstat
- **WHEN** `git diff --numstat` reports `-` for additions/deletions (binary file)
- **THEN** the file entry SHALL omit `additions`/`deletions` rather than emit a non-numeric value
- **AND** that file SHALL NOT contribute to `totalAdditions`/`totalDeletions`
