# ship-workflow

## ADDED Requirements

### Requirement: develop integration precedes the strongest ship gate

The ship workflow SHALL integrate `origin/develop` into the change's worktree
branch **before** the strongest validation gate that will run, so that gate
validates the tree that the PR ships.

- The integration SHALL be a merge of the remote ref `origin/develop`
  (`git merge --no-edit origin/develop`), NOT a rebase, and SHALL never require a
  force-push.
- Under `ship-it`, the merge SHALL occur before the docker e2e harness step, so
  the harness validates the merged tree.
- Under standalone `ship-change`, the merge SHALL occur before the vitest+build
  verify gate.
- The merge SHALL be idempotent: when the branch is already up to date it
  produces no merge commit.
- On an unresolved merge conflict the workflow SHALL abort the merge and STOP
  (report), and SHALL NOT proceed to any gate or open a PR.

#### Scenario: worktree behind develop, shipped via ship-it

- **GIVEN** a worktree branch based on a `develop` that has since advanced
- **WHEN** `ship-it` runs
- **THEN** `origin/develop` is merged before the harness step
- **AND** the harness validates the merged tree
- **AND** the PR opens with `mergeStateStatus=MERGEABLE`, not `DIRTY`

#### Scenario: standalone ship-change integrates before the verify gate

- **GIVEN** `ship-change` invoked directly (no harness) on a stale branch
- **WHEN** the workflow reaches the verify gate
- **THEN** `origin/develop` has already been merged
- **AND** `npm test` + build run against the merged tree

#### Scenario: up-to-date branch is a no-op

- **GIVEN** a worktree branch already current with `origin/develop`
- **WHEN** the integration step runs
- **THEN** no merge commit is created and the workflow proceeds unchanged

#### Scenario: conflict aborts before any gate

- **GIVEN** merging `origin/develop` produces an unresolved conflict
- **WHEN** the resolution recipes do not fully apply
- **THEN** the merge is aborted, the workflow STOPs and reports
- **AND** no PR is opened
