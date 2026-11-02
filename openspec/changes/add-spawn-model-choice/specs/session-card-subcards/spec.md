## MODIFIED Requirements

### Requirement: +Session sibling-spawn button on session card
The desktop session card SHALL offer an always-available New session action (formerly the inline `+Session` button) as an item of the session actions menu's SESSION group, with test id `session-card-spawn-sibling`. Unlike Fork/Resume, this action SHALL NOT be gated on `session.status === "ended"` or on the presence of `session.sessionFile` — it is offered for live and ended sessions alike.

Activation SHALL emit a `spawn_session` ws message with:
- `cwd` set to the parent session's `cwd`,
- `attachProposal` set to the parent session's `attachedProposal` when that field is a non-empty string (omitted otherwise),
- a fresh `requestId` (UUIDv4).
- `model` and `thinkingLevel` set to the parent session's `model` / `thinkingLevel` when the parent is a pi session and the field is a non-empty string (omitted otherwise).

The action SHALL be disabled when `session.cwdMissing === true`, with the reason `session's directory no longer exists`.

The action SHALL NOT carry `gitWorktreeBase` or any worktree-related metadata. Worktree-sibling spawning is covered by separate surfaces (New worktree session, folder `+Worktree`, per-change `⑂+`).

The action SHALL use the green session-spawn palette, consistent with every other session-spawn control (`FolderSpawnButtons` `+ New Session`, folder-section `spawn-attached`). Session-spawn actions SHALL NOT use the purple `accent` palette, which is reserved for OpenSpec actions (Attach / Archive).

#### Scenario: Visible on live session
- **WHEN** the session actions menu opens for a session with any non-ended status
- **THEN** the New session item SHALL render
- **AND** Fork SHALL render only when the session has a `sessionFile`, and Resume SHALL NOT render

#### Scenario: Visible on ended session alongside Fork
- **WHEN** the session actions menu opens for a session with `status === "ended"` and a valid `sessionFile`
- **THEN** New session, Resume and Fork SHALL all render in the SESSION group

#### Scenario: Click inherits cwd and proposal
- **WHEN** the user activates New session on a session with `cwd = "/project/foo"` and `attachedProposal = "add-dark-mode"`
- **THEN** a `spawn_session` ws message SHALL be sent with `cwd: "/project/foo"`, `attachProposal: "add-dark-mode"`, and a UUIDv4 `requestId`

#### Scenario: Click omits proposal when parent has none
- **WHEN** the user activates New session on a session whose `attachedProposal` is `null`, `undefined`, or empty string
- **THEN** the emitted `spawn_session` payload SHALL omit the `attachProposal` key entirely (not send empty string)

#### Scenario: Disabled on missing cwd
- **WHEN** the parent session has `cwdMissing === true`
- **THEN** the New session item SHALL be `aria-disabled="true"` with reason `session's directory no longer exists`
- **AND** activating it SHALL NOT emit a `spawn_session` message

#### Scenario: Sibling carries the parent's model and thinking level
- **GIVEN** a pi session with `model: "anthropic/claude-opus-5-5"` and `thinkingLevel: "high"`
- **WHEN** the user activates New session on its card
- **THEN** the emitted `spawn_session` SHALL carry `model: "anthropic/claude-opus-5-5"` and `thinkingLevel: "high"`

