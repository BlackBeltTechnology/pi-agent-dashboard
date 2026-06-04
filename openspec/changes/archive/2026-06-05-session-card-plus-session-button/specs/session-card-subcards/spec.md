## ADDED Requirements

### Requirement: +Session sibling-spawn button on session card
The session card SHALL render an always-visible `+Session` button alongside the existing `Fork` and `Resume` controls. Unlike Fork/Resume, this button SHALL NOT be gated on `session.status === "ended"` or on the presence of `session.sessionFile` — it renders for live and ended sessions alike.

Click SHALL emit a `spawn_session` ws message with:
- `cwd` set to the parent session's `cwd`,
- `attachProposal` set to the parent session's `attachedProposal` when that field is a non-empty string (omitted otherwise),
- a fresh `requestId` (UUIDv4).

The button SHALL be `disabled` when `session.cwdMissing === true`, with tooltip text matching the existing Fork-disabled tooltip (`session's directory no longer exists`).

The button SHALL NOT carry `gitWorktreeBase` or any worktree-related metadata. Worktree-sibling spawning is covered by separate surfaces (folder `+Worktree`, per-change `⑂+`).

#### Scenario: Visible on live session
- **WHEN** a session card is rendered for a session with `status === "running"` (or any non-ended status)
- **THEN** the `+Session` button SHALL render
- **THEN** Fork and Resume controls SHALL be absent (existing behavior — they only show on ended sessions)

#### Scenario: Visible on ended session alongside Fork
- **WHEN** a session card is rendered for a session with `status === "ended"` and a valid `sessionFile`
- **THEN** `+Session`, `Resume`, and `Fork` SHALL all render in the same control row

#### Scenario: Click inherits cwd and proposal
- **WHEN** the user clicks `+Session` on a session with `cwd = "/project/foo"` and `attachedProposal = "add-dark-mode"`
- **THEN** a `spawn_session` ws message SHALL be sent with `cwd: "/project/foo"`, `attachProposal: "add-dark-mode"`, and a UUIDv4 `requestId`

#### Scenario: Click omits proposal when parent has none
- **WHEN** the user clicks `+Session` on a session whose `attachedProposal` is `null`, `undefined`, or empty string
- **THEN** the emitted `spawn_session` payload SHALL omit the `attachProposal` key entirely (not send empty string)

#### Scenario: Disabled on missing cwd
- **WHEN** the parent session has `cwdMissing === true`
- **THEN** the `+Session` button SHALL render with the `disabled` attribute set
- **THEN** the tooltip SHALL read `session's directory no longer exists`
- **THEN** clicks SHALL NOT emit a `spawn_session` message

### Requirement: +Worktree button on session card
The session card SHALL render a `+Worktree` button next to `+Session`, gated by the `gitWorktreeEnabled` config flag (default true) — mirroring the folder-header `+Worktree` gate. It SHALL NOT be gated on `session.status` or `session.sessionFile`. It SHALL be hidden when the session is already a worktree session (`session.gitWorktree` set), since spawning a worktree from inside a worktree is redundant.

Click SHALL open the existing `WorktreeSpawnDialog` scoped to the parent session's `cwd`. When `session.attachedProposal` is a non-empty string, the dialog SHALL open via the proposal-aware path (pre-filled branch `os/<change>` + `attachProposal` carry-through); otherwise via the plain path (no proposal).

The button SHALL be `disabled` when `session.cwdMissing === true`, tooltip `session's directory no longer exists`. The card SHALL NOT implement its own worktree-creation, bootstrap, or `spawn_session` logic — it reuses the dialog's existing machinery.

#### Scenario: Visible next to +Session
- **WHEN** a session card renders with `gitWorktreeEnabled !== false` and a worktree handler supplied
- **THEN** the `+Worktree` button SHALL render alongside `+Session`

#### Scenario: Hidden when worktrees disabled
- **WHEN** the dashboard config has `gitWorktreeEnabled === false`
- **THEN** the `+Worktree` button SHALL NOT render (the `+Session` button is unaffected)

#### Scenario: Click with proposal opens proposal-aware dialog
- **WHEN** the user clicks `+Worktree` on a session with `attachedProposal = "add-dark-mode"`
- **THEN** the `WorktreeSpawnDialog` SHALL open scoped to the session's `cwd` with branch pre-filled `os/add-dark-mode` and `attachProposal` carried through

#### Scenario: Click without proposal opens plain dialog
- **WHEN** the user clicks `+Worktree` on a session with no `attachedProposal`
- **THEN** the `WorktreeSpawnDialog` SHALL open scoped to the session's `cwd` with no pre-filled proposal

#### Scenario: Disabled on missing cwd
- **WHEN** the parent session has `cwdMissing === true`
- **THEN** the `+Worktree` button SHALL render `disabled` and clicking SHALL NOT open the dialog

#### Scenario: Hidden on worktree session
- **WHEN** the session is already a worktree session (`session.gitWorktree` set)
- **THEN** the `+Worktree` button SHALL NOT render (the `+Session` button is unaffected)
