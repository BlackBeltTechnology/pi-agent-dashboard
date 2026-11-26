## Purpose

Let trusted server plugins spawn a pi session in a git worktree — created or reused for a named branch, optionally attached to an OpenSpec change — through the same rules as the dashboard's worktree dialog.

## ADDED Requirements

### Requirement: A plugin spawn can target a created or reused worktree

When a trusted plugin calls `spawnSession` with `mode: "worktree"` and a `worktree` block `{ branch, base?, ifExists, attachChange? }`, the host SHALL run the session in a worktree for `branch` of the repository that contains `cwd`, creating one with the dashboard's worktree-create rules when none exists. The result SHALL report the worktree path, the branch and whether the worktree was created.

#### Scenario: Create a new worktree

- **GIVEN** repository `/repo` with no local or `origin` branch `os/add-x` and no worktree for it
- **WHEN** a trusted plugin spawns with `worktree: { branch: "os/add-x", ifExists: "reuse" }`
- **THEN** a worktree on new branch `os/add-x`, forked from the repository's default base, SHALL exist under `/repo/.worktrees/`
- **AND** the session SHALL run in it and the result SHALL report `created: true`

#### Scenario: Reuse an existing worktree

- **GIVEN** a worktree for `os/add-x` already exists
- **WHEN** a plugin spawns with `ifExists: "reuse"`
- **THEN** no worktree SHALL be created, the session SHALL run in the existing one and the result SHALL report `created: false`

#### Scenario: Existing local branch without a worktree

- **GIVEN** local branch `os/add-x` exists with commits ahead of the default base and has no worktree
- **WHEN** a plugin spawns for `os/add-x`
- **THEN** the new worktree SHALL check out `os/add-x` at its current commit, not a new branch from the base

#### Scenario: Branch only on origin

- **GIVEN** only `origin/os/add-x` exists
- **WHEN** a plugin spawns for `os/add-x`
- **THEN** the new worktree SHALL be on local branch `os/add-x` starting at `origin/os/add-x`

### Requirement: An existing worktree with the fail policy spawns nothing

When a worktree for the requested branch already exists and `ifExists` is `fail`, the spawn SHALL fail with code `exists` and no session SHALL start.

#### Scenario: Existing worktree with fail policy

- **GIVEN** a worktree for `os/add-x` already exists
- **WHEN** a plugin spawns with `ifExists: "fail"`
- **THEN** the result SHALL be `success: false` with `code: "exists"` and no session SHALL start

### Requirement: Worktree spawns fail typed and never fall back to local

When a spawn with a `worktree` block cannot get a contained worktree, it SHALL return `success: false` with a typed `code`, SHALL NOT spawn a session and SHALL leave no queued spawn intent. A malformed block SHALL fail the same way. A spawn with `mode: "worktree"` and no `worktree` block SHALL keep running in `cwd`.

#### Scenario: Non-git folder

- **WHEN** a plugin spawns with a `worktree` block for a `cwd` outside any git repository
- **THEN** the result SHALL carry `code: "not_git"` and no session SHALL start

#### Scenario: Hostile branch name

- **WHEN** the branch is `../../etc`, starts with `-`, or contains characters git rejects in ref names
- **THEN** the result SHALL carry `code: "branch_invalid"` and no worktree, branch or directory SHALL be created

#### Scenario: Branch checked out in the main checkout

- **GIVEN** the main checkout of `/repo` is on branch `os/add-x`
- **WHEN** a plugin spawns for `os/add-x` with `ifExists: "reuse"`
- **THEN** the result SHALL carry `code: "branch_in_use"` and no session SHALL start in the main checkout

#### Scenario: Malformed block

- **WHEN** a plugin spawns with `mode: "worktree"` and `worktree: "os/add-x"` (a string)
- **THEN** the result SHALL carry `code: "invalid_block"` and no session SHALL start, in `cwd` or elsewhere

#### Scenario: Registered worktree outside the worktree directory

- **GIVEN** branch `os/add-x` is checked out in a worktree registered at `/elsewhere/add-x`
- **WHEN** a plugin spawns for `os/add-x` with `ifExists: "reuse"`
- **THEN** the result SHALL carry `code: "branch_in_use"` and no session SHALL start

#### Scenario: Unknown base

- **WHEN** a plugin spawns with `base: "no-such-ref"` for a new branch
- **THEN** the result SHALL carry `code: "base_not_found"` and no session SHALL start

#### Scenario: Legacy mode without block

- **WHEN** a plugin spawns with `mode: "worktree"` and no `worktree` block
- **THEN** the session SHALL run in `cwd` exactly as before this change

### Requirement: Attachment and init follow the dashboard's existing rules

When `attachChange` is set, the session SHALL be attached to that change as a dialog-spawned worktree session with `attachProposal` is, and its initial prompt SHALL be delivered in the worktree. With auto-init on, a trusted hook that needs init SHALL finish before the session spawns. An untrusted hook SHALL NOT run.

#### Scenario: Attach and prompt at spawn

- **WHEN** a plugin spawns with `attachChange: "add-x"` and `initialPrompt: "/skill:ship-it"`
- **THEN** the session registered in the worktree SHALL be attached to change `add-x` and SHALL receive `/skill:ship-it` as its first prompt
- **AND** no prompt intent SHALL remain queued for the original `cwd`

#### Scenario: Trusted hook with auto-init on

- **GIVEN** a repository whose worktree-init hook is trusted, and auto-init is on
- **WHEN** a plugin spawn creates or reuses a worktree whose init gate reports init needed
- **THEN** an init run SHALL be registered for that worktree and its progress SHALL be broadcast as for a dialog-triggered run
- **AND** the session SHALL spawn only after the run succeeds; a failed run SHALL return `code: "init_failed"` and spawn nothing

#### Scenario: Untrusted init hook

- **GIVEN** the repository declares an untrusted worktree-init hook and auto-init is on
- **WHEN** a plugin spawn creates a worktree
- **THEN** the hook SHALL NOT run and the worktree's init status SHALL report it as needing init

#### Scenario: Failed spawn leaves no queued intent

- **GIVEN** a spawn with `attachChange: "add-x"` whose session process fails to start
- **WHEN** a later session registers in the same worktree
- **THEN** it SHALL NOT be attached to `add-x` by the failed spawn's intent

### Requirement: Concurrent worktree spawns for one branch are serialized

Worktree create-or-reuse SHALL be serialized per repository. Two concurrent spawns for the same branch, from plugins or the dashboard's worktree-create endpoint, SHALL create at most one worktree; a plugin spawn that loses the race SHALL observe it and apply its `ifExists` policy. Pairing of attach and prompt intents between concurrent spawns into one worktree is not guaranteed.

#### Scenario: Two spawns race

- **WHEN** two plugin spawns for `os/add-x` with `ifExists: "reuse"` start at the same time
- **THEN** exactly one worktree SHALL be created and both sessions SHALL run in it

### Requirement: Only trusted plugins may spawn into worktrees

The `worktree` block SHALL be honoured only for plugins already permitted to call `spawnSession`. For any other caller the spawn SHALL be refused before any git command runs.

#### Scenario: Untrusted plugin

- **WHEN** an untrusted plugin passes a `worktree` block
- **THEN** no worktree SHALL be created and the spawn SHALL be refused
