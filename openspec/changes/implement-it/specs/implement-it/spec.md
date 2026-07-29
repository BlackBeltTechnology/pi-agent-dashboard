## ADDED Requirements

### Requirement: Orchestrator-side dispatch of a change to a worktree session

The `implement-it` skill SHALL run in the orchestrator (main) session and
dispatch an OpenSpec change's implementation to a freshly created git worktree
running a spawned pi session, without requiring the human to create the worktree
or type the trigger by hand. The skill SHALL resolve the target change name from
its argument, the conversation, or `openspec list --json`, and SHALL ask the user
to disambiguate when the change is ambiguous.

#### Scenario: Change name resolved from argument
- **WHEN** the skill is invoked as `implement-it <change>` with a name that
  matches an existing change under `openspec/changes/`
- **THEN** the skill SHALL use `<change>` as the target without prompting for it

#### Scenario: Ambiguous change name
- **WHEN** the target change cannot be determined unambiguously from the
  argument or conversation
- **THEN** the skill SHALL call `ask_user` to select the change before
  proceeding, and SHALL NOT create a worktree or spawn a session first

### Requirement: Pre-dispatch ask_user gate

Before creating any worktree or spawning any session, the skill SHALL collect,
via a single `ask_user` batch, the free-form instructions/prompt for the child
LLM, the base ref (default `origin/develop`), and the post-spawn monitor mode.
The free-form prompt is the sole mechanism for steering the child session.

#### Scenario: Gate collects dispatch inputs
- **WHEN** the skill has resolved the target change
- **THEN** the skill SHALL `ask_user` (batch) for the free-form prompt, the base
  ref, and the monitor mode BEFORE any mutating REST or bus call

#### Scenario: Free-form prompt becomes the initial prompt
- **WHEN** the user supplies free-form instructions in the gate
- **THEN** that text SHALL be passed verbatim as the spawned session's
  `initialPrompt`, relying on NL skill auto-load in the child (e.g. a
  `/ship-it` or `/opsx-apply` trigger embedded in the prompt)

### Requirement: Worktree creation via REST

The skill SHALL create the change's worktree by issuing `POST /api/git/worktree`
(the dashboard's REST endpoint — the only creation path, which has no WebSocket
bus twin), using the convention `path = .worktrees/os-<change>` on
`newBranch = os/<change>` from the selected base ref. The skill SHALL use the
`path` returned by the endpoint as the spawn `cwd`.

#### Scenario: Worktree created successfully
- **WHEN** `POST /api/git/worktree` returns `success: true` with `{ path, branch }`
- **THEN** the skill SHALL use the returned `path` as the `cwd` for the
  subsequent session spawn

#### Scenario: Worktree or branch already exists
- **WHEN** `POST /api/git/worktree` returns `409` (`branch_exists` /
  `path_exists`)
- **THEN** the skill SHALL either reuse the existing worktree at the conventional
  path or invoke `POST /api/git/worktree/orphan-cleanup`, and SHALL NOT silently
  proceed as if creation succeeded

#### Scenario: Worktree creation rejected
- **WHEN** `POST /api/git/worktree` returns a non-recoverable error (e.g. `400`
  `base_not_found` / `not_a_repo`)
- **THEN** the skill SHALL surface the error and STOP without spawning a session

### Requirement: Session spawn via typed bus client

The skill SHALL spawn the pi session using the typed bus client
(`bus.spawn` / `dashboard-bus.ts`), passing `cwd` (the worktree path),
`gitWorktreeBase` (the selected base ref, for `.meta.json` parity with the UI),
the free-form `initialPrompt`, and `attachProposal` set to the change name. The
skill SHALL NOT create the worktree through the bus (no such verb exists).

#### Scenario: Spawn carries dispatch context
- **WHEN** worktree creation has succeeded
- **THEN** the skill SHALL call `bus.spawn` with `cwd` = worktree path,
  `gitWorktreeBase` = base ref, `attachProposal` = change name, and
  `initialPrompt` = the free-form prompt

#### Scenario: Spawn failure surfaced
- **WHEN** the bus `spawn` reply reports failure
- **THEN** the skill SHALL surface the failure message and SHALL NOT report the
  dispatch as successful

### Requirement: Monitor mode after spawn

After a successful spawn the skill SHALL honor the monitor mode selected in the
gate. Fire-and-forget SHALL report the child session id and return immediately.
Wait-until-idle SHALL wait for the child session to reach `idle`, then report its
status and file changes.

#### Scenario: Fire-and-forget
- **WHEN** the monitor mode is fire-and-forget
- **THEN** the skill SHALL report the spawned session id and return without
  waiting for the child to finish

#### Scenario: Wait until idle then report
- **WHEN** the monitor mode is wait-until-idle
- **THEN** the skill SHALL `until <id> idle`, then report the child's final
  status and its session diff
