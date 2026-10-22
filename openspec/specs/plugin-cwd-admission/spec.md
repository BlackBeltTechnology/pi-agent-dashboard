# plugin-cwd-admission Specification

## Purpose
TBD - created by archiving change harden-plugin-cwd-admission. Update Purpose after archive.

## Requirements

### Requirement: Plugin cwd admission is tri-state

The shared plugin cwd guard SHALL classify every request `cwd` as exactly one of `admit`, `refuse`, or `indeterminate`. It SHALL return `indeterminate` when, and only when, a check needed to decide admission failed, and no earlier rule had already decided. A failed check is any of: a git probe that did not complete (timeout, spawn failure, missing binary, oversized output); a git config probe that exited with anything other than the tolerated "unset" status; or a path that could not be canonicalized for a reason other than non-existence. A required repository probe that completed with a non-zero exit is a definitive "not a repository" answer, not a failure. A path that does not exist and is not itself known SHALL be refused without running git. An `indeterminate` result SHALL NOT admit. A plugin HTTP route SHALL answer `indeterminate` with status `503`, body `{ "error": "cwd-admission-unavailable", "message": <string>, "retryAfterMs": <number> }`, and a `Retry-After` header. It SHALL answer `refuse` with its existing `403` body, unchanged.

#### Scenario: Direct known folder needs no git
- **WHEN** the canonical `cwd` is in the known-folder set
- **THEN** the guard returns `admit` without running any git probe

#### Scenario: Probe timeout is indeterminate
- **GIVEN** a `cwd` that is not itself known
- **WHEN** a checkout-root or binding probe for it times out
- **THEN** the guard returns `indeterminate`
- **AND** the route responds `503` with `error: "cwd-admission-unavailable"` and a `Retry-After` header
- **AND** no store is opened and no config file is read or written for that cwd

#### Scenario: Deleted worktree directory is a refusal
- **WHEN** the `cwd` names a directory that no longer exists and is not itself known
- **THEN** the guard returns `refuse` without running any git probe, and the route responds with its existing `403` body

#### Scenario: Indeterminate never admits
- **WHEN** a probe fails for a `cwd` whose main checkout would have been a known folder
- **THEN** the guard returns `indeterminate`, not `admit`

### Requirement: Admission does not block the event loop

The guard SHALL perform every git probe and every path canonicalization on a plugin route request path asynchronously. It SHALL limit concurrent derivations with a global cap. It SHALL bound each admission decision by an overall deadline counted from entry. At the deadline the decision SHALL resolve `indeterminate`, the derivation's in-flight git processes SHALL be terminated, its concurrency slot SHALL be released, and any later probe result SHALL be ignored. Concurrent admissions of the same canonical `cwd` SHALL share one in-flight derivation.

#### Scenario: Burst of distinct folders
- **WHEN** 25 requests for 25 distinct admissible worktrees arrive concurrently
- **THEN** no more derivations than the global cap run at once
- **AND** `GET /api/health` is served while they are pending

#### Scenario: Hung git does not starve later admissions
- **GIVEN** the cap is filled by derivations whose git probes hang
- **WHEN** their deadline passes
- **THEN** each of them resolves `indeterminate`, its git processes are terminated, and its slot is released
- **AND** a subsequent request for an admissible cwd is admitted

#### Scenario: Same cwd shares one derivation
- **WHEN** several concurrent requests carry the same canonical cwd
- **THEN** at most one checkout-root derivation runs for it and every request receives the same classification

### Requirement: Admission is not cached across requests

The guard SHALL NOT reuse an admission verdict or a main-checkout derivation from one request in a later request. Every request SHALL be decided against the current filesystem and the live known-folder set.

#### Scenario: Unpinning takes effect immediately
- **GIVEN** a worktree admitted because its main repo `/repo` is pinned
- **WHEN** `/repo` is unpinned and no session holds `/repo` or the worktree
- **THEN** the next request for the worktree is refused with `403`

