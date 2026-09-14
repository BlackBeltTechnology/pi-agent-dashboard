## MODIFIED Requirements

### Requirement: Worktree identity propagation through session protocol
The bridge SHALL include the `gitWorktree` object on `git_info_update` payloads when the cwd is a worktree — the first such update is sent immediately after `session_register`, so the server learns worktree identity within the same registration handshake. The server SHALL store `gitWorktree` on `DashboardSession` and forward it in `session_added` / `session_updated` browser messages. The field SHALL be optional; clients receiving an older bridge MUST treat its absence as "not a worktree".

Once a session's worktree parentage has been resolved, it SHALL be treated as immutable while the session's cwd is unchanged. A re-register with the SAME cwd SHALL carry the in-memory `gitWorktree` over (so a server restart or bridge reconnect during the removal window cannot re-open the clear); a re-register with a DIFFERENT cwd SHALL discard it and start from "unresolved". A `git_info_update` carrying `gitWorktree: null` for a session whose `gitWorktree` is already set means the worktree directory was removed underneath the still-running session (e.g. `git worktree remove` executed from inside it), NOT that the session moved to a plain checkout; the server SHALL keep the existing parentage in that case. A `null` for a session with no parentage set SHALL clear as before.

#### Scenario: Worktree session register
- **WHEN** a bridge whose cwd is a worktree registers a session
- **THEN** the `git_info_update` that immediately follows `session_register` SHALL include `gitWorktree: { mainPath, name }`

#### Scenario: Non-worktree session register
- **WHEN** a bridge whose cwd is a main checkout registers a session
- **THEN** the `gitWorktree` field SHALL be absent from the register payload (not present as `null`)

#### Scenario: Reattach in the same cwd preserves parentage
- **WHEN** a session with `gitWorktree` set re-registers (server restart, bridge reconnect, resume) with the same `cwd`
- **THEN** the session's `gitWorktree` SHALL be unchanged after registration
- **AND** a subsequent `git_info_update { gitWorktree: null }` SHALL leave it unchanged

#### Scenario: Reattach in a different cwd resets parentage
- **WHEN** a session with `gitWorktree` set re-registers with a different `cwd`
- **THEN** `gitWorktree` SHALL be absent after registration until the bridge reports it again

#### Scenario: Live worktree state update
- **WHEN** a bridge's `gitWorktree` value changes from one worktree object to another (rare; e.g., user runs `git worktree repair`)
- **THEN** the bridge SHALL emit a `git_info_update` carrying the new value
- **AND** the server SHALL broadcast `session_updated` with the new `gitWorktree`

#### Scenario: Worktree removed underneath a live session
- **WHEN** a session has `gitWorktree = { mainPath: "/repo", name: "feat-x" }` and `cwd = "/repo/.worktrees/feat-x"`
- **AND** a `git_info_update` arrives with `gitWorktree: null`
- **THEN** the server SHALL keep `gitWorktree = { mainPath: "/repo", name: "feat-x" }`
- **AND** the session SHALL still be marked as having reported worktree state
- **AND** the session's persisted `.meta.json` SHALL retain `gitWorktree.mainPath` / `gitWorktree.name` when the session ends

#### Scenario: Null clears when no parentage was set
- **WHEN** a session has no `gitWorktree`
- **AND** a `git_info_update` arrives with `gitWorktree: null`
- **THEN** `gitWorktree` SHALL remain absent
- **AND** the session SHALL be marked as having reported worktree state

#### Scenario: Backward compatibility with older bridges
- **WHEN** a client receives a session payload without the `gitWorktree` field
- **THEN** the client SHALL treat the session as a plain checkout (no worktree pill, no group collapse)
