## Purpose

Extract per-session file changes from the event stream and expose them over a
localhost-only REST endpoint, optionally enriched with git diff output and
`git diff --numstat` line counts.
## Requirements
### Requirement: Session diff REST endpoint
The server SHALL expose `GET /api/session-diff?sessionId=<id>` (localhost-only) that returns the list of changed files with their individual change events for a given session.

#### Scenario: Successful response
- **WHEN** `GET /api/session-diff?sessionId=xxx` is called for a valid session
- **THEN** the response SHALL return `{ success: true, data: { files: [...], isGitRepo: boolean } }`
- **AND** each file entry SHALL contain `path` (relative to cwd), `changes` (array of change events), and optionally `gitDiff` (unified diff string from `git diff HEAD` when available)

#### Scenario: Session not found
- **WHEN** the sessionId does not exist
- **THEN** the response SHALL return `{ success: false, error: "session not found" }`

#### Scenario: Missing sessionId parameter
- **WHEN** the sessionId query parameter is missing
- **THEN** the response SHALL return `{ success: false, error: "sessionId required" }`

### Requirement: Event-based change extraction
The server SHALL scan session events from the event store to extract individual file change events. Each change event SHALL include the timestamp, tool type, and tool-specific data.

#### Scenario: Edit tool change
- **WHEN** a `tool_execution_start` event has `toolName` matching "Edit" (case-insensitive)
- **THEN** the change event SHALL include `type: "edit"`, `timestamp`, `path` (from `args.path` or `args.file_path`), and `edits` (array of `{ oldText, newText }` from `args.edits`)

#### Scenario: Write tool change
- **WHEN** a `tool_execution_start` event has `toolName` matching "Write" (case-insensitive)
- **THEN** the change event SHALL include `type: "write"`, `timestamp`, `path` (from `args.path` or `args.file_path`), and `content` (from `args.content`)

#### Scenario: Duplicate paths grouped
- **WHEN** the same file path appears in multiple tool events
- **THEN** all change events for that path SHALL be grouped under a single file entry, ordered by timestamp

#### Scenario: Context message extraction
- **WHEN** extracting a change event
- **THEN** the server SHALL include a `message` field with a truncated excerpt (max 120 chars) from the most recent assistant `message_end` event preceding the tool call, if available

### Requirement: Filter files outside cwd
The server SHALL exclude file paths that resolve to locations outside the session's cwd.

#### Scenario: Absolute path outside cwd
- **WHEN** a Write/Edit event references an absolute path outside the session cwd (e.g., `/tmp/scratch.ts` when cwd is `/home/user/project`)
- **THEN** that file SHALL NOT be included in the response

#### Scenario: Relative path inside cwd
- **WHEN** a Write/Edit event references a relative path (e.g., `src/foo.ts`)
- **THEN** the path SHALL be included and kept relative to cwd

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

### Requirement: Session file read endpoint
The server SHALL expose `GET /api/session-file?sessionId=<id>&path=<relativePath>` (localhost-only) that reads a file from the session's cwd.

#### Scenario: Successful file read
- **WHEN** the sessionId is valid and the path resolves to a file within the session's cwd
- **THEN** the response SHALL return `{ success: true, data: { content: "..." } }`

#### Scenario: Path outside cwd
- **WHEN** the path resolves to a location outside the session's cwd
- **THEN** the response SHALL return 403 with `{ success: false, error: "path outside session directory" }`

#### Scenario: File not found
- **WHEN** the file does not exist on disk
- **THEN** the response SHALL return 404 with `{ success: false, error: "file not found" }`

#### Scenario: Missing parameters
- **WHEN** sessionId or path is missing
- **THEN** the response SHALL return 400 with `{ success: false, error: "sessionId and path required" }`

