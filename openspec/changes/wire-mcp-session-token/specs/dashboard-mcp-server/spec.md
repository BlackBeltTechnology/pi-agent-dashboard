## ADDED Requirements

### Requirement: A local pi session obtains a working /mcp credential without manual configuration
A pi session running on the same machine as the dashboard SHALL be able to reach
`/mcp` through the provisioned `pi-dashboard` MCP entry using only credentials the
system delivers to it. The operator SHALL NOT be required to hand-edit an MCP
config file, copy a token, or run a pairing flow to make the local path work.

The delivered credential SHALL resolve to a caller identity the server itself
recorded. It SHALL NOT be derived from anything the MCP client asserts.

#### Scenario: Provisioned entry authenticates out of the box
- **WHEN** a pi session on the dashboard's own machine connects through the provisioned `pi-dashboard` entry
- **THEN** the request SHALL be authenticated
- **AND** the session SHALL be able to invoke an advertised tool

#### Scenario: No hand-editing is required
- **WHEN** the dashboard has provisioned its MCP entry and no operator has edited an MCP config file
- **THEN** the local pi path SHALL still authenticate

#### Scenario: An unauthenticated caller is still refused
- **WHEN** a request reaches `/mcp` without the delivered credential
- **THEN** it SHALL be refused exactly as before this change

### Requirement: The delivered credential is bound to the session it was delivered to
The credential delivered to a pi session SHALL identify that session to the
server, so a call made through it resolves to `{originating session: that
session}`. The self-target guard SHALL therefore remain enforceable for every
locally-provisioned caller.

#### Scenario: Caller resolves to the session it was delivered to
- **WHEN** session `A` invokes a tool using its delivered credential
- **THEN** the server SHALL resolve the caller's originating session as `A`

#### Scenario: Self-target guard still fires on the local path
- **WHEN** session `A` invokes a session-targeting tool with `sessionId` equal to `A` using its delivered credential
- **THEN** the call SHALL be refused

#### Scenario: A credential is not usable to impersonate another session
- **WHEN** a credential delivered to session `A` is presented on a request that claims to originate from session `B`
- **THEN** the resolved caller SHALL remain `A`

### Requirement: Delivered credentials survive neither a restart nor the session's end
Because the token registry is in-memory, a dashboard restart SHALL invalidate
every delivered credential. The delivery path SHALL re-run so a session recovers
a working credential without operator action, and SHALL NOT leave a credential on
disk that the server no longer honours.

#### Scenario: Restart re-delivers rather than stranding
- **WHEN** the dashboard restarts while a pi session is running
- **AND** the session's bridge reconnects
- **THEN** a fresh credential SHALL be delivered to that session
- **AND** the session SHALL reach `/mcp` again without operator action

#### Scenario: A stale credential is not left behind
- **WHEN** a session ends, or its credential is revoked
- **THEN** any on-disk copy of that credential SHALL be removed or replaced
- **AND** presenting it SHALL be refused

#### Scenario: Delivery failure is surfaced, never silent
- **WHEN** credential delivery fails
- **THEN** the failure SHALL be logged with the affected session id
- **AND** the dashboard SHALL continue serving `/mcp` to other callers

#### Scenario: Delivery failure is logged by the side that can see it
- **WHEN** delivery fails on the session side, where the MCP client discards the credential command's diagnostics
- **THEN** the failure SHALL be logged by a component that holds the session id
- **AND** the log line SHALL identify the affected session
- **AND** a failure that is structurally invisible to the server SHALL NOT be the only record of it

### Requirement: One session's credential failures do not lock out the others
Because every local session reaches `/mcp` from the same loopback address, the
brute-force control SHALL NOT treat all local sessions as one source. A session
presenting a stale or invalid credential SHALL NOT deny service to other local
sessions holding valid ones.

#### Scenario: A stale credential does not throttle healthy sessions
- **WHEN** one local session repeatedly presents a credential the server no longer honours
- **AND** the failure count for that session exceeds the brute-force threshold
- **THEN** another local session presenting a valid credential SHALL still be served

#### Scenario: Post-restart recovery is not self-blocking
- **WHEN** the dashboard restarts and several live local sessions retry with their now-invalid credentials
- **THEN** the re-delivery path SHALL still complete for each of them
- **AND** the retry traffic SHALL NOT lock the loopback source out of its own recovery

#### Scenario: Brute-force protection still applies
- **WHEN** an unauthenticated caller guesses credentials repeatedly
- **THEN** it SHALL still be throttled

### Requirement: A credential written to disk is protected and never clobbers operator config
Where credential delivery writes to an MCP config file, the write SHALL use the
same hardened atomic path as the existing provisioning write, SHALL restrict the
file's permissions to the owning user, and SHALL preserve every field the
dashboard does not own.

#### Scenario: File is owner-only
- **WHEN** a credential is written into an MCP config file
- **THEN** that file SHALL NOT be readable by other users on the machine

#### Scenario: Operator-added fields survive
- **WHEN** the entry already carries operator-added fields such as `disabled`
- **THEN** those fields SHALL be preserved by the credential write

#### Scenario: Write is atomic
- **WHEN** the credential write occurs
- **THEN** a partially-written config file SHALL never be observable

#### Scenario: Credential is not logged
- **WHEN** delivery succeeds or fails
- **THEN** the plaintext credential SHALL NOT appear in any log line
