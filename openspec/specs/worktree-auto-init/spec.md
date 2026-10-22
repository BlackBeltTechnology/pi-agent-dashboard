# Worktree Auto-Init

## Purpose

Opt-in dashboard preference (`autoInitWorktreeOnSpawn`, default `false`) that auto-runs the project worktree-init hook after a worktree spawn — gated on existing TOFU trust. Trusted + `needsInit` → client auto-invokes `POST /api/git/worktree/init`; untrusted degrades to the manual `WorktreeInitButton`.

## Requirements

### Requirement: Auto-init-on-spawn preference
The dashboard SHALL expose a global boolean preference `autoInitWorktreeOnSpawn`,
default `false`, persisted via the preferences store. When absent it SHALL read as
`false`. The Settings-panel toggle SHALL buffer its edit into the Settings draft and
persist only on Save; it SHALL NOT write the preference optimistically on each toggle.

#### Scenario: Preference defaults off
- **WHEN** a fresh install reads `autoInitWorktreeOnSpawn`
- **THEN** the value SHALL be `false`
- **AND** worktree spawn SHALL behave as today (manual Initialize button only)

#### Scenario: Preference toggled in Settings
- **WHEN** the user enables "Initialize on worktree" in Settings and saves from the Save Bar
- **THEN** the server SHALL persist `autoInitWorktreeOnSpawn = true` to `preferences.json`
- **AND** toggling without saving SHALL NOT write the preference

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

### Requirement: Untrusted hook never auto-runs
When `autoInitWorktreeOnSpawn` is `true` but the hook is untrusted, the client SHALL NOT auto-invoke the init flow. The `WorktreeInitButton` SHALL appear so the user can grant TOFU trust manually.

#### Scenario: Untrusted hook degrades to manual button
- **WHEN** a worktree is spawned, the preference is ON, and init-status reports `{ hasHook: true, needsInit: true, trusted: false }`
- **THEN** no automatic `POST /api/git/worktree/init` SHALL fire
- **AND** the Initialize button SHALL be visible for manual, trust-gated initialization

#### Scenario: Trust persists for subsequent spawns
- **WHEN** the user has previously trusted the hook (recorded in `worktree-init-trust.json`) and spawns another worktree of the same repo with the preference ON
- **THEN** init-status SHALL report `trusted: true`
- **AND** the client SHALL auto-init without prompting
