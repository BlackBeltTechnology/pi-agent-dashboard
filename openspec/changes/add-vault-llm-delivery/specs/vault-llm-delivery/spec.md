## Purpose

Deliver vault LLM credentials to trusted, allowlisted pi sessions. A key is delivered as an in-memory provider override. OAuth uses either a short-lived lease or the hub's model proxy. In every mode, no OAuth refresh token reaches a session, local LLM credentials are never overridden, and nothing is written to the session machine's files.

## ADDED Requirements

### Requirement: Local LLM credentials take precedence
An `llm` binding SHALL NOT be applied to a provider id when any of the following holds:
- local `~/.pi/agent/auth.json` holds an entry for that provider id;
- an environment variable that pi uses as that provider's credential is set, and delivery did not set it;
- the provider id is registered from the local `providers.json`.

A binding skipped for these reasons SHALL be reported as `local-override`. Precedence is per provider id, so a clone id is evaluated on its own.

#### Scenario: Local Anthropic login is not taken over
- **WHEN** `auth.json` holds the user's own `anthropic` credential, and the allowlist grants LLM binding `anthropic`
- **THEN** the session keeps using the local credential
- **AND** no local credential material is transmitted
- **AND** the binding is reported as `local-override`

#### Scenario: Provider env var wins
- **WHEN** `ANTHROPIC_OAUTH_TOKEN` is set in the session's environment, and the allowlist grants LLM binding `anthropic`
- **THEN** the binding is reported as `local-override`

#### Scenario: Clone delivered while its base is local
- **WHEN** `auth.json` holds the user's own `anthropic` login, and the allowlist grants LLM binding `anthropic-work` (clone of `anthropic`)
- **THEN** `anthropic` keeps the local login
- **AND** `anthropic-work` is delivered

#### Scenario: A delivered env binding does not block a delivered LLM binding
- **WHEN** the allowlist grants env binding `GEMINI_API_KEY` and LLM binding `google`, both backed by the same account, and neither was set locally
- **THEN** both bindings are delivered, and neither is reported as `local-override`

### Requirement: LLM keys delivered literally without writing locally
An `llm` binding to a `key` account SHALL make the session use the vault key for that provider id.
- The key SHALL be used as a literal value. It SHALL NOT be interpreted as a command or an environment reference.
- The key SHALL NOT be written to `auth.json` or any other file on the session machine.
- A rotated key SHALL take effect on the session's next request to that provider, without a restart.

#### Scenario: API key never written locally
- **WHEN** a `key` binding for `openai` is delivered
- **THEN** requests to `openai` authenticate with the vault key
- **AND** no file on the session machine contains the key

#### Scenario: Key with special characters is used literally
- **WHEN** a `key` binding is delivered for `openai` whose value begins with `!` and contains `$HOME`
- **THEN** requests authenticate with exactly that value, and no command runs

### Requirement: OAuth lease delivery
An `llm` binding in `lease` mode SHALL give the session a short-lived access token issued by the hub.
- The session SHALL never receive the refresh token.
- The access token SHALL be held in memory only and never written to a file on the session machine.
- The session SHALL obtain a new access token before the current one expires.
- On revocation, the session SHALL stop using and renewing the token at once. A token already issued MAY remain valid upstream until its own expiry, and the Settings UI SHALL state this for lease bindings.

#### Scenario: Lease delivered without local files
- **WHEN** a lease binding for `anthropic` is delivered to a session with no local `anthropic` credential, and the agent sends a prompt
- **THEN** the request is authenticated with an access token issued by the hub
- **AND** no file on the session machine contains an access or refresh token for that account

#### Scenario: Lease renewed before expiry
- **WHEN** a session's lease for `anthropic` approaches expiry while the hub is reachable
- **THEN** the session obtains a new access token from the hub, and subsequent requests use it

#### Scenario: Clone provider uses its own account
- **WHEN** bindings `anthropic` (account "personal") and `anthropic-work` (account "work", clone of `anthropic`) are delivered, and the agent uses a model of `anthropic-work`
- **THEN** the request carries the "work" account's access token
- **AND** the request has the same provider behaviour (headers, model list) as `anthropic`

