# pinned-directories Specification

## Purpose

Lets the user pin directories so they stay visible in the sidebar independently of whether a session is running there. Defines persistence, the WebSocket protocol, the REST endpoint, and delivery of the initial pinned state when a browser connects.

## Requirements

### Requirement: Pinned directory persistence
The server SHALL store an ordered list of pinned directory paths in `preferences.json` under the `pinnedDirectories` key as a `string[]`. Array position SHALL determine display order at the top level of the sidebar. The list SHALL survive server restarts.

Pin state and workspace membership are independent persisted facts. A folder MAY appear in both `pinnedDirectories` and some workspace's `folders[]`; the two lists SHALL NOT be deduplicated against each other. Pin state SHALL have no effect on visibility or ordering inside a workspace.

#### Scenario: Pin a directory
- **WHEN** a `pin_directory` message is received with path `/home/user/project-a`
- **THEN** the path SHALL be appended to the pinned directories list and persisted to `preferences.json`

#### Scenario: Pin an already-pinned directory
- **WHEN** a `pin_directory` message is received with a path that is already pinned
- **THEN** the list SHALL remain unchanged (no duplicates)

#### Scenario: Unpin a directory
- **WHEN** an `unpin_directory` message is received with path `/home/user/project-a`
- **THEN** the path SHALL be removed from the pinned directories list and persisted

#### Scenario: Unpin a non-pinned directory
- **WHEN** an `unpin_directory` message is received with a path that is not pinned
- **THEN** the list SHALL remain unchanged (no error)

#### Scenario: Reorder pinned directories
- **WHEN** a `reorder_pinned_dirs` message is received with paths `["/b", "/a", "/c"]`
- **THEN** the pinned directories list SHALL be replaced with the provided order and persisted

#### Scenario: Server restart preserves pinned directories
- **WHEN** the server restarts after directories have been pinned
- **THEN** the pinned directories list SHALL be loaded from `preferences.json` with order preserved

#### Scenario: Pinning a folder that is in a workspace
- **WHEN** a folder is in workspace W's `folders[]` and a `pin_directory` message is received for that folder
- **THEN** the folder SHALL be appended to `pinnedDirectories` while remaining in workspace W's `folders[]`; both lists shall reflect the update independently

#### Scenario: Unpinning a folder that is in a workspace
- **WHEN** a folder is in both `pinnedDirectories` and workspace W's `folders[]` and an `unpin_directory` message is received
- **THEN** the folder SHALL be removed from `pinnedDirectories` only; workspace W's `folders[]` SHALL be unchanged and the folder SHALL continue to render inside workspace W

### Requirement: Pinned directory WebSocket protocol
The server SHALL support WebSocket messages for pinning, unpinning, and reordering directories. The protocol shape is unchanged.

#### Scenario: Pin directory via WebSocket
- **WHEN** a browser sends `{ type: "pin_directory", path: "/home/user/project" }`
- **THEN** the server SHALL pin the directory and broadcast `pinned_dirs_updated` to all connected browsers

#### Scenario: Unpin directory via WebSocket
- **WHEN** a browser sends `{ type: "unpin_directory", path: "/home/user/project" }`
- **THEN** the server SHALL unpin the directory and broadcast `pinned_dirs_updated` to all connected browsers

#### Scenario: Reorder pinned directories via WebSocket
- **WHEN** a browser sends `{ type: "reorder_pinned_dirs", paths: ["/b", "/a"] }`
- **THEN** the server SHALL update the order and broadcast `pinned_dirs_updated` to all connected browsers

#### Scenario: Broadcast format
- **WHEN** a `pinned_dirs_updated` message is broadcast
- **THEN** it SHALL contain `{ type: "pinned_dirs_updated", paths: string[] }` with the full ordered list

### Requirement: Pinned directories REST endpoint
The server SHALL provide a REST endpoint to retrieve the current pinned directories list.

#### Scenario: Get pinned directories
- **WHEN** a GET request is made to `/api/pinned-dirs`
- **THEN** the server SHALL return `{ success: true, data: string[] }` with the ordered list of pinned paths

