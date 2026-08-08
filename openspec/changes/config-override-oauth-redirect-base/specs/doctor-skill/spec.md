## ADDED Requirements

### Requirement: Resolved OAuth redirect base module
The doctor skill SHALL carry an `oauth-redirect-base` capability module reporting the redirect base that actually WON the precedence chain and the tier that produced it (`auth.redirectBaseUrl` | `tunnel` | `localhost`), following the uniform module contract (SCOPE · KNOWLEDGE · CHECKS · FIX ROUTING · DERIVES-FROM) with a knowledge-hash sidecar.

The module SHALL read `GET /api/auth/diagnostics` over **loopback**, where the network guard admits it with no JWT, and SHALL fall back to the resolved-base line written to `~/.pi/dashboard/server.log` at every register and reload. It SHALL NOT depend on a remote authenticated request, because an operator whose OAuth is broken cannot obtain a JWT.

The module SHALL route a `source` that disagrees with the deployment shape to the fix, and SHALL state both traps: the provider-side registration requirement, and the zero-provider boot state in which the endpoint reports `authActive: false` and only a restart applies an auth config change.

#### Scenario: Reports the winning tier
- **WHEN** the module runs against a dashboard with `auth.redirectBaseUrl` set
- **THEN** it SHALL report that value as the resolved base with source `auth.redirectBaseUrl`

#### Scenario: Works with no HTTP access
- **WHEN** the diagnostics endpoint cannot be reached
- **THEN** the module SHALL derive the resolved base from the `server.log` line instead of reporting nothing

#### Scenario: Zero-provider boot is not reported as live
- **WHEN** the server booted with an empty resolvable provider registry
- **THEN** the module SHALL report `authActive: false` rather than a value that looks live
