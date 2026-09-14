## MODIFIED Requirements

### Requirement: Cold-start grouping parity for worktree/workspace sessions
A session restored from `.meta.json` at server startup, before any bridge has reattached, SHALL group under the same parent path that a live bridge would produce. The startup scanner SHALL reconstruct `session.gitWorktree` from persisted `mainPath`/`name`, so `resolveSessionGroupPath` collapses the restored session under its parent repo. Because the parent path is pinned or workspace-owned, its group SHALL render regardless of how many of its sessions are alive — restored ended worktree sessions SHALL therefore remain visible.

When persisted parentage is absent or implausible, the scanner SHALL infer it from the dashboard's own worktree layout: an ABSOLUTE cwd of the form `<X>/.worktrees/<name>[/<sub>...]` — split at the FIRST `.worktrees` path segment, with `<X>` non-empty — where `<X>` directly contains a `.git` entry SHALL yield `gitWorktree = { mainPath: <X>, name: <name> }`. The inference SHALL NOT write to `.meta.json` and SHALL NOT spawn a subprocess. Cwds without a `.worktrees` segment, or whose `<X>` lacks `.git`, SHALL keep status quo.

#### Scenario: Cold-start worktree session collapses under pinned parent
- **WHEN** the server restarts and restores an ended session with persisted `gitWorktree.mainPath = "/repo"` and `cwd = "/repo/.worktrees/feat-x"`
- **AND** `/repo` is pinned and `/repo/.worktrees/feat-x` is not pinned
- **AND** no bridge has reattached
- **THEN** the session SHALL render inside the `/repo` group, not in a separate `/repo/.worktrees/feat-x` group

#### Scenario: Cold-start worktree session links to its OpenSpec change row
- **WHEN** a restored worktree session has persisted `gitWorktree.mainPath = "/repo"` and `attachedProposal = "add-foo"`
- **AND** the change `add-foo` exists in `/repo`'s OpenSpec data and no bridge has reattached
- **THEN** the session SHALL appear in `/repo`'s group session list
- **AND** the `add-foo` change row in the folder's OpenSpec section SHALL list the session as a linked session

#### Scenario: Missing parentage inferred from `.worktrees/` layout
- **WHEN** the server restores an ended session whose `.meta.json` lacks parentage (key absent, or `null`) and `cwd = "/repo/.worktrees/feat-x"`
- **AND** `/repo/.git` exists
- **THEN** the session SHALL carry `gitWorktree = { mainPath: "/repo", name: "feat-x" }`
- **AND** the session SHALL render inside the `/repo` group
- **AND** the inference SHALL NOT write to `.meta.json`

#### Scenario: Session cwd is a subdirectory of the worktree
- **WHEN** the server restores an ended session whose `.meta.json` lacks parentage and `cwd = "/repo/.worktrees/feat-x/packages/foo"`
- **AND** `/repo/.git` exists
- **THEN** the session SHALL carry `gitWorktree = { mainPath: "/repo", name: "feat-x" }`

#### Scenario: Implausible persisted parentage is replaced by inference
- **WHEN** the server restores an ended session whose persisted `gitWorktree.mainPath` fails the plausibility filter and `cwd = "/repo/.worktrees/feat-x"` with `/repo/.git` present
- **THEN** the session SHALL carry `gitWorktree = { mainPath: "/repo", name: "feat-x" }`

#### Scenario: Inference declines for a relative or leading-`.worktrees` cwd
- **WHEN** the server restores a session whose cwd is `.worktrees/feat-x` (relative) or `/.worktrees/feat-x`
- **THEN** no parentage SHALL be inferred and no `.git` stat SHALL be attempted

#### Scenario: Inference declines when parent is not a repo
- **WHEN** the server restores an ended session whose `.meta.json` lacks parentage and `cwd = "/scratch/.worktrees/feat-x"`
- **AND** `/scratch/.git` does not exist
- **THEN** the session SHALL group under its own `cwd`

#### Scenario: Legacy session without persisted parentage
- **WHEN** the server restores an ended worktree session whose `.meta.json` lacks persisted parentage and whose cwd contains no `.worktrees` path segment
- **THEN** the session SHALL group under its own `cwd` (status quo) until a bridge attaches once and re-stamps the meta