#### Scenario: Re-created path is decided afresh
- **WHEN** a previously admitted `/w` is deleted and re-created as a checkout of a repository whose main checkout is not known
- **THEN** the next request for `/w` is refused

### Requirement: One admission decision per request

When a plugin route hands a project scope to a downstream component that re-checks admission (the mcp-client config writer and live-state reader), the scope SHALL carry an admission token. Only the guard module can create the token, it never crosses the wire or leaves the plugin, and it is bound to the admitted cwd string. A token SHALL be valid only for the route request that obtained it. The route SHALL invalidate it when the handler finishes, and any number of checks within that request SHALL accept it without re-running admission. A scope without a valid token SHALL still be admitted by the guard before any disk access.

#### Scenario: Writer does not re-decide
- **GIVEN** a route admitted a worktree cwd and passed the token to the config writer
- **WHEN** git would time out if re-probed during the write
- **THEN** the write completes, because the writer runs no admission probe for a valid token

#### Scenario: Client-supplied token is ignored
- **WHEN** a client sends a write body `{ "scope": "project", "cwd": "/x", "admission": { … } }` for an unknown `/x`
- **THEN** the server ignores the client field, admission runs, and the request is refused

#### Scenario: One write validates several times on one token
- **WHEN** a single save request reaches the writer's admission check more than once (prepare and validate)
- **THEN** every check accepts the request's token and no synchronous git probe runs

#### Scenario: Token does not outlive its request
- **WHEN** a token retained from a finished request is presented for the same cwd after its main repository was unpinned
- **THEN** it is rejected and the guard runs, refusing the cwd

#### Scenario: Routes always pass a token
- **WHEN** any mcp-client route handler reaches the config writer or live-state reader for a project scope
- **THEN** the scope carries a token, so the synchronous fallback guard is never reached from a route

### Requirement: Indeterminate admissions are logged

The server SHALL log `indeterminate` admission decisions at warn level as `[cwd-admission] indeterminate`, with the canonical cwd, the failed probes, and the decision wall time in milliseconds. It SHALL emit at most one such line per canonical cwd per 60 seconds.

#### Scenario: Timeout is visible in server.log
- **WHEN** an admission returns `indeterminate` because the checkout-root probe timed out
- **THEN** `server.log` contains one `[cwd-admission] indeterminate` line naming the cwd and the failed probe

### Requirement: Plugins can raise the cwd access plane from a user-initiated write

`ServerPluginContext` SHALL expose an optional `holdCwdDenial(request, reply, { cwd, origin })` that resolves to a decision after the operator's verdict: `admit` with the canonical cwd, `indeterminate`, or `refuse`. It SHALL NOT return an admission token. The plugin SHALL mint its own token from the decision, and only when the decision names the same cwd (the resolved string the plugin passed to the host) as the request carries, so a decision for one path cannot be replayed for another. The host SHALL have already re-resolved the real path at release time, so the plugin SHALL NOT touch the filesystem with the request's cwd again. The host SHALL gate it to first-party / trusted plugins, using the same rule as `registerCwdPolicy`. For an untrusted plugin it SHALL resolve as a refusal without raising anything. The host SHALL apply these rules:
- It SHALL resolve as a refusal without raising a prompt when the cwd does not exist, when its canonical path contains a `.git` segment, or when it names an ungrantable subject.
- It SHALL accept only origins from a closed server-side set, and SHALL resolve as a refusal for any other origin.
- Otherwise it SHALL hold the request on the `cwd` access plane with origin `plugin:<pluginId>:<origin>`.
- On an `allow-always` verdict it SHALL re-run the guard against the live known-folder set (sessions, pins and workspace folders) and return the resulting classification. A re-run that is `indeterminate` SHALL yield `503`, not `403`.
- On an `allow-once` verdict, it SHALL re-resolve the cwd's real path at release time and require it to equal the verdict subject. It SHALL re-check existence, the `.git` rule, and grantability, and SHALL then return `admit` for that cwd, without requiring known-folder membership.

