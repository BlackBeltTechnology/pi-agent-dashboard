# file-read-api Specification

## Purpose

Exposes a server endpoint for reading a pi resource file, so the client can display file content referenced by a session without shelling out or reaching into the filesystem itself.

## Requirements

### Requirement: Pi resource file endpoint
The server SHALL expose `GET /api/pi-resource-file?path=<absolutePath>` for reading pi resource files that may reside outside session working directories.

#### Scenario: Read resource file
- **WHEN** a request is made with an absolute path pointing to a file inside a known pi resource location
- **THEN** the response SHALL be `{ success: true, data: { type: "file", content: "<file contents>" } }`

#### Scenario: Path validation — allowed locations
- **WHEN** the requested path is within one of: `<known-cwd>/.pi/`, `~/.pi/agent/`, or a resolved package directory
- **THEN** the request SHALL be allowed

#### Scenario: Path validation — rejected locations
- **WHEN** the requested path is NOT within any allowed pi resource location
- **THEN** the response SHALL be `{ success: false, error: "path not in allowed resource location" }` with HTTP 403

#### Scenario: Localhost only
- **WHEN** a request originates from a non-loopback address
- **THEN** the request SHALL be rejected with HTTP 403

#### Scenario: File not found
- **WHEN** the requested path does not exist
- **THEN** the response SHALL be `{ success: false, error: "not found" }` with HTTP 404

#### Scenario: Missing path parameter
- **WHEN** `path` query parameter is missing
- **THEN** the response SHALL be `{ success: false, error: "path parameter required" }` with HTTP 400
