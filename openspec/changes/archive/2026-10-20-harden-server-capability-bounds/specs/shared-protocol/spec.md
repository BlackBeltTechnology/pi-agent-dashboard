## ADDED Requirements

### Requirement: Terminal limit refusal server message
The `ServerToBrowserMessage` union SHALL include `terminal_limit_reached` with fields `scope: "global" | "owner"`, `limit: number`, `cwd: string`, and `inline: boolean`. The server SHALL send it only to the socket whose `create_terminal` or `open_inline_terminal` was refused, never broadcast it.

#### Scenario: Terminal limit message type-checks
- **WHEN** client code handles `{ type: "terminal_limit_reached", scope: "global", limit: 32, cwd: "/path", inline: false }`
- **THEN** it SHALL compile without `as any` casts

#### Scenario: Refusal is not broadcast
- **GIVEN** two browser sockets are connected
- **WHEN** socket 1's `create_terminal` is refused at a cap
- **THEN** only socket 1 SHALL receive `terminal_limit_reached`

### Requirement: Folder refusal server message
The `ServerToBrowserMessage` union SHALL include `folder_refused` with fields `path: string` and `reason: "outside_allowed_roots"`. The server SHALL send it only to the socket whose `pin_directory`, `add_folder_to_workspace`, or `move_folder_to_workspace` was refused.

#### Scenario: Folder refusal message type-checks
- **WHEN** client code handles `{ type: "folder_refused", path: "/", reason: "outside_allowed_roots" }`
- **THEN** it SHALL compile without `as any` casts
