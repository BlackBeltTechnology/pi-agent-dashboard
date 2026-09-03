# optional-static-serving Specification

## Purpose

Lets the server run with or without a built web client: it discovers client static files when present and serves them, and falls back to API-only mode when it finds none.

## Requirements

### Requirement: Server discovers client static files
The server SHALL search for pre-built client files in the following order:
1. `node_modules/@blackbelt-technology/pi-dashboard-web/dist/` (installed as dependency)
2. Sibling workspace `../client/dist/` (monorepo dev)
3. Legacy `dist/client/` (backwards compatibility)

#### Scenario: Client installed as dependency
- **WHEN** `@blackbelt-technology/pi-dashboard-web` is in `node_modules` with a `dist/` directory
- **THEN** the server SHALL serve static files from that path

#### Scenario: Monorepo workspace layout
- **WHEN** running in a monorepo and `packages/client/dist/` exists
- **THEN** the server SHALL serve static files from the sibling client package

#### Scenario: Legacy dist path
- **WHEN** neither package install nor workspace path exists but `dist/client/` exists
- **THEN** the server SHALL serve static files from `dist/client/`

### Requirement: API-only mode when no client found
The server SHALL operate without static file serving when no client build is found.

#### Scenario: No client build present
- **WHEN** none of the client file search paths contain an `index.html`
- **THEN** the server SHALL start successfully, serving only API routes and WebSocket endpoints
- **AND** the server SHALL log that it is running in API-only mode

#### Scenario: API routes work without client
- **WHEN** the server is in API-only mode
- **AND** a request is made to `/api/health`
- **THEN** the server SHALL respond normally
