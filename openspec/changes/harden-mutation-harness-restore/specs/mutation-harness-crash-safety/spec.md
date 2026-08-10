# mutation-harness-crash-safety

## ADDED Requirements

### Requirement: A mutation SHALL be recoverable after process death

The mutation harness SHALL record the pre-mutation state of a source file to a
journal on disk before that file is modified, so that a process killed without
unwinding leaves enough information on disk to restore the tree.

#### Scenario: The harness process is killed mid-mutation

- **WHEN** the harness has mutated a source file and the process is terminated
  without unwinding (for example `SIGKILL`, an OOM kill, or an outer timeout)
- **THEN** a journal entry naming the mutated file and its pre-mutation bytes
  SHALL exist on disk
- **AND** the next harness run SHALL restore that file to its pre-mutation bytes

#### Scenario: The journal is written before the source file

- **WHEN** the harness prepares to apply a mutation
- **THEN** the journal entry SHALL be written and closed before the source file
  is modified
- **AND** a process killed between the two writes SHALL leave an unmodified
  source file and a journal entry that restores it to its own current content

#### Scenario: One entry per mutation, never a shared rewritten file

- **WHEN** a mutation is journaled while an earlier mutation is still applied on
  disk
- **THEN** the new entry SHALL be written as its own file, moved into place
  atomically
- **AND** an interrupted write of the new entry SHALL leave the earlier entry
  intact and readable

#### Scenario: Restored bytes are byte-identical

- **WHEN** a journaled file contains a byte order mark or bytes that are not
  valid UTF-8
- **THEN** reconciliation SHALL restore the file byte-for-byte
- **AND** the restored file SHALL NOT differ from its pre-mutation content by an
  encoding round trip

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
- **AND** the harness SHALL report the conflicting path and fail the run
  non-zero

#### Scenario: A conflict report names how to unblock it

- **WHEN** the harness refuses a file whose content matches neither recorded
  side
- **THEN** the report SHALL name the journal entry holding that file
- **AND** the report SHALL state that the operator may either restore the file
  to a recorded side or remove that entry to accept the current content

#### Scenario: The journaled file no longer exists

- **WHEN** reconciliation finds a journal entry whose source file is absent from
  the working tree
- **THEN** it SHALL NOT recreate the file
- **AND** it SHALL NOT remove the entry
- **AND** it SHALL report the path and fail the run non-zero

#### Scenario: An unreadable journal entry is treated as a conflict

- **WHEN** reconciliation finds a journal entry it cannot parse
- **THEN** it SHALL NOT modify any source file on account of that entry
- **AND** it SHALL NOT remove the entry
- **AND** it SHALL report the entry and fail the run non-zero

### Requirement: An unreconciled tree SHALL fail the run closed

A test run that begins with a journal entry it cannot resolve SHALL treat the
working tree as being of unknown provenance and SHALL refuse to run any test
against it. A journal it CAN fully resolve SHALL be restored and reported, and
the run SHALL continue.

#### Scenario: A previous run left recoverable residue

- **WHEN** a test run starts and every journal entry resolves to a clean restore
- **THEN** it SHALL restore each entry and report each restored path
- **AND** it SHALL proceed with the run

#### Scenario: A previous run left a conflict

- **WHEN** a test run starts and any journal entry cannot be cleanly resolved
- **THEN** it SHALL report every unresolved path
- **AND** it SHALL fail the run non-zero without executing any test

#### Scenario: Reconciliation completes before any test file loads a source file

- **WHEN** a test run starts with a non-empty journal
- **THEN** reconciliation SHALL complete before any test project begins
  executing
- **AND** no test file SHALL observe the mutated content of a journaled source
  file

#### Scenario: A conflict blocks every project, not only the mutation checks

- **WHEN** a test run starts and reconciliation reports a conflict
- **THEN** no test project SHALL execute, including projects unrelated to the
  mutated file

#### Scenario: A clean start is unaffected

- **WHEN** a test run starts and the journal is empty or absent
- **THEN** it SHALL proceed with its mutation checks
- **AND** it SHALL NOT report a reconciliation

### Requirement: An interrupt SHALL restore and stop, not resume

A signal the process can catch SHALL restore the tree and terminate, because a
mutation check resumed against a restored file reports a false result.

#### Scenario: The harness receives SIGINT mid-mutation

- **WHEN** the harness receives `SIGINT` or `SIGTERM` while a mutation is
  applied
- **THEN** it SHALL restore the mutated file and remove its journal entry
- **AND** it SHALL terminate non-zero without reporting a result for the
  in-flight mutation

### Requirement: A second concurrent run SHALL be refused

The harness assumes a single writer per working tree. A second run that finds an
existing journal entry for a file it is about to mutate SHALL refuse rather than
interleave, because two runs restoring each other's mutations reproduces exactly
the residue this capability prevents.

#### Scenario: Two harness runs overlap in one worktree

- **WHEN** a harness run journals a mutation for a source file that already has
  a journal entry
- **THEN** it SHALL fail rather than overwrite or reuse that entry
- **AND** it SHALL NOT modify the source file