### Requirement: Initial pinned state on browser connect
When a browser connects via WebSocket, the server SHALL include the current pinned directories in the initial state.

#### Scenario: Browser connects
- **WHEN** a browser WebSocket connection is established
- **THEN** the server SHALL send a `pinned_dirs_updated` message with the current pinned directories list

### Requirement: A cwd-allowlist denial offers pinning as its remedy

HTTP routes that refuse an unknown `cwd` SHALL carry the refusal reason and the remedy alongside their existing error string. Because the known-cwd set already includes the user's pinned directories, pinning the refused directory SHALL be the offered `allow-always` remedy.

The covered HTTP routes are the goal-plugin routes (`rejectInvalidCwd`, six call sites), the OpenSpec group routes, the KB plugin HTTP routes (`rejectCwd`, four call sites), the MCP-client plugin routes (whose body shape is `{ error, message }`), and `GET /api/file/exists` (whose refusal string is `"unknown cwd"`, distinct from the others' `"cwd not allowed"`). Each route's existing `error` string SHALL be preserved unchanged; the reason and hint SHALL be additional fields.

The additional fields SHALL be additive: each route's pre-existing `error` string is unchanged, so a client reading only `error` observes no difference.

Denial sites that are NOT HTTP routes are excluded: the two `plugin_action` browser-message handlers and the internal visitor-session-registry rejection have no HTTP request to suspend and no response body to enrich. They SHALL retain their current behaviour.

#### Scenario: Denial body is self-describing

- **WHEN** a route refuses a request because its `cwd` is not in the known set
- **THEN** the 403 body SHALL carry a reason and a hint describing how access can be granted
- **AND** the pre-existing `error` string SHALL be unchanged

#### Scenario: Every cwd-refusing HTTP route is covered

- **WHEN** each of the goal-plugin, OpenSpec group, KB plugin HTTP, MCP-client plugin, and `/api/file/exists` routes refuses an unknown `cwd`
- **THEN** each SHALL carry the additional fields

#### Scenario: Non-HTTP denial sites are unchanged

- **WHEN** a `plugin_action` message handler or the visitor-session registry refuses an unknown `cwd`
- **THEN** its behaviour SHALL be unchanged

#### Scenario: Pinning from the remedy surface

- **GIVEN** a `cwd` denial surfaced its remedy to the user
- **WHEN** the user accepts the offered remedy
- **THEN** the refused directory SHALL be added to the pinned directories

#### Scenario: Pinned directory is accepted on retry

- **GIVEN** a directory was pinned in response to a denial
- **WHEN** a request for that `cwd` is retried
- **THEN** it SHALL be admitted by the existing known-cwd check

#### Scenario: Denial without user action is unchanged

- **WHEN** a `cwd` denial occurs and the user takes no action
- **THEN** the request SHALL be refused with 403 immediately and no directory SHALL be pinned

#### Scenario: A path grant never pins a directory

- **GIVEN** directory `/a/b` is granted as a filesystem path anchor
- **WHEN** a `cwd` request for `/a/b` is made
- **THEN** it SHALL still be refused unless `/a/b` is separately pinned — the two remedies are distinct

### Requirement: An unknown-working-directory denial may raise a dialog that pins the directory

An unknown-working-directory denial that is prompt-eligible MAY raise a dialog
naming the directory. An allow-always verdict SHALL pin that directory through
the existing pinned-directory store; an allow-once verdict SHALL permit only the
request that raised it and SHALL NOT pin anything.

The dialog SHALL name pinning explicitly, so the operator understands that the
persistent answer adds the directory to the pinned list shown in the Access
surface.

#### Scenario: Allow always pins

- **WHEN** the operator answers allow-always on an unknown-working-directory denial
- **THEN** the directory SHALL appear in the pinned directories
- **AND** it SHALL be revocable from the Access surface

#### Scenario: Allow once does not pin

- **WHEN** the operator answers allow-once
- **THEN** the pinned directories SHALL be unchanged
- **AND** a later request for the same directory SHALL be denied again

#### Scenario: The verdict does not pin a different directory

- **WHEN** an allow-always verdict is applied
- **THEN** exactly the directory named in the dialog SHALL be pinned
