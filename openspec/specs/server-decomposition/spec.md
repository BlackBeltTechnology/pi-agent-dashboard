# server-decomposition Specification

## Purpose

Splits the dashboard server's entry point into focused modules — route registration, event wiring, session bootstrap, and the idle timer — each with a defined boundary.

## Requirements

### Requirement: Route module extraction
server.ts SHALL register API routes via separate route module functions grouped by domain: session-routes, git-routes, file-routes, openspec-routes, and system-routes.

#### Scenario: Route modules register all existing endpoints
- **WHEN** the server starts
- **THEN** all existing API endpoints are registered by calling each route module's register function with the Fastify instance and shared dependencies

#### Scenario: Route behavior is identical
- **WHEN** any API endpoint receives a request
- **THEN** the response is identical to the pre-extraction behavior

### Requirement: Event wiring extraction
server.ts SHALL delegate the `piGateway.onEvent` handler to a dedicated `event-wiring` module that receives all required dependencies (sessionManager, eventStore, browserGateway, etc.).

#### Scenario: Event wiring handles all pi gateway message types
- **WHEN** a message arrives from a pi bridge extension (event_forward, session_register, commands_list, etc.)
- **THEN** the event-wiring module processes it identically to the current inline handler

### Requirement: Session bootstrap extraction
server.ts SHALL delegate startup session scanning, restoration, and directory service initialization to a `session-bootstrap` module.

#### Scenario: Bootstrap restores sessions on startup
- **WHEN** the server starts
- **THEN** session-bootstrap scans ~/.pi/agent/sessions/, restores sessions to the session manager, and starts directory service polling

### Requirement: Idle timer extraction
server.ts SHALL delegate auto-shutdown idle timer logic to an `idle-timer` module.

#### Scenario: Idle timer shuts down after configured timeout
- **WHEN** no pi sessions are connected for the configured idle period
- **THEN** the idle timer triggers server shutdown

#### Scenario: Idle timer cancels on reconnection
- **WHEN** a pi session connects while idle timer is running
- **THEN** the idle timer is cancelled
