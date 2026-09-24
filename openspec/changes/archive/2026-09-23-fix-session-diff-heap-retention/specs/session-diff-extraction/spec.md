## ADDED Requirements

### Requirement: Cached session diffs do not retain the whole-worktree diff

Memory held by a cached session-diff result SHALL be proportional to that result's own content. A cached per-file text diff SHALL NOT keep the whole-worktree diff output alive, so retention does not grow with `whole-worktree diff size × cached results`. At most one whole-worktree diff output (the most recent) MAY remain transiently reachable through runtime-internal state after its request completes, and its size is bounded by the batched-diff output limit.

#### Scenario: Small cached diff does not retain the batched diff
- **WHEN** the whole-worktree diff is large but within the batched-diff output limit (e.g. 30 MB) and contains a small renderable diff for another changed file (e.g. under 1 KB)
- **AND** the session diff has been computed and cached, every other reference to the whole-worktree diff output has been released, and runtime-internal last-match state no longer refers to it
- **THEN** the heap retained by the cached result SHALL be far below the whole-worktree diff size (e.g. < 5 MB after garbage collection)
- **AND** the small file's `gitDiff` text SHALL be byte-identical to what it was before this change

#### Scenario: Many cached generations do not multiply retention
- **WHEN** N session-diff results are cached, each computed from a distinct large whole-worktree diff
- **THEN** heap retained by the cache SHALL NOT grow with N × the whole-worktree diff size

## MODIFIED Requirements

### Requirement: Optional git diff enrichment

When the session cwd is a git repository, the server SHALL optionally include aggregate `git diff HEAD` output per file AND optional per-file and aggregate line-change counts derived from `git diff --numstat HEAD`. Git-diff enrichment for the session-diff request path SHALL be computed **without blocking the Node event loop**: no synchronous git subprocess (`spawnSync`) SHALL run on the `GET /api/session-diff` request path. Per-file content diffs SHALL be produced from a **single** batched `git diff` invocation over the worktree (not one subprocess per changed file), split per file. A tracked file whose diff or on-disk blob exceeds `TRACKED_DIFF_MAX_BYTES` SHALL be listed with its numstat `additions`/`deletions` but no text `gitDiff`. When the batched `git diff` output exceeds the batched-diff output limit, tracked files SHALL be listed with numstat counts but no text `gitDiff` (see "Tracked-file diff size cap").

#### Scenario: Git repo with uncommitted changes
- **WHEN** the session cwd is a git repository
- **AND** a file has uncommitted changes vs HEAD
- **AND** the whole-worktree batched diff output is within the batched-diff output limit
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

### Requirement: Tracked-file diff size cap

The server SHALL enforce a byte cap `TRACKED_DIFF_MAX_BYTES` on tracked-file content diffs, analogous to the existing `SYNTHETIC_DIFF_MAX_BYTES` cap for synthetic new-file diffs. A tracked file whose diff (or on-disk blob) exceeds the cap SHALL be surfaced without a text `gitDiff`, and SHALL NOT be read as utf-8 or fed to `git diff` for text rendering. The server SHALL also enforce a batched-diff output limit on the single whole-worktree `git diff`: once its output exceeds the limit, the server SHALL stop collecting it and terminate that subprocess, SHALL surface every tracked file with numstat counts but without a text `gitDiff`, and SHALL log a warning naming the session cwd and the limit, at most once per cwd within a throttle window (e.g. 10 minutes).

#### Scenario: Oversized tracked file is not rendered as a text diff
- **WHEN** a tracked changed file's diff or blob exceeds `TRACKED_DIFF_MAX_BYTES` (e.g. a 992 MB `.tar`)
- **THEN** its entry SHALL be listed with any available `additions`/`deletions` from numstat
- **AND** its entry SHALL omit `gitDiff`
- **AND** the server SHALL NOT read the file as utf-8 nor run a per-file `git diff` to render it

#### Scenario: Normal-sized tracked file still shows a diff
- **WHEN** a tracked changed file's diff is below `TRACKED_DIFF_MAX_BYTES`
- **AND** the whole-worktree batched diff output is within the batched-diff output limit
- **THEN** its entry SHALL include the unified `gitDiff` text as before

