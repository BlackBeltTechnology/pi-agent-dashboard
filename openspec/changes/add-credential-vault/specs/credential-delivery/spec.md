## Purpose

Deliver vault credentials to pi sessions, local or on paired devices, without code changes in the consumers. Delivery is scoped by the project allowlist, supports live rotation and revocation, never overrides local credentials, and never sends an OAuth refresh token to a session.

## ADDED Requirements

### Requirement: Delivery only to allowlisted sessions on trusted devices
The hub SHALL deliver a binding only to a session whose project allowlist names it (see `credential-vault`). It SHALL deliver only over a bridge connection authenticated by a paired, proof-bound device credential, or by the hub's own local credential proof. A session that is not trusted SHALL receive nothing and SHALL behave exactly as it does without the vault.

#### Scenario: Remote session without device proof
- **WHEN** a session on another machine connects without a proof-bound device credential
- **THEN** no vault credential is delivered to it

#### Scenario: Remote trusted session in an allowlisted project
- **WHEN** a session on a paired device starts in a project allowlisted for `SONIOX_API_KEY`
- **THEN** that session receives `SONIOX_API_KEY`

#### Scenario: Empty vault changes nothing
- **WHEN** the vault has no accounts
- **THEN** sessions resolve every credential exactly as they did before the vault existed

### Requirement: Local credentials take precedence
Delivery SHALL NOT override a credential the session already has from local sources.
- An `env` binding SHALL NOT replace an environment variable that was set before delivery began.
- An `llm` binding SHALL NOT be applied to a provider id when either of these holds:
  - local `~/.pi/agent/auth.json` holds an entry for that provider id;
  - pi's documented environment variable for that provider is set.
- A provider id registered from the local `providers.json` SHALL take precedence over an `llm` binding with the same id.

Each binding skipped this way SHALL be reported as `local-override`.

#### Scenario: Pre-existing env var wins
- **WHEN** the session was started with `GEMINI_API_KEY` already set and the allowlist grants env binding `GEMINI_API_KEY`
- **THEN** the session keeps its original value and the binding is reported as `local-override`

#### Scenario: Local Anthropic login is not taken over
- **WHEN** `auth.json` holds the user's own `anthropic` credential and the allowlist grants LLM binding `anthropic`
- **THEN** the session keeps using the local credential
- **AND** no local credential material is transmitted
- **AND** the binding is reported as `local-override`

#### Scenario: Provider env var wins
- **WHEN** `ANTHROPIC_API_KEY` is set in the session's environment and the allowlist grants LLM binding `anthropic`
- **THEN** the binding is reported as `local-override` and the session uses the env var

### Requirement: Env bindings delivered as environment variables
An `env` binding SHALL be exposed to the session as an environment variable of the same name. It SHALL be visible to every shell command and skill process that the session starts after delivery, without restarting the session.

#### Scenario: Skill reads a delivered key without code change
- **WHEN** env binding `GEMINI_API_KEY` is delivered and the agent runs a skill script that reads `GEMINI_API_KEY` from its environment
- **THEN** the script sees the vault value

#### Scenario: Key granted mid-session reaches the next command
- **WHEN** a binding is granted to a running session and the agent then runs a shell command
- **THEN** that command's environment contains the variable

### Requirement: LLM API keys delivered without writing locally
An `llm` binding to an `api_key` account SHALL make the session use the vault key for that provider id. The key SHALL NOT be written to `~/.pi/agent/auth.json` or any other file on the session machine. Rotation SHALL take effect on the session's next request to that provider, without restart.

#### Scenario: API key never written locally
- **WHEN** an `api_key` binding for `openai` is delivered
- **THEN** requests to `openai` authenticate with the vault key
- **AND** no file on the session machine contains the key

### Requirement: OAuth lease delivery
An `llm` binding to an `oauth` account in `lease` mode SHALL give the session a short-lived access token issued by the hub.
- The session SHALL never receive the account's refresh token.
- The access token SHALL be held in memory only and SHALL NOT be written to any file on the session machine.
- The session SHALL obtain a new access token from the hub before the current one expires.
- On revocation, the session SHALL stop using the token and stop renewing it at once. A token already issued MAY remain valid upstream until its own expiry; the Settings UI SHALL state this for lease bindings.

#### Scenario: Lease delivered without local files
- **WHEN** a lease binding for `anthropic` is delivered to a session with no local `anthropic` credential, and the agent sends a prompt
- **THEN** the request is authenticated with an access token issued by the hub
- **AND** no file on the session machine contains an access or refresh token for that account

#### Scenario: Lease renewed before expiry
- **WHEN** a session's lease for `anthropic` approaches expiry while the hub is reachable
- **THEN** the session obtains a new access token from the hub, and subsequent requests use it

#### Scenario: Clone provider uses its own account
- **WHEN** bindings `anthropic` (account "personal") and `anthropic-work` (account "work", clone of `anthropic`) are delivered
- **AND** the agent uses a model of `anthropic-work`
- **THEN** the request carries the "work" account's access token
- **AND** the request has the same provider behaviour (headers, model list) as `anthropic`

