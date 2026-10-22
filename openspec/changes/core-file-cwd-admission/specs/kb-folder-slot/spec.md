## MODIFIED Requirements

### Requirement: KB cwd admission

Every `/api/kb/*` route SHALL validate the query `cwd` against the host-provided known-folder set (live session cwds ∪ pinned directories ∪ workspace folders) BEFORE opening a store or touching disk. The match SHALL be realpath-canonicalized on BOTH sides — the query `cwd` and each known folder are resolved to an absolute path and, best-effort, symlink-followed — so that two paths denoting the same directory match regardless of symlink traversal. In addition, when the direct match fails, a `cwd` that is a git worktree whose MAIN working-tree path is a known folder SHALL be admitted; the main path is derived server-side via git and never taken from client input. A `cwd` that is neither a known folder nor a git worktree of a known folder SHALL be rejected with `403`. When the guard cannot decide admission because a git probe failed to complete (timeout, spawn failure, missing binary), the route SHALL respond `503` with `error: "cwd-admission-unavailable"` (`plugin-cwd-admission`) — neither admitting nor rejecting — and SHALL NOT open a store or touch disk.

#### Scenario: Symlink-equivalent cwd matches a known folder
- **WHEN** `GET /api/kb/stats?cwd=A` is called where `A` reaches a known folder `K` through a symlink (for example `/tmp` for a session/pinned `/private/tmp`)
- **THEN** the canonicalized `A` equals the canonicalized `K`
- **AND** the request is admitted (not `403`)

#### Scenario: Session-less worktree of a known repo is admitted
- **WHEN** `POST /api/kb/reindex?cwd=W` (or `GET /api/kb/stats?cwd=W`) is called for a git worktree `W` that has NO live pi session and is NOT pinned, whose main repository `R` IS a known folder
- **THEN** the guard server-derives `W`'s main working-tree path via git and finds it equals a known folder `R`
- **AND** the request is admitted so `W` is indexable and its stats are readable

#### Scenario: Worktree whose main repo is not known is rejected
- **WHEN** `GET /api/kb/stats?cwd=W` is called for a git worktree `W` whose main repository is NOT a known folder
- **THEN** the request is rejected with `403` and no store is opened

#### Scenario: Unknown non-worktree cwd is rejected
- **WHEN** `GET /api/kb/stats?cwd=X` is called with a cwd that is neither a known folder nor a git worktree of a known folder
- **THEN** the request is rejected with `403` and no store is opened

#### Scenario: Missing cwd is rejected
- **WHEN** any `/api/kb/*` route is called with no `cwd` query parameter
- **THEN** the request is rejected with `400`

#### Scenario: Undecidable worktree is not rejected
- **WHEN** `GET /api/kb/stats?cwd=W` is called for a worktree `W` of a known repository and the git probe deriving its main checkout times out
- **THEN** the request is answered `503` with `error: "cwd-admission-unavailable"`, not `403`
- **AND** no store is opened

### Requirement: KB row reflects index state

The KB folder row SHALL derive its presentation from the folder's KB stats and from the outcome of any client-initiated reindex, distinguishing not-indexed, no-sources, missing, indexing, populated, stale, error, and denied states. A folder with zero configured sources SHALL NOT offer an index action that cannot index anything; it SHALL offer to configure sources instead. A folder that no longer exists SHALL offer no index action. A reindex that fails to complete — whether the server job errored or the client request itself was rejected for a reason other than cwd admission — SHALL surface a visible failed state, never a silent no-op. A cwd-admission refusal (a `403` from any `/api/kb/*` request for the folder whose body carries `error: "cwd not allowed"`) SHALL surface a distinct `denied` state, never the failed state, because no index was attempted and a retry cannot succeed. A `503` whose body carries `error: "cwd-admission-unavailable"` is NOT a refusal and NOT a failure: the client SHALL keep the row's current or pending presentation and retry with backoff, entering the failed state with `Retry` only after the retries are exhausted, and SHALL never enter the `denied` state for it. Activating the primary reindex action SHALL give immediate visible feedback (an optimistic indexing indicator) on click, before the server acknowledges, and SHALL disable the action for the duration of that pending window so a single click cannot start two jobs. The optimistic indicator SHALL always resolve into a real state (polled indexing, populated, failed, or denied) and SHALL never persist indefinitely.

