## Purpose
Expose ArtCraft's hosted MCP service to pi as a local stdio MCP server — disabled until explicitly configured, gated by a one-time acknowledgement that tool calls spend ArtCraft credits, and registered only on request.

## ADDED Requirements

### Requirement: Feature flag
`pi-craft artcraft mcp` SHALL be disabled unless `ARTCRAFT_MCP_URL` is set to an `https` URL whose host is on the built-in ArtCraft host allowlist (`storyteller.ai` and its subdomains); otherwise it SHALL exit `1` explaining that ArtCraft's hosted MCP endpoint is not configured or not allowed, without any network request and without sending the session token anywhere.

#### Scenario: Flag unset
- **WHEN** `pi-craft artcraft mcp` runs without `ARTCRAFT_MCP_URL`
- **THEN** no network request is made and the exit code is `1`

#### Scenario: Non-allowlisted host rejected
- **WHEN** `ARTCRAFT_MCP_URL=https://evil.example/mcp`
- **THEN** the bridge does not start, no request is sent, and the exit code is `1`

#### Scenario: Non-https URL rejected
- **WHEN** `ARTCRAFT_MCP_URL=http://example.test/mcp`
- **THEN** the bridge does not start and the exit code is `1`

### Requirement: Authenticated bridge
When enabled and a session exists, the bridge SHALL relay MCP messages between pi (stdio) and the hosted endpoint, presenting the session token, SHALL refresh the session once on an authentication failure and retry, and SHALL fail the call with an MCP error if the retry also fails. It SHALL forward `tools/call` requests one at a time, SHALL keep stdout free of anything but MCP messages (all diagnostics on stderr, token-free), SHALL relay remote results verbatim without acting on their content, and SHALL exit `130` on SIGINT and `143` on SIGTERM. The bridge SHALL impose no timeout of its own on an upstream call (the MCP client's timeout governs). When the upstream cannot be reached or answers with a server error, the bridge SHALL keep running and answer each affected request with a token-free MCP error naming the status or cause. Without a stored session it SHALL exit `1` naming `pi-craft artcraft login`.

#### Scenario: Expired session refreshed transparently
- **WHEN** a tool call receives an authentication failure and the refresh succeeds
- **THEN** the call is retried once and its result returned to pi

#### Scenario: Refresh fails
- **WHEN** a tool call receives an authentication failure and the refresh also fails
- **THEN** the call returns an MCP error, no second retry is sent, and stdout contains only MCP messages

#### Scenario: Upstream unreachable
- **WHEN** the upstream connection is refused while a `tools/call` is forwarded
- **THEN** that call returns an MCP error naming the cause, the bridge keeps running, and the next request is forwarded

#### Scenario: Calls are serialized
- **WHEN** pi sends two `tools/call` requests without waiting
- **THEN** the second is sent upstream only after the first has a response

### Requirement: Credit-spend acknowledgement
Before the first tool call on a machine, the bridge SHALL require the user to have run `pi-craft artcraft mcp --accept-credit-use`, which SHALL record the acknowledgement in a user-only (`0600`) file under `<pi agent dir>/artcraft/` and exit `0` without starting the bridge (no session or `ARTCRAFT_MCP_URL` needed); the record is cleared by `login` and `logout`; combining `--accept-credit-use` with `--register` SHALL be a usage error; until then every `tools/call` SHALL return an MCP error explaining that ArtCraft tool calls spend account credits and how to accept, without sending the call upstream. `initialize` and `tools/list` SHALL pass through regardless.

#### Scenario: Not yet accepted
- **WHEN** pi calls an ArtCraft tool before acceptance
- **THEN** the call returns an error naming `--accept-credit-use` and nothing is sent upstream for that call

#### Scenario: Accepted
- **WHEN** `pi-craft artcraft mcp --accept-credit-use` has run and pi calls an ArtCraft tool
- **THEN** the call is forwarded upstream

### Requirement: Lazy registration
`pi-craft artcraft mcp --register` SHALL add or update one entry `craft-artcraft` under `mcpServers` in the project's `.pi/mcp.json` with absolute Node and launcher paths, arguments `["artcraft", "mcp"]` and `env` carrying the validated `ARTCRAFT_MCP_URL`, with the same preservation, symlink-refusal, malformed-file and stderr-notice rules as the craft app servers; it SHALL refuse with exit `1`, writing nothing, while `ARTCRAFT_MCP_URL` is unset or not allowed. The craft confinement policy does not apply (the bridge exposes no local file access): `--allow-unconfined` and `--compact` SHALL be usage errors for `pi-craft artcraft mcp`. No other command SHALL register it.

#### Scenario: Register preserves other servers
- **WHEN** `.pi/mcp.json` already defines `craft-filmcraft` and `ARTCRAFT_MCP_URL` is an https URL
- **THEN** after registration `craft-filmcraft` is unchanged and `craft-artcraft` is added with `env.ARTCRAFT_MCP_URL` set to that URL

#### Scenario: Register refused while disabled
- **WHEN** `pi-craft artcraft mcp --register` runs without `ARTCRAFT_MCP_URL`
- **THEN** `.pi/mcp.json` is not created or modified and the exit code is `1`