### Requirement: OAuth proxy delivery
An `llm` binding in `proxy` mode SHALL route the session's requests for that provider through the hub.
- The hub SHALL attach the account's access token upstream, so no provider token reaches the session.
- The session SHALL authenticate to the hub with a key bound to its paired device.
- Revoking that key, or the device pairing, SHALL stop the session's proxied requests at the next request.

#### Scenario: Proxied request carries no provider token on the session side
- **WHEN** a proxy binding for `anthropic` is delivered and the agent sends a prompt
- **THEN** the upstream request is made by the hub with the account's token, and the session never holds that token

#### Scenario: Revoked device key stops proxying
- **WHEN** the user revokes the proxy key of a paired device and a session on that device sends a prompt
- **THEN** the hub rejects the request with an authentication error

### Requirement: Rotation and revocation are pushed to sessions
When an account is rotated or revoked, or a project allowlist changes, the hub SHALL notify every connected session that holds an affected binding.
- **Env bindings:** the session SHALL update the variable on rotation, and remove it on revocation or de-allowlisting. Only variables that delivery itself set SHALL be touched.
- **LLM bindings:** the session SHALL switch to the new credential, or stop using the binding, before its next request to that provider.

#### Scenario: Revoked env key disappears from the next command
- **WHEN** binding `POLY_PIZZA_KEY` is revoked while a session holds it
- **THEN** the session's next shell command does not see `POLY_PIZZA_KEY`

#### Scenario: Rotated OAuth account takes effect before lease expiry
- **WHEN** the user rotates the account behind a session's `anthropic` lease binding while the current lease is still valid
- **THEN** the session's next `anthropic` request uses a token issued after the rotation

#### Scenario: De-allowlisting withdraws only delivered values
- **WHEN** the allowlist stops granting `GEMINI_API_KEY` to a session in which delivery set it
- **THEN** the variable is removed from the session
- **AND** a variable with another name that the user set before delivery is unchanged

### Requirement: Pool failover in proxy mode
For a pool binding with failover enabled, the hub SHALL proceed as follows when an upstream request fails with a rate-limit error:
- mark the account as cooling;
- forward the same request with the next healthy account in pool order;
- return the response to the session.

The hub SHALL return to the primary account once its cooling period has elapsed.

#### Scenario: Proxy failover is lossless
- **WHEN** an enabled pool's primary account returns a rate-limit error for a proxied request
- **THEN** the hub forwards the same request with the next account and the session receives that response

#### Scenario: Primary resumes after cooling
- **WHEN** the primary account's cooling period has elapsed and the session sends another prompt
- **THEN** the request is forwarded with the primary account

### Requirement: Delivered values are redacted from session output
Every value that delivery has given the session SHALL be replaced by a redaction marker in tool results before they are recorded in the transcript or sent to the model. This includes secrets, lease access tokens and proxy keys. Redaction SHALL apply to the tool result's text content, its structured content, and any full-output file the tool writes.

#### Scenario: printenv does not leak a delivered key
- **WHEN** a session holding `GEMINI_API_KEY` runs `printenv GEMINI_API_KEY`
- **THEN** the tool result recorded in the transcript contains a redaction marker and not the key value

#### Scenario: Truncated output file is redacted
- **WHEN** a shell command prints a delivered value and its output is long enough that the full output is written to a file
- **THEN** that file contains the redaction marker and not the value

### Requirement: Hub unavailability degrades gracefully
If the hub becomes unreachable, a session SHALL keep values already delivered, and SHALL keep using an issued lease until it expires. When a lease cannot be renewed, the session SHALL notify the user that the vault is unreachable for that provider. The session SHALL NOT crash.

#### Scenario: Lease outlives a hub outage until expiry
- **WHEN** the hub becomes unreachable while a session holds a lease valid for another 5 minutes
- **THEN** the session's requests succeed until the lease expires
- **AND** the user is notified that the vault is unreachable once renewal fails

### Requirement: Disabling delivery restores local behaviour
When the user disables delivery, or the bridge unloads, the session SHALL remove every environment variable and provider override that delivery created. The session SHALL then resolve credentials exactly as it would without the vault.

#### Scenario: Disable delivery
- **WHEN** a session holds env binding `SONIOX_API_KEY` and LLM binding `anthropic` and the user disables delivery
- **THEN** the session's next shell command does not see `SONIOX_API_KEY`
- **AND** `anthropic` requests use the local credential sources or fail as they would without the vault

### Requirement: Delivery is observable without exposing values
The hub SHALL record the following as events: delivery, lease issuance, refresh, failover, rotation, revocation, and `local-override` skips. Each event SHALL carry account id, binding id, session id and outcome, and SHALL carry no secret material. The dashboard SHALL show, per session, which bindings the session holds and their state (`delivered`, `local-override`, `expired`, `hub-unreachable`, `revoked`), without values.

#### Scenario: Session shows its bindings
- **WHEN** a user opens a session's details
- **THEN** the dashboard lists the bindings delivered to it, with kind and state and no values
