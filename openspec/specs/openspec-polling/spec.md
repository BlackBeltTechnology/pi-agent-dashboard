# openspec-polling Specification

## Purpose

**DEPRECATED** — OpenSpec polling has moved from the bridge extension to the dashboard server. See `server-openspec-polling` for the replacement capability.

Previously, the bridge extension polled the openspec CLI every 30s and sent results to the server per-session. This was replaced by server-side per-directory polling via `DirectoryService` to eliminate redundancy and enable zero-session directory visibility.

## Requirements

### Requirement: Bridge-side OpenSpec polling is retired

This capability SHALL NOT be implemented. Bridge-side OpenSpec polling was
removed; consumers SHALL use `server-openspec-polling`, which polls per-directory
in the dashboard server via `DirectoryService`.

This spec is retained as a tombstone because live specs and archived changes
still reference the `openspec-polling` capability name, and a reader who greps it
needs the forwarding pointer above. It records no current behaviour.

#### Scenario: No bridge-side polling exists

- **WHEN** the bridge extension connects to the dashboard server
- **THEN** it SHALL NOT poll the openspec CLI
- **AND** OpenSpec data SHALL be produced by `server-openspec-polling` instead