#### Scenario: Empty worktree prompts indexing
- **WHEN** folder `W` reports `indexed: false` and a `sourceCount` greater than `0` (or no `sourceCount`)
- **THEN** the row shows a not-indexed label and a prominent `Index now` action

#### Scenario: Click gives immediate optimistic feedback before the server acknowledges
- **WHEN** the user activates `Index now` (or the reindex control) for folder `C`
- **THEN** the row shows the indexing indicator immediately on click, before the `POST /api/kb/reindex?cwd=C` response or the first `GET /api/kb/stats?cwd=C` poll resolves
- **AND** the activated action control is disabled while this optimistic pending state is in effect, so a second activation starts no second reindex
- **AND** the optimistic indicator is presented identically to the running-job indexing indicator (no separate submitting affordance)

#### Scenario: Optimistic pending hands off to the real running job
- **WHEN** an optimistic pending indicator is showing for folder `C` and a subsequent `GET /api/kb/stats?cwd=C` poll first reports `indexing: true`
- **THEN** the row continues to show the indexing indicator without any flicker back to the `Index now` / not-indexed presentation
- **AND** the row is thereafter driven by the polled job state, updating to the populated chunk count when the job completes

#### Scenario: Optimistic pending never wedges on a fast-settling job
- **WHEN** an optimistic pending indicator is showing for folder `C` but the reindex completes so quickly that no `GET /api/kb/stats?cwd=C` poll ever observes `indexing: true`
- **THEN** the optimistic indicator clears within a bounded time rather than spinning indefinitely
- **AND** the row settles to the state derived from fresh stats (for example the populated chunk count)

#### Scenario: Running job shows progress from the primary action
- **WHEN** the user activates `Index now` (or the reindex control) for folder `C` and the server responds `202 { status: "running" }`
- **THEN** the client begins polling `GET /api/kb/stats?cwd=C`
- **AND** while the job reports `indexing: true` the row shows an indexing state with an animated indicator
- **AND** the row updates to the populated chunk count when the job completes

#### Scenario: Transient poll failure during a walk keeps the spinner
- **WHEN** a reindex for folder `C` is running (`indexing: true`) and a single `GET /api/kb/stats?cwd=C` poll fails transiently (network blip / brief 5xx)
- **THEN** the row continues to show the indexing indicator rather than flipping to a failed state
- **AND** polling continues so the client still observes the eventual terminal state (`populated` or `jobStatus: "error"`)

#### Scenario: Stale source files are flagged
- **WHEN** folder `C` has `staleCount > 0` from `dox-staleness.json`
- **THEN** the row shows the chunk count plus a `stale` flag with the stale count
- **AND** the stale count reflects drifted source files only, not markdown drift

#### Scenario: Failed server job offers retry
- **WHEN** the last reindex for folder `C` ended in error (`GET /api/kb/stats?cwd=C` reports `jobStatus: "error"`)
- **THEN** the row shows a failed state with a `Retry` action
- **AND** the failed state is distinguished from not-indexed even when `chunks` is `0`

#### Scenario: Rejected client reindex surfaces an error, not a silent no-op
- **WHEN** the user activates `Index now` for folder `C` and the `POST /api/kb/reindex?cwd=C` request itself is rejected for any reason other than a cwd-admission refusal (for example `500`, a `403` from a network/host/permission gate, or a transport failure) so no server job is registered
- **THEN** the optimistic pending indicator clears and the row shows a visible failed state carrying the reject reason with a `Retry` action
- **AND** the failed state is driven by the trigger rejection specifically, distinct from a transient stats-poll failure
- **AND** activating `Retry` re-issues the reindex for `C`

#### Scenario: Unadmitted folder shows denied, not failed
- **WHEN** `GET /api/kb/stats?cwd=C` responds `403 { error: "cwd not allowed" }` (folder `C` is neither a known folder — session cwd, pinned directory or workspace folder — nor admitted via its main checkout)
- **THEN** the row shows a neutral (non-error-colored) `not allowed` label, never `index failed`
- **AND** the row's tooltip explains, in the user's language, that the folder is not admitted and that pinning it grants access
- **AND** the row offers no `Retry` action
- **AND** the client stops polling `C` at the first `403`, without waiting for the stats-poll outage threshold

