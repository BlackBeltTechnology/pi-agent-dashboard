## MODIFIED Requirements

### Requirement: Cold-start populate and freshness reindex on pull tools

The pull tools SHALL ensure the index reflects on-disk content before returning results, populating an empty index and refreshing a warm one, while never letting an indexing failure break retrieval. Calls that target the `git` scope SHALL NOT trigger the docs freshness reindex or cold-start populate; the `git` scope keeps its own freshness.

The wait for that indexing pass SHALL be bounded by a freshness budget. The budget defaults to 1500 milliseconds and is overridable per session by the environment variable `KB_FRESHNESS_BUDGET_MS`, resolved by a single rule applied after trimming surrounding whitespace: a value consisting only of decimal digits is honoured, clamped down to a ceiling of 60000 milliseconds, with `0` meaning the tool never waits; every other value — absent, empty, negative, fractional, exponent-notation, unit-suffixed or otherwise non-digit — resolves to the default.

When the budget elapses before indexing completes, the tool SHALL answer from the index as it stands at that moment, SHALL report in its model-facing output that the answer may be stale, and the indexing pass SHALL continue to run so that its progress is available to later calls. Expiry SHALL NOT cancel, restart or duplicate the indexing pass, and an indexing failure observed after the tool has returned SHALL NOT surface as an unhandled error, including when every waiter has stopped waiting. When indexing completes before the budget elapses, no pending timer SHALL remain scheduled for that wait.

Whether an answer carries a staleness report SHALL be decided from the state of the indexing pass, not from the chunk count alone: an answer SHALL carry it when a pass for its cwd was still in flight when the tool stopped waiting, or when the pass failed; an answer SHALL NOT carry it when the pass completed (even if it produced no chunks) or when no pass was started or in flight for the call.

An indexing pass for a cwd counts as completed only when it actually walked every configured source and resolved successfully; a no-op return for a removed cwd, a warm-index skip, and a failed pass do not count. Completion state SHALL be forgotten when the cached store for that cwd is closed or evicted, so a cwd re-created at the same path is treated as never indexed.

A tool that arrives while an indexing pass for its cwd is already in flight SHALL wait on that pass under the same budget regardless of how many chunks the index already holds, so that an answer served from a partially written index is reported as possibly stale rather than presented as complete.

#### Scenario: kb_search reindexes before searching
- **WHEN** `kb_search` executes with a non-empty query and without `scope: "git"`
- **THEN** a freshness reindex is started (or an in-flight one joined) and awaited for at most the freshness budget before the FTS query runs
- **AND** the FTS query runs once the pass completes or the budget elapses, whichever is first
- **AND** an empty or whitespace query returns an empty result without indexing

#### Scenario: kb_neighbors and kb_get populate a cold index
- **WHEN** `kb_neighbors`, or `kb_get` without `scope: "git"`, runs against a never-indexed cwd
- **THEN** a population pass is started once (guarded by a chunk-count check) and awaited for at most the freshness budget before the graph walk or chunk fetch
- **AND** a warm index with no pass in flight performs only a count check and no walk
- **AND** a call arriving while a pass is in flight joins that pass under the budget even though the chunk count is no longer zero

#### Scenario: Git-scope calls skip the docs reindex
- **WHEN** `kb_search` or `kb_get` runs with `scope: "git"`
- **THEN** no docs freshness reindex or cold-start populate runs

#### Scenario: Indexing failure falls back to the existing index
- **WHEN** the freshness reindex or cold-start populate throws
- **THEN** the failure is logged as a warning and the tool answers from the existing index
- **AND** the answer is reported as possibly stale in the tool's model-facing output

#### Scenario: A rejection after every waiter stopped waiting is handled
- **WHEN** an indexing pass rejects after all callers have abandoned their wait
- **THEN** the rejection is handled and logged rather than raised as an unhandled rejection

#### Scenario: A pass completing inside the budget leaves no pending timer
- **WHEN** the indexing pass completes before the freshness budget elapses
- **THEN** the budget timer for that wait is cleared and no later wakeup fires for it

#### Scenario: Concurrent reindexes coalesce
- **WHEN** a debounce-triggered reindex and a pull-tool freshness reindex overlap for the same cwd
- **THEN** both share a single in-flight walk rather than interleaving transactions on the shared store

#### Scenario: Indexing slower than the budget answers from the existing index
- **WHEN** the indexing pass has not completed when the freshness budget elapses
- **THEN** the tool stops waiting and answers from the index as it stands
- **AND** the result reports that the index refresh is still running and the answer may be stale

#### Scenario: Settling just inside or just outside the budget
- **WHEN** the budget is 1500 ms and the indexing pass completes at 1499 ms, or at 1501 ms
- **THEN** the 1499 ms case answers without a staleness report and the 1501 ms case answers with one
- **AND** completion at exactly the budget may resolve either way (timer and settle ordering is not specified)

#### Scenario: Abandoned indexing keeps running for later callers
- **WHEN** a call returned because its freshness budget elapsed
- **THEN** the indexing pass for that cwd keeps running and is not restarted or duplicated by a subsequent call
- **AND** a subsequent call that arrives after it completes answers from the refreshed index without a staleness report

#### Scenario: Zero budget never waits
- **WHEN** `KB_FRESHNESS_BUDGET_MS` is `0`
- **THEN** the tool answers from the index as it stands without waiting for indexing
- **AND** `kb_search` still starts (or joins) a freshness pass in the background, and its answer reports that it may be stale
- **AND** `kb_get` / `kb_neighbors` on a warm index with no pass in flight start no pass and carry no staleness report

