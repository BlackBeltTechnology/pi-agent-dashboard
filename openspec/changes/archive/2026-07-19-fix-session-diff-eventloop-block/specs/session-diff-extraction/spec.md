## MODIFIED Requirements

### Requirement: Optional git diff enrichment

When the session cwd is a git repository, the server SHALL optionally include aggregate `git diff HEAD` output per file AND optional per-file and aggregate line-change counts derived from `git diff --numstat HEAD`. Git-diff enrichment for the session-diff request path SHALL be computed **without blocking the Node event loop**: no synchronous git subprocess (`spawnSync`) SHALL run on the `GET /api/session-diff` request path. Per-file content diffs SHALL be produced from a **single** batched `git diff` invocation over the worktree (not one subprocess per changed file), split per file. A tracked file whose diff or on-disk blob exceeds `TRACKED_DIFF_MAX_BYTES` SHALL be listed with its numstat `additions`/`deletions` but no text `gitDiff`.

#### Scenario: Git repo with uncommitted changes
- **WHEN** the session cwd is a git repository
- **AND** a file has uncommitted changes vs HEAD
- **THEN** the file entry SHALL include `gitDiff` with the unified diff output for that file
- **AND** the file entry SHALL include `additions` and `deletions` (non-negative integers) from `git diff --numstat HEAD`
- **AND** the response SHALL include `totalAdditions` and `totalDeletions` summing all files
- **AND** `isGitRepo` SHALL be `true`

#### Scenario: Content diffs come from one batched spawn
- **WHEN** the session has N (N > 1) changed tracked files
- **THEN** the server SHALL compute all per-file content diffs from a single `git diff` subprocess over the worktree
- **AND** it SHALL NOT spawn one `git diff -- <path>` subprocess per changed file

#### Scenario: No synchronous git spawn on the request path
- **WHEN** `GET /api/session-diff` computes enrichment for a git repo
- **THEN** every git subprocess it runs SHALL be asynchronous (non-blocking)
- **AND** no `spawnSync` git call SHALL be reachable from the session-diff request handler

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
- **AND** that file SHALL omit `gitDiff`

## ADDED Requirements

### Requirement: Event-loop responsiveness under heavy session diffs

Computing `GET /api/session-diff` for a session with many changed files and/or a very large tracked file SHALL NOT starve other HTTP requests. While a heavy diff is computed, unrelated endpoints (`/api/health`, static `GET /`, settings, prompt submission) SHALL remain responsive.

#### Scenario: Health stays responsive while a heavy diff computes
- **WHEN** a session cwd has hundreds of changed files and/or a tracked file larger than 100 MB
- **AND** `GET /api/session-diff` is computing that session's diff
- **THEN** a concurrent `GET /api/health` SHALL respond within a small latency budget (e.g. < 100 ms)
- **AND** the server SHALL NOT be wedged after the diff completes

#### Scenario: Repeated polls do not snowball
- **WHEN** multiple browser tabs / reconnects poll the same heavy session's diff concurrently
- **THEN** the server SHALL NOT accumulate one git spawn per poll per file
- **AND** HTTP request handling SHALL NOT stall into an unrecoverable spawn storm

### Requirement: Tracked-file diff size cap

The server SHALL enforce a byte cap `TRACKED_DIFF_MAX_BYTES` on tracked-file content diffs, analogous to the existing `SYNTHETIC_DIFF_MAX_BYTES` cap for synthetic new-file diffs. A tracked file whose diff (or on-disk blob) exceeds the cap SHALL be surfaced without a text `gitDiff`, and SHALL NOT be read as utf-8 or fed to `git diff` for text rendering.

#### Scenario: Oversized tracked file is not rendered as a text diff
- **WHEN** a tracked changed file's diff or blob exceeds `TRACKED_DIFF_MAX_BYTES` (e.g. a 992 MB `.tar`)
- **THEN** its entry SHALL be listed with any available `additions`/`deletions` from numstat
- **AND** its entry SHALL omit `gitDiff`
- **AND** the server SHALL NOT read the file as utf-8 nor run a per-file `git diff` to render it

#### Scenario: Normal-sized tracked file still shows a diff
- **WHEN** a tracked changed file's diff is below `TRACKED_DIFF_MAX_BYTES`
- **THEN** its entry SHALL include the unified `gitDiff` text as before

### Requirement: Session-diff result cache and single-flight

The server SHALL cache session-diff results per session for a short TTL, keyed by a signature that changes when the diff would change (e.g. HEAD sha + dirty-file signature). Concurrent requests for the same key SHALL coalesce onto one in-flight computation (single-flight) rather than each launching its own diff.

#### Scenario: Cache hit within TTL avoids recompute
- **WHEN** two `GET /api/session-diff` requests for the same session arrive within the cache TTL
- **AND** the session's HEAD and dirty state are unchanged between them
- **THEN** the second request SHALL return the cached result without recomputing the diff

#### Scenario: Concurrent identical requests coalesce
- **WHEN** two identical session-diff requests are in flight simultaneously for the same key
- **THEN** the server SHALL compute the diff once and serve both from that single computation

#### Scenario: State change busts the cache
- **WHEN** the session's HEAD sha or dirty-file signature changes
- **THEN** the next request SHALL recompute the diff rather than serve a stale cached entry
