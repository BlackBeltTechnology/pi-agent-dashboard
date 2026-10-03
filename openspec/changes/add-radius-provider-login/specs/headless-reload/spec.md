## MODIFIED Requirements

### Requirement: Enumerated reload trigger sources
The reload trigger sources are: (1) the reload button / `/reload` in the composer, (2)
`scripts/reload-all.sh`, (3) the pi retry-policy settings save (`server.ts`
`reloadConnectedSessions`), (4) package install/remove (`setReloadSessions`), (5) pi-core update
completion (`piCoreUpdater.onAllComplete`), (6) `POST /api/resources/reload`, and (7) a writing
`POST /api/provider-auth/radius/mcp` (Radius MCP server configured in the global `mcp.json`).
Sources 1–4, 6 and 7 SHALL route through `dispatchReload` and produce the same observable outcome.
Source 5 is a runtime swap and is specified separately. A fan-out SHALL NOT restrict itself to
`piGateway.getConnectedSessionIds()`; a session with a headless PID but no bridge connection SHALL
still be targeted.

#### Scenario: Settings save fans out a reload
- **WHEN** a pi retry-policy settings save triggers the reload fan-out
- **THEN** each targeted session SHALL be reloaded via `dispatchReload`
- **AND** each SHALL produce exactly one terminal `command_feedback` for `/reload`

#### Scenario: Fan-out reaches a bridge-dead session
- **WHEN** a fan-out runs and a session has a headless PID but no bridge connection
- **THEN** that session SHALL still be targeted and reloaded through the respawn path

#### Scenario: Package install fans out a reload
- **WHEN** the post-package-operation reload runs
- **THEN** each targeted session SHALL take the same path as a reload-button click

#### Scenario: Radius MCP configure fans out a reload
- **WHEN** `POST /api/provider-auth/radius/mcp` writes the global `mcp.json`
- **THEN** each fan-out target SHALL be reloaded via `dispatchReload`, a busy session SHALL be handled by `dispatchReload`'s own busy rule, and a no-op POST (`written: false`) SHALL dispatch no reload
