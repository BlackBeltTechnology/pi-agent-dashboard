## ADDED Requirements

### Requirement: Bounded session-diff memory retention

The server SHALL bound the heap memory retained by session-diff computation and caching. Memory held by a cached session-diff result SHALL be proportional to that result's own content: a cached per-file text diff SHALL NOT keep the whole-worktree diff output alive. The session-diff result cache SHALL enforce a total byte budget in addition to its entry-count cap, and SHALL release expired entries no later than the next cache access. When the whole-worktree diff output exceeds a configured byte limit, the server SHALL stop collecting it, SHALL serve the session diff with numstat counts but without tracked-file text diffs, and SHALL log a warning identifying the session cwd and the limit.

#### Scenario: Small cached diff does not retain the batched diff
- **WHEN** the whole-worktree diff is large (e.g. 50 MB) and contains a small renderable diff for another changed file (e.g. under 1 KB)
- **AND** the server has computed and cached the session diff, and every other reference to the whole-worktree diff output has been released
- **THEN** the heap retained by the cached result SHALL be far below the whole-worktree diff size (e.g. < 5 MB after garbage collection)
- **AND** the small file's `gitDiff` text SHALL be byte-identical to what it was before this change

#### Scenario: Cache stays within its byte budget
- **WHEN** successive session-diff results are cached whose combined size exceeds the cache byte budget
- **THEN** the cache SHALL evict oldest entries until its total estimated size is within the budget
- **AND** a single result larger than the whole budget SHALL be returned to its requester but SHALL NOT remain cached

#### Scenario: Expired entries are released on access
- **WHEN** a cached session-diff entry's TTL has elapsed
- **AND** any later cache access occurs, even with fewer entries than the entry-count cap
- **THEN** the expired entry SHALL no longer be held by the cache

#### Scenario: Oversized batched diff degrades to counts only
- **WHEN** a session cwd's whole-worktree diff output exceeds the configured byte limit (e.g. a tracked, single-line, multi-megabyte generated file is modified)
- **THEN** `GET /api/session-diff` SHALL still succeed and list the changed files with numstat `additions`/`deletions`
- **AND** tracked-file entries SHALL omit `gitDiff`
- **AND** the server SHALL log a warning naming the cwd and the limit
- **AND** the server SHALL NOT buffer diff output beyond the limit
