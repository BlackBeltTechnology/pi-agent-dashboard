## MODIFIED Requirements

### Requirement: Trusted hook auto-runs after spawn
When `autoInitWorktreeOnSpawn` is `true`, after a successful worktree spawn the client SHALL probe init-status for the new checkout and SHALL auto-invoke the existing init flow ONLY when the hook is trusted and `needsInit` is true. When the init-status probe is refused with `cwd_unknown` (the new checkout is not yet admitted because its spawned session has not registered), the client SHALL re-probe every 500 ms for at most 10 seconds and SHALL give up silently when the deadline passes.

#### Scenario: Trusted hook auto-inits
- **WHEN** a worktree is spawned, the preference is ON, and init-status reports `{ hasHook: true, needsInit: true, trusted: true }`
- **THEN** the client SHALL call `POST /api/git/worktree/init` for the new checkout without user interaction
- **AND** progress SHALL stream via the existing worktree-init bus

#### Scenario: No-op when nothing to initialize
- **WHEN** a worktree is spawned, the preference is ON, and init-status reports `needsInit: false`
- **THEN** no init run SHALL be triggered

#### Scenario: Auto-init waits for the spawned session to register
- **WHEN** a worktree is spawned from a session inside a sibling linked worktree, the repository's main checkout is not a known folder, the preference is ON, and the first init-status probe returns `cwd_unknown`
- **THEN** the client SHALL re-probe every 500 ms
- **AND** once the spawned session is registered and init-status reports `{ hasHook: true, needsInit: true, trusted: true }`, the client SHALL call `POST /api/git/worktree/init`

#### Scenario: Auto-init gives up after 10 seconds
- **WHEN** init-status keeps returning `cwd_unknown` for 10 seconds after the spawn
- **THEN** the client SHALL stop probing, SHALL NOT call `POST /api/git/worktree/init`, and SHALL show no error
