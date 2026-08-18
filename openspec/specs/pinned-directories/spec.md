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
