## MODIFIED Requirements

### Requirement: KB row reflects index state

The KB folder row SHALL derive its presentation from the folder's KB stats and from the outcome of any client-initiated reindex, distinguishing not-indexed, indexing, populated, stale, error, and denied states. A reindex that fails to complete — whether the server job errored or the client request itself was rejected for a reason other than cwd admission — SHALL surface a visible failed state, never a silent no-op. A cwd-admission refusal (a `403` from any `/api/kb/*` request for the folder whose body carries `error: "cwd not allowed"`) SHALL surface a distinct `denied` state, never the failed state, because no index was attempted and a retry cannot succeed. Activating the primary reindex action SHALL give immediate visible feedback (an optimistic indexing indicator) on click, before the server acknowledges, and SHALL disable the action for the duration of that pending window so a single click cannot start two jobs. The optimistic indicator SHALL always resolve into a real state (polled indexing, populated, failed, or denied) and SHALL never persist indefinitely.

#### Scenario: Empty worktree prompts indexing
- **WHEN** folder `W` reports `indexed: false`
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
- **WHEN** `GET /api/kb/stats?cwd=C` responds `403 { error: "cwd not allowed" }` (folder `C` is neither a known session cwd nor a pinned directory nor admitted via its main checkout)
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
