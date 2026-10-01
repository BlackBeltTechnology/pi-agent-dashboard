## MODIFIED Requirements

### Requirement: Flow status

The server SHALL expose `GET /api/provider-auth/flow/:flowId` for every flow started by `start` and for every flow a dashboard plugin started through the plugin OAuth flow seam. Serving plugin flows SHALL NOT wait for the LLM provider registry. The response SHALL contain `flowId`, `provider`, `status` (`"pending" | "complete" | "error" | "expired"`), `authUrl` when the flow has published one (retained for the life of the flow), `message` (the most recent progress text from the flow, if any), `error` when `status` is `"error"`, and `pending` describing what the client must render or answer next:

- `{ kind: "device_code", userCode, verificationUri, intervalSeconds?, expiresInSeconds? }`
- `{ kind: "manual_code", message, placeholder? }`
- `{ kind: "text", message, placeholder? }`
- `{ kind: "select", message, options: { id, label, description? }[] }`

`pending` SHALL be absent when the flow is waiting on the provider (callback / poll) with nothing for the user to answer, and when `status` is not `"pending"`. The response SHALL NEVER include any value the user submitted. Flow ids SHALL be unguessable (UUID v4).

#### Scenario: Auth-code flow reports link and paste prompt together
- **WHEN** an Anthropic flow has published its authorization URL and asked for a pasted code
- **THEN** `GET /api/provider-auth/flow/:flowId` SHALL return `status: "pending"`, `authUrl`, and `pending: { kind: "manual_code", ... }` in the same response

#### Scenario: Codex select answered with browser
- **WHEN** a Codex flow's `select` prompt has been answered with the browser method
- **THEN** a subsequent `GET /api/provider-auth/flow/:flowId` SHALL report `authUrl` and `pending.kind: "manual_code"`

#### Scenario: Completion
- **WHEN** the runtime's flow resolves with a credential
- **THEN** the server SHALL persist it to `auth.json` under the provider id via the existing locked, backed-up write path, notify bridges, and `GET /api/provider-auth/flow/:flowId` SHALL report `status: "complete"` with no `pending`

#### Scenario: Plugin flow completion
- **WHEN** a plugin-started flow resolves with a credential
- **THEN** the server SHALL hand the credential to the plugin's persist callback instead of writing `auth.json`, SHALL NOT notify bridges, and `GET /api/provider-auth/flow/:flowId` SHALL report `status: "complete"` with no `pending`

#### Scenario: Device code expires
- **WHEN** a device code's `expiresInSeconds` elapses without authorization and the runtime's flow gives up
- **THEN** `GET /api/provider-auth/flow/:flowId` SHALL report `status: "expired"` (derived from the elapsed deadline, not from the runtime's error text) until the flow is pruned

#### Scenario: Credential write refused after a successful exchange
- **WHEN** the runtime's flow resolves with an OAuth credential for a provider whose `auth.json` entry is an api-key credential
- **THEN** the flow SHALL report `status: "error"` with the write path's conflict message, and `auth.json` SHALL be unchanged

#### Scenario: Unknown flow id
- **WHEN** a client requests `GET /api/provider-auth/flow/:flowId` with an id that was never issued or was pruned
- **THEN** the server SHALL return HTTP 404 with `{ error: "Invalid or expired flow" }`

#### Scenario: Flow failure surfaces the flow's own message
- **WHEN** the runtime's flow rejects (provider error, state mismatch, denied consent)
- **THEN** `GET /api/provider-auth/flow/:flowId` SHALL report `status: "error"` and `error` equal to the flow's error message
