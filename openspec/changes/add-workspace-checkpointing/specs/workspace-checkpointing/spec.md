# workspace-checkpointing — delta

## ADDED Requirements

### Requirement: Per-turn snapshot captured at turn end
For a checkpointing-enabled git-repo session, the bridge SHALL capture a snapshot of the full
working tree (tracked and untracked files, excluding `.gitignore`d paths) at each `turn_end`.
The snapshot SHALL be written as a commit under `refs/pi-checkpoints/<sessionId>/<turn>` using a
temporary index, and SHALL NOT modify `HEAD`, the working index, the user's branches, or the
`git stash`. Capture SHALL run off the turn's critical path; a capture failure SHALL degrade to
"no checkpoint for that turn" and SHALL NOT block or fail the turn.

#### Scenario: Snapshot leaves user git state untouched
- **GIVEN** a git-repo session with checkpointing enabled
- **WHEN** a turn ends after editing files
- **THEN** a ref `refs/pi-checkpoints/<sessionId>/<turn>` SHALL point at a commit whose tree
  matches the working tree
- **AND** `HEAD`, the index, the branch set, and the stash list SHALL be unchanged

#### Scenario: Untracked included, ignored excluded
- **WHEN** a turn creates a new untracked file and a `.gitignore`d artifact
- **THEN** the snapshot SHALL include the untracked file
- **AND** SHALL NOT include the ignored artifact

#### Scenario: Unchanged tree is not re-snapshotted
- **WHEN** a turn ends with a working tree identical to the previous snapshot
- **THEN** no new checkpoint ref SHALL be created

#### Scenario: Capture failure does not break the turn
- **WHEN** snapshot capture throws
- **THEN** the turn SHALL complete normally with no checkpoint recorded for it

### Requirement: Non-git and disabled sessions do not checkpoint
The bridge SHALL NOT capture snapshots when the session cwd is not a git repository or
checkpointing is disabled for the session, and the timeline SHALL present a disabled/empty state.

#### Scenario: Non-git session
- **GIVEN** a session whose cwd is not a git repository
- **WHEN** turns end
- **THEN** no snapshots SHALL be captured
- **AND** the timeline SHALL indicate checkpointing requires a git repository

### Requirement: Diff between any two turns
The dashboard SHALL render the diff between any two checkpoint snapshots of a session using the
existing diff surface, computed as `git diff` between the two checkpoint refs.

#### Scenario: Diff two checkpoints
- **WHEN** the operator selects a checkpoint and requests its diff versus the previous or
  current state
- **THEN** the client SHALL render the `git diff` between the two snapshot refs in the existing
  diff viewer

### Requirement: Non-destructive revert to a turn
Reverting a session to checkpoint N SHALL first capture a pre-revert safety snapshot of the
current working tree, then restore the working tree to exactly snapshot N (including deleting
files added after N). Because the pre-revert snapshot exists, the revert SHALL be reversible.

#### Scenario: Revert restores the tree exactly
- **GIVEN** checkpoints for turns 1..3
- **WHEN** the operator reverts to turn 1
- **THEN** the working tree SHALL exactly equal snapshot 1 (added-after files removed)
- **AND** a pre-revert safety snapshot of the turn-3 state SHALL exist

#### Scenario: Revert is reversible (redo)
- **WHEN** the operator reverts to the pre-revert safety snapshot after a revert
- **THEN** the working tree SHALL be restored to the state that existed before the revert

#### Scenario: Revert requires explicit confirmation
- **WHEN** the operator triggers a revert
- **THEN** the action SHALL require an explicit confirmation before the working tree is modified

### Requirement: Revert is gated behind authentication
The revert control SHALL be subject to the dashboard's existing authentication (bearer-auth /
pairing) so it is not reachable unauthenticated when the dashboard is exposed remotely. Snapshot
and restore operations SHALL be confined to `refs/pi-checkpoints/*` and the session cwd.

#### Scenario: Unauthenticated revert rejected
- **WHEN** a revert is requested without a valid session/credential on a gated deployment
- **THEN** the server SHALL reject it and the working tree SHALL be unchanged

### Requirement: Bounded retention
The system SHALL keep at most a configurable last-N snapshots per session and SHALL prune the
session's `refs/pi-checkpoints/<sessionId>/*` namespace when the session is archived or removed.

#### Scenario: Old snapshots pruned
- **WHEN** a session exceeds the retention cap of N snapshots
- **THEN** only the most recent N SHALL be retained

#### Scenario: Namespace cleaned on archive
- **WHEN** a session is archived or removed
- **THEN** its `refs/pi-checkpoints/<sessionId>/*` refs SHALL be deleted
