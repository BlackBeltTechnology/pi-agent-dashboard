## ADDED Requirements

### Requirement: Directory group offers re-enabling an opted-out OpenSpec directory

The folder actions menu's `DIRECTORY` group SHALL contain an "Enable OpenSpec for this folder"
item **iff** the folder's cwd is listed in `openspec.optOutDirectories` (readiness state
`OPTED_OUT`).

Activating it SHALL remove the cwd from the opt-out list, restoring the readiness state the cwd
would otherwise have.

The item SHALL NOT render when the cwd is merely `ABSENT`; in that state the folder section
already offers Initialize, and a second entry point for the same decision would be redundant.

The item SHALL NOT render when OpenSpec is globally disabled, because removing a per-directory
opt-out cannot make OpenSpec available there.

#### Scenario: Opted-out directory can be re-enabled

- **WHEN** the folder actions menu opens for a cwd whose readiness state is `OPTED_OUT`
- **THEN** the directory group SHALL contain an "Enable OpenSpec for this folder" item

#### Scenario: Activating it removes the opt-out entry

- **WHEN** the user activates "Enable OpenSpec for this folder"
- **THEN** the cwd SHALL be removed from `openspec.optOutDirectories`
- **AND** the folder section SHALL begin rendering for that cwd again

#### Scenario: Item absent for a never-opted-out directory

- **WHEN** the folder actions menu opens for a cwd whose readiness state is `ABSENT`, `READY`,
  `BROKEN`, or `STALE`
- **THEN** no "Enable OpenSpec for this folder" item SHALL render

#### Scenario: Item absent when OpenSpec is globally disabled

- **WHEN** the folder actions menu opens for an opted-out cwd while `openspec.enabled` is
  `false`
- **THEN** no "Enable OpenSpec for this folder" item SHALL render
