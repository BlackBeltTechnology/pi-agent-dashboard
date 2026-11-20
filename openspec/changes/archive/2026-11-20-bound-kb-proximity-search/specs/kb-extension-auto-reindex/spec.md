## MODIFIED Requirements

### Requirement: Pull tools honour cancellation

`kb_search`, `kb_get` and `kb_neighbors` SHALL observe the cancellation signal supplied with the call and return promptly once it is signalled, instead of running the call to completion. A cancelled call SHALL report the cancellation in its model-facing output rather than presenting an empty or partial result as an answer, and SHALL NOT raise an error that ends the session. Cancelling one call SHALL NOT cancel an indexing pass shared with other callers.

The cancelled result SHALL be identical in shape across the three tools: model-facing text consisting of a single cancellation line and nothing else (no hits, no node list, no section body, no not-found marker), and, when `kb_search` was called with `format: "json"`, that line followed by an empty array as the final line (`kb_get` and `kb_neighbors` take no `format` parameter). The signal SHALL be checked before and after post-search enrichment. The per-hit enrichment loop is not interruptible and its cost is bounded by the result limit; the repository-wide rename scan that enrichment may run SHALL be asynchronous, SHALL observe the signal, and SHALL be bounded by a timeout, with timeout or cancellation degrading as an unavailable rename scan does today. A cancellation signalled before an empty-query check SHALL take precedence: an empty query with an already-aborted signal returns the cancellation result, not the empty marker.

For docs-scope `kb_search` and `kb_get`, when the off-thread retrieval path is available, cancellation SHALL also take effect DURING retrieval (the search over the index, and the section/path resolution of a fetch): the call SHALL return the cancellation result promptly without waiting for retrieval to finish. Abandoned retrieval work MAY continue off-thread until its current database statement ends; its result SHALL be discarded and it SHALL NOT block the session thread's event loop (it may still consume CPU in the background until that statement ends).

Calls made with `scope: "git"` are outside this requirement beyond the entry check: they return before any docs indexing stage and their own forge request budget governs them. An already-aborted signal SHALL still short-circuit such a call at entry.

#### Scenario: Cancellation during the freshness wait returns promptly
- **WHEN** the caller cancels while the tool is waiting for the freshness reindex or cold-start populate
- **THEN** the tool stops waiting and returns a result reporting the cancellation
- **AND** no retrieval, graph walk or chunk fetch is performed

#### Scenario: Cancellation during retrieval returns promptly
- **GIVEN** the off-thread retrieval path is available
- **WHEN** the caller cancels while a docs-scope `kb_search` retrieval or `kb_get` fetch is running and has not yet finished, including while a single long database statement is executing
- **THEN** the tool returns the cancellation result within a short bound of the signal (well under one second), not after retrieval completes
- **AND** a following `kb_search` or `kb_get` call in the same session completes normally, without waiting for the abandoned work

#### Scenario: Cancelling one call does not cancel a concurrent call
- **GIVEN** the off-thread retrieval path is available and two docs-scope calls are in progress or queued in the same process
- **WHEN** only the first call is cancelled
- **THEN** the second call completes with its normal result

#### Scenario: Repeated cancellations do not pile up abandoned work
- **GIVEN** the off-thread retrieval path is available
- **WHEN** a caller repeatedly starts and cancels expensive retrievals while earlier abandoned retrievals are still finishing
- **THEN** at most two abandoned retrievals run at the same time
- **AND** a further call waits for one of them to end before its retrieval starts, can still be cancelled while it waits, and returns the timeout line if its deadline (counted from when it was queued) passes first

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

## ADDED Requirements

### Requirement: Docs retrieval does not block the session thread

Docs-scope `kb_search` retrieval and `kb_get` section/path resolution SHALL run off the pi session's main thread, so the session's event loop keeps running while they execute. Results SHALL be identical to on-thread retrieval. When the off-thread path is unavailable, retrieval SHALL run on the session thread as before, with one warning line per process.

#### Scenario: Session thread stays responsive during a slow retrieval
- **WHEN** a docs-scope `kb_search` or `kb_get` retrieval takes several seconds
- **THEN** timers and other asynchronous work on the session thread continue to run during that time

#### Scenario: Off-thread results equal on-thread results
- **WHEN** the same `kb_search` query or `kb_get` path/section is run off-thread and on-thread against the same index
- **THEN** the hits (or the fetched text and details) are identical

#### Scenario: Unavailable off-thread path falls back
- **WHEN** the off-thread retrieval path cannot be started or its code cannot be loaded
- **THEN** the call runs retrieval on the session thread and returns a normal result
- **AND** exactly one warning line naming the reason is written for the process, however many calls fall back

#### Scenario: A crash of the off-thread path is retried off-thread
- **WHEN** the off-thread retrieval path exits unexpectedly while serving a call
- **THEN** retrieval for that call is retried once on a fresh off-thread path, never on the session thread, and a successful retry returns the normal result
- **AND** if the retry also fails, the call returns a single retrieval-failed line with no hits or body (for `kb_search` `format: "json"`, followed by an empty array as the final line) and does not throw
- **AND** after three such crashes in one process, later calls use the session-thread fallback with its one warning line

#### Scenario: No docs index does not start the off-thread path
- **WHEN** a docs-scope call runs in a working directory that has no docs database
- **THEN** it returns the same empty result as before, writes no warning line, and does not disable the off-thread path

#### Scenario: Removing a worktree releases the off-thread connection
- **WHEN** the store of a working directory is closed because that directory was removed
- **THEN** the off-thread path also closes its connection to that directory's database once any in-flight call on it ends

### Requirement: Docs retrieval has a hard deadline

Every off-thread docs retrieval SHALL be bounded by a per-call deadline that starts at dispatch (default 60 seconds, `KB_QUERY_TIMEOUT_MS`; non-integer values use the default, integers are clamped to 1–600 seconds). On expiry the tool SHALL return a single timeout line with no hits or body, without throwing, and write one warning line. The session-thread fallback is not bounded by it.

#### Scenario: Retrieval past the deadline is stopped
- **WHEN** a docs-scope `kb_search` or `kb_get` retrieval has not finished when its deadline passes
- **THEN** the tool returns a single timeout line and no hits or body (for `kb_search` `format: "json"`, the line followed by an empty array as the final line), and does not throw
- **AND** exactly one warning line is written for that call
- **AND** a following call in the same session completes normally

#### Scenario: Deadline setting is coerced
- **WHEN** `KB_QUERY_TIMEOUT_MS` is unset, empty, whitespace, `abc`, `1.5`, `1e3` or `10ms`
- **THEN** the deadline used is 60000 milliseconds
- **AND** `500` gives 1000, `90000` gives 90000 and `700000` gives 600000 milliseconds

#### Scenario: A queued call's deadline starts at dispatch
- **WHEN** a call waits behind another call that is running on the live off-thread path before its retrieval is dispatched (not the abandoned-work limit, which counts from queueing)
- **THEN** its deadline is measured from its own dispatch, not from when it was queued