#### Scenario: Rejected reindex trigger with 403 shows denied
- **WHEN** the user activates the reindex action for folder `C` and `POST /api/kb/reindex?cwd=C` responds `403 { error: "cwd not allowed" }`
- **THEN** the optimistic pending indicator clears and the row shows the `denied` state, not the failed state

#### Scenario: Other 403s are not cwd refusals
- **WHEN** a `/api/kb/*` request for folder `C` responds `403` with any body other than `error: "cwd not allowed"` (for example `network_not_allowed`, `host_not_allowed`, `forbidden`, or a non-JSON body)
- **THEN** the row does NOT enter the `denied` state and offers no `Pin folder` action
- **AND** the failure is handled exactly as the corresponding non-`403` failure (stats-poll outage tolerance, or failed state with `Retry` for a rejected trigger)

#### Scenario: Pinning a denied folder resolves its real state
- **WHEN** the row for folder `C` is in the `denied` state, the dashboard connection is up, and the user activates `Pin folder`
- **THEN** the client requests pinning of exactly `C` through the dashboard's existing directory-pin mechanism
- **AND** the row shows a busy indicator and the action is disabled until the pin outcome is known or a bounded wait elapses
- **AND** when the dashboard reports the updated pinned-directory set including `C`, the client re-fetches `GET /api/kb/stats?cwd=C`
- **AND** once that fetch succeeds the row shows the state derived from the fresh stats (not-indexed, populated, stale, indexing, or failed) and polling semantics resume as normal

#### Scenario: Folder pinned elsewhere leaves denied
- **WHEN** the row for folder `C` is in the `denied` state and `C` is pinned through any other dashboard surface
- **THEN** the row re-fetches its stats once the updated pinned-directory set including `C` is reported, and leaves `denied` on success without a page reload

#### Scenario: Pin unavailable while disconnected
- **WHEN** the row for folder `C` is in the `denied` state and the dashboard connection is not established
- **THEN** the `Pin folder` action is rendered disabled with a perceivable offline indication in every placement, and activating it sends nothing

#### Scenario: Pin that does not admit the folder stays denied
- **WHEN** the user activates `Pin folder` for folder `C` and no updated pinned-directory set including `C` arrives within the bounded wait, or the post-pin re-fetch still responds `403 { error: "cwd not allowed" }`
- **THEN** the busy indicator clears and the row returns to the `denied` state with its `Pin folder` action enabled
- **AND** no failed state or indefinite spinner is shown

#### Scenario: Removed folder shows missing, no action
- **WHEN** `GET /api/kb/stats?cwd=C` reports `folderMissing: true`
- **THEN** the row shows a non-error `folder missing` label
- **AND** its single KB action is rendered disabled, so no reindex request is sent
- **AND** the row never shows `Index now` for `C`

#### Scenario: Zero sources offers Configure sources, not Index now
- **WHEN** `GET /api/kb/stats?cwd=C` reports `sourceCount: 0` and `chunks: 0`
- **THEN** the row shows a `no sources` label and its single KB action reads `Configure sources`
- **AND** activating it opens the folder's KB settings page and sends no reindex request

#### Scenario: Failed job on a zero-source folder never offers a dead Retry
- **WHEN** the row for `C` is in the failed state and `GET /api/kb/stats?cwd=C` reports `sourceCount: 0`
- **THEN** the row keeps its failed label but its single KB action reads `Configure sources`, not `Retry`

#### Scenario: Old server without the new fields
- **WHEN** the stats response for `C` carries neither `folderMissing` nor `sourceCount`
- **THEN** the row behaves as before this change for the non-denied states (no `missing` or `no-sources` presentation)

#### Scenario: Transient admission failure is retried, never denied
- **WHEN** `GET /api/kb/stats?cwd=C` responds `503 { error: "cwd-admission-unavailable" }` and a later retry responds `200`
- **THEN** the row never shows `denied` or `index failed` and settles to the state derived from the fresh stats

#### Scenario: Transient admission failure exhausts retries
- **WHEN** `GET /api/kb/stats?cwd=C` responds `503 { error: "cwd-admission-unavailable" }` on the initial attempt and on all 3 retries
- **THEN** the row shows the failed state with a `Retry` action, not the `denied` state