#### Scenario: Surrounding whitespace in the budget value is ignored
- **WHEN** `KB_FRESHNESS_BUDGET_MS` is a digits-only value with surrounding whitespace (for example ` 2000 `)
- **THEN** the effective budget is that value; a whitespace-only value resolves to the default

#### Scenario: A failed pass is reported as stale, never as still being built
- **WHEN** the indexing pass rejects before the tool answers
- **THEN** the answer carries the staleness report and is served from the existing index, even if that index is empty

#### Scenario: A digits-only budget above the ceiling clamps
- **WHEN** `KB_FRESHNESS_BUDGET_MS` consists only of decimal digits and exceeds 60000
- **THEN** the effective budget is exactly 60000 ms

#### Scenario: Any other budget value falls back to the default
- **WHEN** `KB_FRESHNESS_BUDGET_MS` is absent, empty, negative (`-1`), fractional (`1500.5`), exponent-form (`1e3`), unit-suffixed (`1500ms`) or otherwise not digits-only
- **THEN** the effective budget is the default 1500 ms
- **AND** a negative value is treated as malformed rather than as "never wait"

#### Scenario: Completion state is forgotten when a cwd's store is evicted
- **WHEN** a cwd had a completed indexing pass, its cached store is then closed or evicted (for example after the worktree was removed), and a cwd at the same path is later queried with an empty index whose first pass has not completed within the budget
- **THEN** the tool returns the index-is-being-built indication rather than a normal empty result

#### Scenario: A no-op pass does not count as completed
- **WHEN** the reindex returns without walking (the cwd no longer exists, or a warm index skipped population)
- **THEN** that return does not mark the cwd as having completed an indexing pass

#### Scenario: Fresh answer carries no staleness report
- **WHEN** the indexing pass completes within the freshness budget
- **THEN** the result is returned without any staleness report

## ADDED Requirements

### Requirement: Pull tools honour cancellation

`kb_search`, `kb_get` and `kb_neighbors` SHALL observe the cancellation signal supplied with the call and return promptly once it is signalled, instead of running the call to completion. A cancelled call SHALL report the cancellation in its model-facing output rather than presenting an empty or partial result as an answer, and SHALL NOT raise an error that ends the session. Cancelling one call SHALL NOT cancel an indexing pass shared with other callers.

The cancelled result SHALL be identical in shape across the three tools: model-facing text consisting of a single cancellation line and nothing else (no hits, no node list, no section body, no not-found marker), and, when `kb_search` was called with `format: "json"`, that line followed by an empty array as the final line (`kb_get` and `kb_neighbors` take no `format` parameter). The signal SHALL be checked before and after post-search enrichment. The per-hit enrichment loop is not interruptible and its cost is bounded by the result limit; the repository-wide rename scan that enrichment may run SHALL be asynchronous, SHALL observe the signal, and SHALL be bounded by a timeout, with timeout or cancellation degrading as an unavailable rename scan does today. A cancellation signalled before an empty-query check SHALL take precedence: an empty query with an already-aborted signal returns the cancellation result, not the empty marker.

Calls made with `scope: "git"` are outside this requirement beyond the entry check: they return before any docs indexing stage and their own forge request budget governs them. An already-aborted signal SHALL still short-circuit such a call at entry.

#### Scenario: Cancellation during the freshness wait returns promptly
- **WHEN** the caller cancels while the tool is waiting for the freshness reindex or cold-start populate
- **THEN** the tool stops waiting and returns a result reporting the cancellation
- **AND** no retrieval, graph walk or chunk fetch is performed

#### Scenario: Cancellation before enrichment skips enrichment
- **WHEN** the caller cancels after retrieval but before the post-search verdict enrichment
- **THEN** the enrichment is skipped and the tool returns a result reporting the cancellation

#### Scenario: An already-cancelled call does no work
- **WHEN** the signal is already aborted as the tool starts
- **THEN** no indexing, retrieval or enrichment runs and the tool returns a result reporting the cancellation

#### Scenario: Cancelling a caller leaves the shared indexing pass running
- **WHEN** a call is cancelled while an indexing pass for its cwd is in flight
- **THEN** that indexing pass continues to completion for the debounce path and other callers

#### Scenario: Cancellation during the rename scan ends the call
- **WHEN** the caller cancels while enrichment's repository-wide rename scan is running
- **THEN** the scan is stopped and the tool returns the cancellation result rather than hits with degraded verdicts

#### Scenario: A slow rename scan is bounded
- **WHEN** the rename scan does not finish within its timeout
- **THEN** the scan is abandoned, enrichment proceeds as if no renames were detectable, and the event loop is not blocked while it runs

#### Scenario: Cancellation takes precedence over an empty query
- **WHEN** `kb_search` is invoked with an empty or whitespace-only query and a signal that is already aborted
- **THEN** the tool returns the cancellation result (for `format: "json"`, the cancellation line followed by an empty array), not the empty-query marker

#### Scenario: Absent signal behaves as before
- **WHEN** the call is made without a cancellation signal
- **THEN** the tool behaves exactly as it does with an unsignalled one

#### Scenario: Cancelled result carries one line and no payload
- **WHEN** any of the three tools returns because its signal was aborted
- **THEN** the model-facing text is a single cancellation line with no hits, node list, section body or not-found marker
- **AND** a `kb_search` call with `format: "json"` emits that line followed by an empty array as the final line
- **AND** the tool returns a well-formed result instead of raising an error

#### Scenario: Git-scope calls are bounded by their own budget
- **WHEN** `kb_search` or `kb_get` runs with `scope: "git"` and a signal that is not already aborted
- **THEN** the call proceeds under the forge request budget and this requirement adds no further cancellation point
- **AND** a signal already aborted at entry returns a cancellation result without contacting the forge