A first-party plugin SHALL call `holdCwdDenial` only after a `refuse` classification on a user-initiated write route. It SHALL NOT call it on `indeterminate`, from a read (GET) route, or from a `plugin_action` handler.

#### Scenario: Saving an MCP server for an unknown folder asks
- **GIVEN** prompting is enabled and `/x` is neither known nor inside a known repo
- **WHEN** the operator saves an MCP server entry with `scope: "project", cwd: "/x"`
- **THEN** the dashboard shows the cwd access dialog for `/x`
- **AND** on "Always allow" `/x` is pinned and the save completes with `200`
- **AND** on deny or expiry the route responds with the existing `403` body

#### Scenario: Allow-once completes exactly one write
- **WHEN** the operator answers "Allow once" to the dialog raised by a save for `/x`
- **THEN** that save completes with `200` and `/x` is not pinned
- **AND** a subsequent save for `/x`, after the first has completed, raises the dialog again

#### Scenario: KB reindex of an unknown folder asks
- **WHEN** the operator triggers `POST /api/kb/reindex?cwd=/x` for an unknown `/x`
- **THEN** the cwd access dialog is raised, and the reindex runs only after an allow verdict that the re-run guard confirms

#### Scenario: A .git cwd never prompts
- **WHEN** a write route is refused for `cwd = /repo/.git`
- **THEN** no access dialog is raised and the route responds with its existing `403` body

#### Scenario: Background reads never prompt
- **WHEN** `/api/mcp-client/effective`, `/api/mcp-client/live`, or any kb GET route is refused for an unknown cwd
- **THEN** no access dialog is raised and no pending access request is recorded
- **AND** the route responds with its existing `403` body

#### Scenario: Indeterminate write does not prompt
- **WHEN** a write route's admission is `indeterminate`
- **THEN** no access dialog is raised and the route responds `503 cwd-admission-unavailable`

#### Scenario: Allow-always with undecidable re-run
- **WHEN** the operator answers "Always allow" for a write's cwd and the re-run admission is `indeterminate`
- **THEN** the route responds `503 cwd-admission-unavailable`, not `403`

#### Scenario: Swapped symlink after allow-once
- **WHEN** the operator answers "Allow once" for `/x` and `/x` is replaced by a symlink to another directory before release
- **THEN** the re-run finds a different real path, no token is issued, and the route responds `403`

#### Scenario: Untrusted plugin cannot raise the dialog
- **WHEN** an untrusted plugin calls `holdCwdDenial` for any cwd and origin
- **THEN** it resolves as a refusal and no access dialog or pending request is recorded

#### Scenario: Host without the seam
- **WHEN** a plugin runs on a host where `holdCwdDenial` is absent
- **THEN** the plugin's write routes refuse an unknown cwd with the existing `403` body, as before

### Requirement: The core file-exists cwd prompt uses the same re-run

The core `file-routes` unknown-cwd verdict SHALL re-run the same guard as `holdCwdDenial` after an allow verdict. That is, canonical comparison against the live known-folder set, including session cwds, rather than a pins-only check of the resolved path.

#### Scenario: Allow while a session already holds the cwd
- **GIVEN** a held file-exists request for `/x`, and a session rooted in `/x` that starts before the operator answers
- **WHEN** the operator allows the request
- **THEN** the re-run admits `/x` and the request proceeds

### Requirement: A non-directory cwd is refused, not indeterminate
The shared admission guard SHALL refuse a `cwd` that exists but is not a directory (for example a regular file inside a known repository). A git probe that cannot start because the `cwd` is not a directory (`ENOTDIR`) SHALL be read as "not a repository", never as a failed probe, so the guard SHALL NOT report such a `cwd` as `indeterminate`.

#### Scenario: Regular file inside a known repository
- **WHEN** the `cwd` names a regular file inside a repository whose main checkout is a known folder
- **THEN** the guard returns `refuse`
- **AND** the route responds with its refusal, not `503`
