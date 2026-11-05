## MODIFIED Requirements

### Requirement: OAuth implementation is resolved from the pi runtime dependency

The server SHALL obtain the OAuth provider definitions from `@earendil-works/pi-coding-agent`'s public model-runtime surface, never by importing `@earendil-works/pi-ai` directly or reaching into either package's internal file layout. Test code that asserts parity between a dashboard constant or predicate and pi's internal behaviour (a drift test) MAY read pi's internal files; server runtime code SHALL NOT. `packages/server` SHALL declare `@earendil-works/pi-coding-agent` at `^<piCompatibility.minimum>` (`^1.5.0`; see pi-core-version-check), and every other place the repository pins that version (`piCompatibility.minimum`, `piCompatibility.recommended`, the workspace override, the docker image, and the release-dependency gate's own minimum) SHALL agree. On first use the server SHALL verify the runtime exposes provider definitions and that at least one carries an OAuth login; on failure it SHALL log the resolved package version, keep serving every other route, and report the failure in `GET /api/health` so the UI can explain why sign-in is unavailable.

#### Scenario: Correct copy resolved
- **WHEN** the workspace also contains an older hoisted `@earendil-works/pi-ai` without OAuth provider definitions
- **THEN** the server SHALL still build the registry from the copy `@earendil-works/pi-coding-agent` was built against, and the registry SHALL include `meta`

#### Scenario: Runtime surface missing is diagnosable
- **WHEN** the resolved pi-coding-agent copy does not expose provider definitions with OAuth logins
- **THEN** `GET /api/provider-auth/handlers` SHALL return `{ ids: [] }`, `GET /api/health` SHALL carry a non-empty `providerAuth.error` whose text includes the resolved pi-coding-agent version, every provider without a stored OAuth credential SHALL appear in `GET /api/provider-auth/status` as an api-key row under its bare id, and no other route SHALL be affected

#### Scenario: Version pins agree
- **WHEN** the release-dependency gate runs
- **THEN** all governed pins SHALL resolve `@earendil-works/pi-coding-agent` to the same version, equal to `piCompatibility.minimum` (`1.5.0`) and not below the gate's own minimum, and the gate SHALL pass

#### Scenario: Drift test may read pi internals
- **WHEN** a dashboard test asserts that the server's `RADIUS_MCP_URL` constant equals pi's internal value
- **THEN** the test MAY resolve pi's internal module by walking `node_modules`, and no server runtime module SHALL import it