#### Scenario: Rotated OAuth account takes effect before lease expiry
- **WHEN** the user rotates the account behind a session's `anthropic` lease binding while the current lease is still valid
- **THEN** the session's next `anthropic` request uses a token issued after the rotation

### Requirement: OAuth proxy delivery
An `llm` binding in `proxy` mode SHALL route the session's requests for that provider through the hub's model proxy.
- The hub SHALL attach the account's credential upstream.
- The session SHALL authenticate with a proxy key owned by its paired device and limited to its delivered bindings.
- Revoking that key, or the device pairing, SHALL cause the next proxied request to be rejected.
- Vault-owned credentials SHALL be usable only for requests that carry such a device proxy key.

#### Scenario: Proxied request carries no provider token on the session side
- **WHEN** a proxy binding for `anthropic` is delivered and the agent sends a prompt
- **THEN** the hub makes the upstream request with the account's token
- **AND** the session never holds that token

#### Scenario: Proxy key is limited to its bindings
- **WHEN** a session's proxy key covers binding `anthropic-work` only, and the session requests a model of `openai`
- **THEN** the hub rejects the request

#### Scenario: Revoked device key stops proxying
- **WHEN** the user revokes the proxy key of a paired device, and a session on that device sends a prompt
- **THEN** the hub rejects the request with an authentication error

### Requirement: Pool failover in proxy mode
For an enabled pool binding, when the upstream answers with a rate-limit error before any response bytes have been forwarded to the session, the hub SHALL:
1. mark the account as cooling;
2. forward the same request with the next healthy account in pool order;
3. return that response.

An upstream error after response bytes have been forwarded SHALL be passed through without retry. The hub SHALL return to the primary account once its cooling period has elapsed.

#### Scenario: Failover before the first byte
- **WHEN** an enabled pool's primary account returns a rate-limit error for a proxied request before any response bytes are sent
- **THEN** the hub forwards the same request with the next account, and the session receives that response

#### Scenario: No retry after streaming started
- **WHEN** an upstream error arrives after part of a streamed response has been forwarded
- **THEN** the session receives the error, and no retry is made on another account

#### Scenario: Primary resumes after cooling
- **WHEN** the primary account's cooling period has elapsed, and the session sends another prompt
- **THEN** the request is forwarded with the primary account

### Requirement: LLM delivery material is redacted
Lease access tokens, delivered LLM keys and proxy keys SHALL be redacted from session output on the same terms as delivered env values (see `credential-delivery`).

#### Scenario: Lease token printed by a command is redacted
- **WHEN** a command in a session holding a lease prints the leased access token
- **THEN** the recorded output contains the redaction marker, and not the token

### Requirement: Lease outage and disable
- **Hub unreachable.** A session SHALL keep using an issued lease until it expires. It SHALL then notify the user that the vault is unreachable for that provider. Errors SHALL contain no token material.
- **Delivery disabled or bridge unloaded.** The session SHALL remove every provider override that delivery created, and SHALL then resolve LLM credentials exactly as it would without the vault.

#### Scenario: Lease outlives a hub outage until expiry
- **WHEN** the hub becomes unreachable while a session holds a lease valid for another 5 minutes
- **THEN** the session's requests succeed until the lease expires
- **AND** the user is notified that the vault is unreachable once renewal fails

#### Scenario: Disable removes LLM overrides
- **WHEN** a session holds LLM binding `anthropic`, and the user disables delivery
- **THEN** `anthropic` requests use the local credential sources, or fail as they would without the vault

### Requirement: LLM binding state is observable
The hub SHALL record events for lease issuance, refresh, failover and LLM `local-override` skips. Each event SHALL carry the account id, binding id, session id and outcome, and SHALL carry no token material. The per-session binding view SHALL additionally show the `expired` state for leases.

#### Scenario: Failover is recorded
- **WHEN** a pool fails over from the primary account to the next one
- **THEN** an event names both account ids and the binding, and contains no token
