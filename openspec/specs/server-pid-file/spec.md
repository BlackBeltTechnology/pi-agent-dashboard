# server-pid-file Specification

## Purpose

Track the running dashboard server process across start, stop, and restart by writing, reading, and removing a PID file at `~/.pi/dashboard/server.pid`. Provide liveness detection that reconciles the recorded PID against actual process and dashboard health, cleaning up stale records automatically.

## Requirements

### Requirement: PID File Persistence

The system SHALL persist the running server's process ID to a PID file, defaulting to `~/.pi/dashboard/server.pid`, and SHALL allow the path to be overridden via a `pidPath` option.

#### Scenario: Write PID on server start

- **WHEN** `writePid` is called with a process ID
- **THEN** the parent directory of the PID file path is created recursively if it does not exist
- **AND** the PID is written to the file as its decimal string followed by a newline character

#### Scenario: Custom PID path override

- **WHEN** any PID operation is called with a `pidPath` option
- **THEN** that path is used instead of the default `~/.pi/dashboard/server.pid`

#### Scenario: Remove PID on server stop

- **WHEN** `removePid` is called
- **THEN** the PID file is deleted
- **AND** if the file does not exist the operation completes without error

### Requirement: PID File Reading and Validation

The system SHALL read the PID from the PID file, parse it as a base-10 integer, and return the numeric PID only when it is a finite value greater than zero; otherwise it SHALL return null.

#### Scenario: Read a valid PID

- **WHEN** `readPid` is called and the file contains a positive integer
- **THEN** the file content is trimmed of surrounding whitespace and parsed as a base-10 integer
- **AND** the parsed PID is returned

#### Scenario: Missing PID file

- **WHEN** `readPid` is called and the PID file does not exist or cannot be read
- **THEN** null is returned

#### Scenario: Corrupt or non-positive PID content

- **WHEN** `readPid` is called and the parsed value is not finite or is less than or equal to zero
- **THEN** null is returned

### Requirement: Server Liveness Detection with Stale Cleanup

The system SHALL determine whether the dashboard server is running by combining the recorded PID with a process-liveness check and a dashboard health check on the given port, and SHALL remove the PID file when it is found to be stale.

#### Scenario: Server confirmed running

- **WHEN** `isServerRunning` is called and the recorded PID belongs to a live process
- **AND** the dashboard health check on the given port reports running
- **THEN** the recorded PID is returned

#### Scenario: No recorded PID

- **WHEN** `isServerRunning` is called and `readPid` returns null
- **THEN** null is returned

#### Scenario: Live process but dashboard not responding (recycled PID)

- **WHEN** `isServerRunning` is called and the recorded PID belongs to a live process
- **AND** the dashboard health check on the given port does not report running
- **THEN** the PID file is removed as stale
- **AND** null is returned

#### Scenario: Dead process PID

- **WHEN** `isServerRunning` is called and the recorded PID does not belong to a live process
- **THEN** the PID file is removed as stale
- **AND** null is returned
