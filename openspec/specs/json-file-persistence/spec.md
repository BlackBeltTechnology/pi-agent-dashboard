# json-file-persistence Specification

## Purpose

Persists workspace data to a JSON file on disk, replacing the retired SQLite store for this data.

## Requirements

### Requirement: Workspace JSON file persistence
Workspaces SHALL be persisted in `~/.pi/dashboard/workspaces.json` as a JSON array. The file SHALL be read on server startup and written atomically on every mutation (create, update, delete).

#### Scenario: Read workspaces on startup
- **WHEN** the server starts and `workspaces.json` exists
- **THEN** the server SHALL load all workspace records from the file

#### Scenario: Read workspaces when file missing
- **WHEN** the server starts and `workspaces.json` does not exist
- **THEN** the server SHALL start with an empty workspace list

#### Scenario: Read workspaces when file is malformed
- **WHEN** the server starts and `workspaces.json` contains invalid JSON
- **THEN** the server SHALL log a warning and start with an empty workspace list

#### Scenario: Atomic write on mutation
- **WHEN** a workspace is created, updated, or deleted
- **THEN** the server SHALL write the full workspace array to a temporary file and rename it to `workspaces.json` to prevent corruption
