## MODIFIED Requirements

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