#### Scenario: Oversized batched diff degrades to counts only
- **WHEN** a session cwd's whole-worktree diff output exceeds the batched-diff output limit (e.g. a tracked, single-line, multi-megabyte generated file is modified)
- **THEN** `GET /api/session-diff` SHALL still succeed and list the changed files with numstat `additions`/`deletions`
- **AND** tracked-file entries SHALL omit `gitDiff`
- **AND** untracked new files SHALL keep their synthetic diffs
- **AND** the server SHALL log a warning naming the cwd and the limit
- **AND** the server SHALL NOT buffer diff output beyond the limit

#### Scenario: Oversized-diff warning is throttled
- **WHEN** repeated session-diff recomputes for the same cwd each exceed the batched-diff output limit within the throttle window
- **THEN** the server SHALL log the warning once for that cwd, not once per recompute

### Requirement: Session-diff result cache and single-flight

The server SHALL cache session-diff results per session for a short TTL, keyed by a signature that changes when the diff would change (HEAD sha + dirty-file signature + event-source signature: transcript size/mtime when the session is eligible for transcript sourcing, else the count of Write/Edit/Bash tool-call start events in the in-memory stream). Concurrent requests for the same key SHALL coalesce onto one in-flight computation (single-flight) rather than each launching its own diff. A cache hit SHALL NOT read or parse the transcript. The cache is shared by all sessions and SHALL enforce a total byte budget, estimated over each result's full content, in addition to its entry-count cap. It SHALL evict the oldest entries first and always keep the most recently stored entry, so a fresh entry can be evicted early by other sessions' inserts. The estimated retained cache size SHALL NOT exceed the larger of the budget and the newest entry's estimated size, where the estimate SHALL count every string in a result at no less than two bytes per character. Expired entries SHALL be released no later than the next cache access.

#### Scenario: Cache hit within TTL avoids recompute
- **WHEN** two `GET /api/session-diff` requests for the same session arrive within the cache TTL
- **AND** the session's HEAD, dirty state and transcript are unchanged between them
- **AND** the entry has not been evicted by the byte budget or entry cap in between
- **THEN** the second request SHALL return the cached result without recomputing the diff

#### Scenario: Concurrent identical requests coalesce
- **WHEN** two identical session-diff requests are in flight simultaneously for the same key
- **THEN** the server SHALL compute the diff once and serve both from that single computation

#### Scenario: State change busts the cache
- **WHEN** the session's HEAD sha or dirty-file signature changes
- **THEN** the next request SHALL recompute the diff rather than serve a stale cached entry

#### Scenario: New tool call on an already-dirty file busts the cache
- **WHEN** the session records a new Write/Edit call against a file that was already dirty (so the dirty-file signature does not change)
- **THEN** the next request SHALL recompute the diff and include the new change event

#### Scenario: Cache hit does not touch the transcript
- **WHEN** a second `GET /api/session-diff` for the same key arrives within the TTL
- **THEN** the server SHALL NOT read or parse the transcript for that request

#### Scenario: Store-sourced session invalidates on a new tool call
- **WHEN** a session is served from the in-memory event stream and records a new Write/Edit/Bash tool-call start event
- **THEN** the next request SHALL recompute rather than serve the cached result

#### Scenario: Streaming text alone does not bust the cache
- **WHEN** a session is streaming an assistant response with no new tool call, and HEAD and dirty state are unchanged
- **AND** the entry has not been evicted by the byte budget or entry cap in between
- **THEN** a second request within the TTL SHALL be served from the cache

#### Scenario: Cache stays within its byte budget
- **WHEN** successive session-diff results are cached whose combined estimated size exceeds the cache byte budget
- **THEN** the cache SHALL evict the oldest entries until its total estimated size is within the budget, or only the newest entry remains

#### Scenario: A single over-budget result stays cached until displaced
- **WHEN** one session-diff result's estimated size alone exceeds the cache byte budget
- **AND** no other result is stored before a repeat request for the same key within the TTL
- **THEN** that repeat request SHALL be served from the cache without recomputing

#### Scenario: Expired entries are released on access
- **WHEN** a cached session-diff entry's TTL has elapsed
- **AND** any later cache access occurs, even with fewer entries than the entry-count cap
- **THEN** the expired entry SHALL no longer be held by the cache
