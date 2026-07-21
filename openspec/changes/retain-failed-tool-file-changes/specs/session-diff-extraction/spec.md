## ADDED Requirements

### Requirement: File-affecting tool failures remain correlated with changed files

The session-diff extractor SHALL pair file-mutation lifecycle events by `toolCallId` and SHALL return correlated failures in optional `data.fileOperationFailures`. Each failure SHALL contain `toolCallId`, `toolName`, `timestamp`, `kind`, a bounded plain-text `message`, and normalized cwd-relative `affectedPaths` that also exist in `data.files` or `data.otherChanges`.

#### Scenario: Failed direct write retains its changed file

- **WHEN** a Write or Edit `tool_execution_start` identifies a path, the same `toolCallId` ends with `isError: true`, and the path remains changed
- **THEN** the path SHALL remain in the changed-file response
- **AND** `fileOperationFailures` SHALL contain one `kind: "error"` entry for that `toolCallId` and path

#### Scenario: One failed operation affects multiple files

- **WHEN** one mutation tool call partially changes multiple files before failing
- **THEN** the server SHALL return one failure entry with every evidenced changed path in `affectedPaths`
- **AND** it SHALL NOT duplicate the failure once per file

#### Scenario: One file is touched by multiple failed operations

- **WHEN** multiple failed mutation calls with distinct `toolCallId` values affect the same changed file
- **THEN** the server SHALL retain one failure entry per tool call
- **AND** each entry SHALL include the shared path

#### Scenario: Unrelated failure is not attached by proximity

- **WHEN** a non-file tool fails after a file changed, or a mutation failure has no path evidence for that file
- **THEN** the server SHALL NOT attach the failure to the file based only on event order or timestamp proximity

#### Scenario: Mutation failure without a changed path stays out of session diff

- **WHEN** a file-mutation tool fails before changing any path represented by `files` or `otherChanges`
- **THEN** `fileOperationFailures` SHALL omit that failure
- **AND** the existing chat error surface SHALL remain its owner

#### Scenario: Orphan or incomplete lifecycle is not fabricated

- **WHEN** a tool end has no `toolCallId` or no matching start, or a mutation start has no end
- **THEN** the server SHALL NOT fabricate a correlated file-operation failure

### Requirement: Structured partial failures count as file-operation failures

The session-diff extractor SHALL treat `details.status: "partial_failure"` as a failed file operation even when pi emits `isError: false`. It SHALL accept details from the replay top-level field or the live `result.details` field and SHALL prefer structured applied/changed paths over intended or failed-only paths.

#### Scenario: Codex apply_patch partially succeeds

- **WHEN** `apply_patch` returns `isError: false` with `details.status: "partial_failure"`, `appliedFiles`, `failedFiles`, and an error message
- **THEN** changed paths from `appliedFiles` SHALL remain session-owned and appear in the diff
- **AND** the response SHALL contain one `kind: "partial_failure"` failure associated with those applied paths

#### Scenario: Failed-only patch target does not create a file row

- **WHEN** partial-failure details name a `failedFiles` path that is absent from the final changed-file set
- **THEN** that path SHALL NOT be synthesized as a changed file
- **AND** it SHALL NOT appear in the failure's `affectedPaths`

#### Scenario: Live and replay result shapes normalize identically

- **WHEN** equivalent live and replay events describe the same partial file operation
- **THEN** session-diff extraction SHALL return equivalent failure kind, message, and affected paths

#### Scenario: isError takes precedence over partial status

- **WHEN** the same tool end contains `isError: true` and `details.status: "partial_failure"`
- **THEN** the normalized failure kind SHALL be `error`

#### Scenario: Unknown structured status is not guessed

- **WHEN** a result has `isError !== true` and a structured status other than `partial_failure`
- **THEN** the server SHALL NOT infer a failure from that status alone

### Requirement: Shipped mutation tool aliases share detection and ownership rules

The dashboard SHALL classify shipped file-mutation tools without inspecting provider or model ids. Matching SHALL be case-insensitive and SHALL cover direct-file names (`write`, `edit`, `strreplace`), shell names (`bash`, `shell`, `exec_command`), and patch name (`apply_patch`).

#### Scenario: Grok StrReplace uses direct path evidence

- **WHEN** a `StrReplace` call identifies a changed in-cwd path and its matching result fails
- **THEN** the server SHALL normalize and correlate that path using the direct-file rules

#### Scenario: Grok Shell output survives non-zero exit

- **WHEN** a `Shell` call creates or modifies an in-cwd file and ends with `isError: true`
- **THEN** explicit output-token evidence SHALL allow the file to remain session-owned
- **AND** the matching failure SHALL reference that changed path

#### Scenario: Unstructured patch intent is not treated as proof

- **WHEN** `apply_patch` lacks structured applied or changed paths
- **THEN** the server SHALL NOT parse patch prose or intended target headers to attach a file failure

#### Scenario: Non-git direct or applied path is discovered

- **WHEN** a non-git session has an existing in-cwd path evidenced by StrReplace direct args or structured apply_patch applied paths
- **THEN** the path SHALL be eligible for the changed-file response without git status
- **AND** failed-only or nonexistent intended targets SHALL remain excluded

#### Scenario: Mtime alone cannot attach a failure

- **WHEN** a changed file has only execution-window mtime evidence and no exact candidate path for a failed tool call
- **THEN** the server SHALL NOT attach that failure to the file

#### Scenario: Candidate path escapes cwd

- **WHEN** direct args, structured details, or shell output tokens contain an absolute out-of-cwd path or traversal path
- **THEN** the existing cwd-containment normalization SHALL reject it before correlation

### Requirement: Failure payload remains additive and bounded

`fileOperationFailures` SHALL be optional, SHALL contain no raw tool arguments or unrestricted structured details, and SHALL deduplicate repeated live/replay end events by `toolCallId`. Failure messages SHALL be plain text with terminal control sequences removed and a fixed maximum length.

#### Scenario: Client predates failure field

- **WHEN** an older client receives a session-diff response containing `fileOperationFailures`
- **THEN** all existing response fields SHALL retain their prior meaning and shape

#### Scenario: Oversized error output is bounded

- **WHEN** a failed mutation result contains oversized output or terminal control sequences
- **THEN** the API SHALL return a capped plain-text message
- **AND** it SHALL NOT expose raw args or complete result details

#### Scenario: Empty error output receives a safe fallback

- **WHEN** a correlated failed operation has no result text or structured error text
- **THEN** its message SHALL be the non-empty plain-text label `<toolName> failed`
- **AND** a missing or blank tool name SHALL use `Tool operation failed`

#### Scenario: Duplicate end event is replayed

- **WHEN** the event set contains repeated end records for the same `toolCallId`
- **THEN** `fileOperationFailures` SHALL contain at most one entry for that tool call
- **AND** the latest end timestamp SHALL win
- **AND** equal timestamps SHALL resolve by a stable content-based precedence independent of event-array order

#### Scenario: File cap removes an affected path

- **WHEN** an affected path is removed by the existing changed-file response cap
- **THEN** the server SHALL remove that path from `affectedPaths`
- **AND** it SHALL drop any failure left with no surviving affected path

#### Scenario: Failure cardinality is bounded

- **WHEN** more than 100 correlated failures or more than 50 affected paths for one failure survive extraction
- **THEN** the response SHALL retain at most the 100 newest failures and 50 normalized paths per failure
- **AND** ordering SHALL be deterministic
