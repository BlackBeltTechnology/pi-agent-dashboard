## Purpose

Let trusted server plugins spawn a pi session in a git worktree — created or reused for a named branch, optionally attached to an OpenSpec change — through the same rules as the dashboard's worktree dialog.

## ADDED Requirements

### Requirement: A plugin spawn can target a created or reused worktree

When a trusted plugin calls `spawnSession` with `mode: "worktree"` and a
`worktree` block `{ branch, base?, ifExists, attachChange? }`, the host SHALL
resolve the repository of `cwd`, then:

- when no worktree exists for `branch`, create one using the same location,
  exclude-file and branch rules as the dashboard's worktree-create endpoint,
  branching from `base` (default: the repository's default base);
- when a worktree for `branch` exists and `ifExists` is `reuse`, use it;
- when a worktree for `branch` exists and `ifExists` is `fail`, fail with
  `exists` and spawn nothing.

The session SHALL be spawned with the worktree path as its cwd. The result SHALL
report the worktree path, branch, and whether it was created.

#### Scenario: Create a new worktree

- **GIVEN** repository `/repo` with no worktree for `os/add-x`
- **WHEN** a trusted plugin spawns with `worktree: { branch: "os/add-x", ifExists: "reuse" }`
- **THEN** a worktree for `os/add-x` SHALL be created under the repository's worktree directory
- **AND** the session SHALL run in it and the result SHALL report `created: true`

#### Scenario: Reuse an existing worktree

- **GIVEN** a worktree for `os/add-x` already exists
- **WHEN** a plugin spawns with `ifExists: "reuse"`
- **THEN** no new worktree SHALL be created and the session SHALL run in the existing one with `created: false`

#### Scenario: Existing worktree with fail policy

- **GIVEN** a worktree for `os/add-x` already exists
- **WHEN** a plugin spawns with `ifExists: "fail"`
- **THEN** the spawn SHALL fail with `exists` and no session SHALL start

### Requirement: Worktree spawns fail typed and never fall back to local

A spawn with a `worktree` block SHALL fail with a typed reason and SHALL NOT spawn
a session in `cwd` when: `cwd` is not inside a git repository (`not_git`), the
branch name is not a valid git ref name or would resolve outside the worktree
directory (`branch_invalid`), or a git operation fails (`git_failed`). A spawn
with `mode: "worktree"` and no `worktree` block SHALL keep the existing
behaviour of running in `cwd`.

#### Scenario: Non-git folder

- **WHEN** a plugin spawns with a `worktree` block for a cwd outside any git repository
- **THEN** the spawn SHALL fail with `not_git` and no session SHALL start

#### Scenario: Hostile branch name

- **WHEN** the branch is `../../etc` or contains characters git rejects in ref names
- **THEN** the spawn SHALL fail with `branch_invalid` and no git command SHALL create anything

#### Scenario: Legacy mode without block

- **WHEN** a plugin spawns with `mode: "worktree"` and no `worktree` block
- **THEN** the session SHALL run in `cwd` exactly as before this change

### Requirement: Attachment and init follow the dashboard's existing rules

When `attachChange` is set, the spawned session SHALL be attached to that change
exactly as a dialog-spawned worktree session with `attachProposal` is. After a
worktree is created, the worktree-init hook SHALL run only when the user's
auto-init preference is on AND the hook is trusted; an untrusted hook SHALL NOT
run, and its pending-init state SHALL surface as it does for dialog spawns.

#### Scenario: Attach at spawn

- **WHEN** a plugin spawns with `attachChange: "add-x"`
- **THEN** the registered session SHALL be attached to change `add-x`

#### Scenario: Untrusted init hook

- **GIVEN** the repository declares an untrusted worktree-init hook and auto-init is on
- **WHEN** a plugin spawn creates a worktree
- **THEN** the hook SHALL NOT run and the worktree SHALL show its pending-init state

### Requirement: Concurrent worktree spawns for one branch are serialized

Worktree create-or-reuse SHALL be serialized per repository. Two concurrent
spawns for the same branch SHALL result in at most one created worktree; the
second SHALL observe it and apply its `ifExists` policy.

#### Scenario: Two spawns race

- **WHEN** two plugin spawns for branch `os/add-x` with `ifExists: "reuse"` start at the same time
- **THEN** exactly one worktree SHALL be created and both sessions SHALL run in it

### Requirement: Only trusted plugins may spawn into worktrees

The `worktree` block SHALL be honoured only for plugins already permitted to call
`spawnSession`. For any other caller the spawn SHALL be refused.

#### Scenario: Untrusted plugin

- **WHEN** an untrusted plugin passes a `worktree` block
- **THEN** no worktree SHALL be created and the spawn SHALL be refused
