## ADDED Requirements

### Requirement: Radius sign-in uses the generic panes

The Add-provider picker SHALL offer Radius under the same rules as every other OAuth provider (unconfigured and not cross-type suppressed) when the server's OAuth registry lists `radius`, and SHALL NOT offer a Radius OAuth entry otherwise. Radius sign-in SHALL be driven entirely by the generic sign-in panes ("Prompt-driven sign-in steps", "Device code login flow"); the client SHALL contain no Radius-specific sign-in pane or option filtering. Its server `flowType` hint is `auth_code` (like `openai-codex`, whose first step is also a method `select`), so the auth-code pane opens first and then renders the `select`. Its connected row SHALL carry the **Account** badge (pi reports `subscription: false`).

#### Scenario: Radius login-method choice
- **WHEN** the user picks Radius and the flow reports `pending: { kind: "select", options: [browser, device-code] }`
- **THEN** the pane SHALL show both options with pi's labels; choosing device-code SHALL render the device-code pane for the same flow

#### Scenario: Radius row badge
- **WHEN** the `radius` OAuth row reports `configured: true` and `subscription: false`
- **THEN** the row SHALL carry the "Account" badge and a Sign out action

#### Scenario: Radius hidden by a models.json override
- **WHEN** the server's registry omits `radius` (a `models.json` override is present)
- **THEN** the Add-provider picker SHALL NOT list a Radius OAuth entry

### Requirement: Post-sign-in Radius MCP offer

When a Radius sign-in flow completes, the providers section SHALL read `GET /api/provider-auth/radius/mcp`. When it reports `configured: false`, the section SHALL show an inline, dismissible offer (not a modal, and not inside the closed Add-provider dialog) asking whether to configure the Radius MCP server in the reported `mcp.json` path, naming the entry name it will write. Accepting SHALL call `POST /api/provider-auth/radius/mcp` once and show the outcome inline: success stating how many sessions were reloaded (the reported `reloaded` count), or, on refusal, the translation of `err.<code>` for the response's domain-prefixed `code` (e.g. `err.provider_auth.radius_mcp_no_credential`; `write_refused` interpolates `vars.reason`), with keys present in every shipped locale, falling back to the server's `error` text for an unknown code. Declining or dismissing SHALL write nothing. The offer SHALL NOT appear when the read reports `configured: true`, when the read fails, or after any non-Radius sign-in. The offer SHALL be keyboard-operable and its accept/decline actions SHALL carry accessible names.

#### Scenario: Offer after first Radius sign-in
- **WHEN** a Radius flow completes and `GET /api/provider-auth/radius/mcp` reports `{ configured: false, name: "radius", path }`
- **THEN** the section SHALL show the offer naming `path` and `radius`

#### Scenario: Accepting configures and reports reload
- **WHEN** the user accepts the offer and the server answers `{ configured: true, written: true, reloaded: 3 }`
- **THEN** the section SHALL post exactly once and show a success message mentioning 3 reloaded sessions, and the offer SHALL disappear

#### Scenario: Declining writes nothing
- **WHEN** the user declines the offer
- **THEN** no `POST /api/provider-auth/radius/mcp` SHALL be sent and the offer SHALL disappear

#### Scenario: Already configured shows no offer
- **WHEN** a Radius flow completes and the read reports `configured: true`
- **THEN** no offer SHALL be shown

#### Scenario: Refusal is shown inline
- **WHEN** the user accepts and the server answers 409 with `{ code: "provider_auth.radius_mcp_write_refused", vars: { reason: "unparseable" }, error }`
- **THEN** the section SHALL show the translated `err.provider_auth.radius_mcp_write_refused` message inline and SHALL NOT claim success

#### Scenario: Non-Radius sign-in shows no offer
- **WHEN** an Anthropic sign-in flow completes
- **THEN** the section SHALL NOT read the Radius MCP endpoint and SHALL show no offer
