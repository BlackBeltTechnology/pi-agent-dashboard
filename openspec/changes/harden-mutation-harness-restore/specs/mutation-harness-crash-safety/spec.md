# mutation-harness-crash-safety

## ADDED Requirements

### Requirement: A mutation SHALL be recoverable after process death

The mutation harness SHALL record the pre-mutation state of a source file to a
durable journal before that file is modified, so that a process killed without
unwinding leaves enough information on disk to restore the tree.

#### Scenario: The harness process is killed mid-mutation

- **WHEN** the harness has mutated a source file and the process is terminated
  without unwinding (for example `SIGKILL`, an OOM kill, or an outer timeout)
- **THEN** a journal entry naming the mutated file and its pre-mutation bytes
  SHALL exist on disk
- **AND** the next harness run SHALL restore that file to its pre-mutation bytes

#### Scenario: The journal is written before the source file

- **WHEN** the harness prepares to apply a mutation
- **THEN** the journal entry SHALL be durably written before the source file is
  modified
- **AND** a process killed between the two writes SHALL leave an unmodified
  source file and a journal entry that restores it to its own current content

#### Scenario: A completed mutation leaves no journal entry

- **WHEN** a mutation is applied and its restore completes normally
- **THEN** the corresponding journal entry SHALL be removed
- **AND** a subsequent harness run SHALL report nothing to reconcile

### Requirement: Reconciliation SHALL NOT destroy uncommitted work

Restoration SHALL use the bytes captured in the journal and SHALL NOT recover
the file from version control, because a mutated file may carry uncommitted
changes that predate the mutation.

#### Scenario: The mutated file had uncommitted edits

- **WHEN** a file carrying uncommitted changes is mutated and the process is
  killed
- **THEN** reconciliation SHALL restore the file to its pre-mutation content
  including those uncommitted changes
- **AND** the file SHALL NOT be reverted to its committed state

#### Scenario: The file changed after the kill

- **WHEN** reconciliation finds that the on-disk file no longer matches the
  mutated content the journal recorded
- **THEN** the harness SHALL NOT overwrite it
- **AND** the harness SHALL report the conflicting path and exit non-zero

### Requirement: A stale journal SHALL fail the run closed

A harness run that begins with a non-empty journal SHALL treat the working tree
as being of unknown provenance and SHALL refuse to report a result derived from
it.

#### Scenario: A previous run left residue

- **WHEN** the harness starts and finds a non-empty journal
- **THEN** it SHALL restore every recoverable entry
- **AND** it SHALL report each restored path
- **AND** it SHALL exit non-zero without running its mutation checks

#### Scenario: A clean start is unaffected

- **WHEN** the harness starts and the journal is empty or absent
- **THEN** it SHALL proceed with its mutation checks
- **AND** it SHALL NOT report a reconciliation
