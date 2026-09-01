# package-remove Specification

## Purpose

Lets the server remove installed pi packages through `PackageManager`.

## Requirements

### Requirement: Server removes pi packages via PackageManager
The server SHALL expose `POST /api/packages/remove` accepting `{ source, scope, cwd? }`. It SHALL use pi's `DefaultPackageManager` to remove the package and update settings. The endpoint SHALL return immediately with an `operationId` and stream progress via WebSocket.

#### Scenario: Remove global package
- **WHEN** client sends `POST /api/packages/remove` with `{ source: "npm:pi-doom", scope: "global" }`
- **THEN** server calls `packageManager.removeAndPersist("npm:pi-doom")` and returns `{ operationId }` with status 202

#### Scenario: Remove local package
- **WHEN** client sends `POST /api/packages/remove` with `{ source: "npm:pi-tools", scope: "local", cwd: "/path/to/project" }`
- **THEN** server calls `packageManager.removeAndPersist("npm:pi-tools", { local: true })` scoped to the given cwd
