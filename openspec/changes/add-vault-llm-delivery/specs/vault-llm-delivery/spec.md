## Purpose

Deliver vault LLM credentials to granted pi sessions on trusted devices. A key is delivered as an in-memory provider override; OAuth uses either a short-lived lease or the hub's model proxy. In every mode:
- no OAuth refresh token reaches a session;
- local LLM credentials are never overridden;
- delivered material is never written to pi's configuration files on the session machine.

Delivery, reconciliation, offline grace, trust and redaction follow `credential-delivery` unless stated here.

## ADDED Requirements

### Requirement: Local LLM credentials take precedence
An `llm` binding SHALL NOT be applied to a provider id when any of the following holds on the session machine:
- `~/.pi/agent/auth.json` holds an entry for that provider id;
- an environment variable that pi-ai lists for that provider in its env discovery table (including bearer-only variables such as `ANTHROPIC_AUTH_TOKEN`) is set, and delivery did not set it;
- the provider id is registered from the local `providers.json`;
- the local `models.json` defines a provider with that id that carries an `apiKey`.

A binding skipped for these reasons SHALL be reported as `local-override`. Precedence is per provider id, so a clone id is evaluated on its own.

#### Scenario: Local Anthropic login is not taken over
- **WHEN** `auth.json` holds the user's own `anthropic` credential, and project grants include LLM binding `anthropic`
- **THEN** the session keeps using the local credential
- **AND** no local credential material is transmitted
- **AND** the binding is reported as `local-override`

#### Scenario: Provider env var wins
- **WHEN** `ANTHROPIC_OAUTH_TOKEN` is set in the session's environment before delivery, and project grants include LLM binding `anthropic`
- **THEN** the binding is reported as `local-override`

#### Scenario: models.json key wins
- **WHEN** the session machine's `models.json` defines provider `openai` with an `apiKey`, and project grants include LLM binding `openai`
- **THEN** the binding is reported as `local-override`, and requests use the `models.json` key

#### Scenario: Bearer-only env var also wins
- **WHEN** `ANTHROPIC_AUTH_TOKEN` is set in the session's environment before delivery, and project grants include LLM binding `anthropic`
- **THEN** the binding is reported as `local-override`

#### Scenario: Clone delivered while its base is local
- **WHEN** `auth.json` holds the user's own `anthropic` login, and project grants include LLM binding `anthropic-work` (clone of `anthropic`)
- **THEN** `anthropic` keeps the local login
- **AND** `anthropic-work` is delivered

#### Scenario: A delivered env binding does not block a delivered LLM binding
- **WHEN** project grants include env binding `GEMINI_API_KEY` and LLM binding `google`, both backed by the same account, and neither was set locally
- **THEN** both bindings are delivered, and neither is reported as `local-override`

### Requirement: LLM keys delivered literally without writing locally
An `llm` binding with delivery `key` SHALL make the session use the vault key for that provider id.
- The key SHALL be used as a literal value, including a leading `$` or `!`. It SHALL NOT be interpreted as a command or an environment reference.
- The key SHALL NOT be written to `auth.json`, `settings.json`, `providers.json`, `models.json` or any other pi configuration file on the session machine.
- A rotated key SHALL take effect on the session's next request to that provider, within the delivery propagation bound, without a restart.

#### Scenario: API key never written locally
- **WHEN** a `key` binding for `openai` is delivered
- **THEN** requests to `openai` authenticate with the vault key
- **AND** no file under the session machine's `~/.pi/agent/` contains the key

#### Scenario: Key with special characters is used literally
- **WHEN** a `key` binding is delivered for `openai` whose value begins with `!` and contains `$HOME`
- **THEN** requests authenticate with exactly that value, and no command runs

#### Scenario: Key with a leading dollar is used literally
- **WHEN** a `key` binding is delivered for `openai` whose value is `$OPENAI_SECRET_abc123`, and `OPENAI_SECRET_abc123` is set in the session's environment
- **THEN** requests authenticate with the literal value `$OPENAI_SECRET_abc123`

### Requirement: OAuth lease delivery
An `llm` binding with delivery `lease` SHALL give the session a short-lived access token issued by the hub over the trusted bridge connection.
- The session SHALL never receive the refresh token.
- The access token SHALL be held in memory only and never written to a pi configuration file.
- An issued token SHALL have at least 5 minutes of lifetime left. The session SHALL request a new token once 80% of the lifetime the token had when issued has elapsed. If a renewal fails, the session SHALL retry with exponential backoff starting at 5 seconds and capped at 60 seconds, until it succeeds, the token expires, or offline grace ends.
- When the account's tokens are replaced, the hub SHALL push a new lease.
- When the binding is withdrawn from the session for any reason the vault defines (grant, confirmation, binding or account revocation, unlink, project change, pairing revocation, offline grace, disable), the session SHALL stop using and renewing the token within the delivery propagation bound. A token already issued MAY remain valid upstream until its own expiry, and the Settings UI SHALL state this for lease bindings.

#### Scenario: Lease delivered without local files
- **WHEN** a lease binding for `anthropic` is delivered to a session with no local `anthropic` credential, and the agent sends a prompt
- **THEN** the request is authenticated with an access token issued by the hub
- **AND** no file under the session machine's `~/.pi/agent/` contains an access or refresh token for that account

#### Scenario: Lease renewed before expiry
- **WHEN** a session holds an `anthropic` lease issued with 60 minutes of lifetime, and the hub is reachable
- **THEN** the session obtains a new token by minute 48, and later requests use it

#### Scenario: Renewal recovers after a brief outage
- **WHEN** the first renewal attempt for a session's lease fails because the hub is unreachable, and the hub becomes reachable 12 seconds later
- **THEN** the session retries 5 seconds and 15 seconds after the failure, and the second retry obtains a new token

#### Scenario: Clone provider uses its own account
- **WHEN** bindings `anthropic` (account "personal") and `anthropic-work` (account "work", clone of `anthropic`) are delivered, and the agent uses a model of `anthropic-work`
- **THEN** the request carries the "work" account's access token
- **AND** the request has the same provider behaviour (headers, model list) as `anthropic`

#### Scenario: Re-enrolled account takes effect before lease expiry
- **WHEN** the user re-enrols the account behind a session's `anthropic` lease while the current lease is still valid
- **THEN** the session's next `anthropic` request, 5 seconds later, uses a token issued after the re-enrolment

### Requirement: OAuth proxy delivery
An `llm` binding with delivery `proxy` SHALL route the session's requests for that provider through the hub's model proxy. `proxy` delivery SHALL be available only for providers whose API the proxy serves (`anthropic-messages`, `openai-completions`), and for `oauth` accounts only for providers on the lease-supported list.
- The hub SHALL attach the account's credential upstream.
- The session SHALL authenticate with a session proxy key that the hub mints for that session and binding on every snapshot that grants it, replacing (and revoking) the previous one, and stores only as a hash.
- A session proxy key SHALL NOT be usable as a general proxy key, including on a dashboard version that does not know key owners.
- Requests with that key SHALL be confined to that binding.
- The hub SHALL revoke the key when:
  - the session ends;
  - the binding is withdrawn from the session for any reason the vault defines;
  - offline grace expires;
  - the hub starts (every reconnecting session receives a new key).
- After revocation, the next request with that key SHALL be rejected.
- Vault-owned credentials SHALL be usable only for requests that carry such a key.

#### Scenario: Proxied request carries no provider token on the session side
- **WHEN** a proxy binding for `anthropic` is delivered and the agent sends a prompt
- **THEN** the hub makes the upstream request with the account's token
- **AND** the session never holds that token

#### Scenario: Session key is confined to its binding
- **WHEN** a session's proxy key is for binding `anthropic-work`, and the session requests model `openai/gpt-4o` through the proxy
- **THEN** the hub rejects the request with `403`

#### Scenario: Revoked device stops proxying
- **WHEN** the user revokes the pairing of a device, and a session on that device then sends a prompt through its proxy binding
- **THEN** the hub rejects the request with `401`

#### Scenario: Revoked checkout confirmation stops proxying
- **WHEN** the user revokes the checkout confirmation of the directory a proxy-bound session runs in
- **THEN** a request with that session's key 5 seconds later is rejected with `401`

#### Scenario: Reconnect yields a new key
- **WHEN** a proxy-bound session's bridge reconnects to the hub
- **THEN** the session receives a new key, and a request with the previous key is rejected with `401`

#### Scenario: Owned key is refused on an older dashboard
- **WHEN** a dashboard version without owner support receives a request with a session proxy key
- **THEN** the request is rejected, and no model is listed or called

#### Scenario: Session end revokes its key
- **WHEN** a session holding a proxy key ends
- **THEN** a request with that key is rejected with `401`

### Requirement: Proxy overhead is bounded
For a proxied request with an owned session key, the hub's added latency — scope setup, binding resolution, composite credential read and confinement checks, excluding upstream time and token refresh — SHALL be at most 25 ms at the 95th percentile above the same request with an unowned key.

#### Scenario: Owned-key overhead within budget
- **WHEN** 1 000 requests with an owned key and 1 000 with an unowned key go to a stub upstream with fixed latency, and no refresh is needed
- **THEN** the 95th percentile of the owned-key requests is at most 25 ms above that of the unowned-key requests

### Requirement: Pool failover in proxy mode
For a pool binding with failover enabled, the hub SHALL send no response status or body to the session until the first upstream content arrives. When the upstream answers with a rate-limit error before that point, the hub SHALL:
1. mark the account as cooling for the `retry-after` period, or 60 seconds when none is given;
2. forward the same request with the next account in pool order that is not cooling;
3. return that response.

When every remaining account also fails before the first byte, the hub SHALL return the last upstream error. When every account is already cooling, the hub SHALL answer with a rate-limit error at once, without an upstream request. An upstream error after response bytes have been forwarded SHALL be passed through without retry. Cooling accounts SHALL be skipped until their period ends, and the primary SHALL be used first again after that.

#### Scenario: Failover before the first byte
- **WHEN** an enabled pool's primary account returns a rate-limit error before any response byte is sent
- **THEN** the hub forwards the same request with the next account, and the session receives that response

#### Scenario: No retry after streaming started
- **WHEN** an upstream error arrives after part of a streamed response has been forwarded
- **THEN** the session receives the error, and no retry is made on another account

#### Scenario: Primary resumes after cooling
- **WHEN** the primary was marked cooling with `retry-after: 30`, and the session sends a prompt 31 seconds later
- **THEN** the request is forwarded with the primary account

#### Scenario: Whole pool cooling
- **WHEN** both accounts of an enabled pool are cooling and the session sends a prompt
- **THEN** the session receives a rate-limit error, and no upstream request is made

### Requirement: LLM delivery material is redacted
Delivered LLM keys, every lease token issued to the session, and session proxy keys SHALL be redacted on the same terms as delivered env values. The marker is `[REDACTED:<binding name>]`.

#### Scenario: Lease token printed by a command is redacted
- **WHEN** a command in a session holding an `anthropic-work` lease prints the leased access token
- **THEN** the recorded output contains `[REDACTED:anthropic-work]`, and not the token

### Requirement: Outage, reload and disable
- **Hub unreachable.** A session SHALL keep a `key` binding and a `proxy` binding within offline grace, and a lease until the earlier of its expiry and offline grace. It SHALL then remove the override and notify the user that the vault is unreachable for that provider. Errors SHALL contain no token material.
- **Reload.** After an extension reload, the session SHALL use the same LLM bindings as before the reload, within the limits above, without a hub round-trip; a binding past its limit SHALL NOT be re-registered.
- **Delivery disabled, or hub downgraded.** The session SHALL remove every provider override that delivery created, and SHALL then resolve LLM credentials exactly as it would without the vault. The hub SHALL revoke every session proxy key.

#### Scenario: Lease outlives a hub outage until expiry
- **WHEN** the hub becomes unreachable while a session holds a lease valid for another 5 minutes
- **THEN** the session's requests succeed until the lease expires
- **AND** after expiry the override is removed, and the user is notified that the vault is unreachable

#### Scenario: Reload keeps the lease
- **WHEN** a session holding a valid `anthropic-work` lease reloads its extensions while the hub is unreachable
- **THEN** the next `anthropic-work` request authenticates with the same lease token

#### Scenario: Disable removes LLM overrides
- **WHEN** a session holds LLM binding `anthropic`, and the user disables delivery
- **THEN** `anthropic` requests use the local credential sources, or fail as they would without the vault

### Requirement: LLM binding state is observable
The hub SHALL record events for:
- lease issuance;
- refresh;
- failover;
- session-key minting and revocation;
- LLM `local-override` skips.

Each event SHALL carry the time, kind, account id, binding name, session id and outcome — and for failover both account ids — and SHALL carry no token, key or hash. The per-session binding view SHALL also show `expired` for leases, and the delivery mode of each `llm` binding.

#### Scenario: Failover is recorded
- **WHEN** a pool fails over from the primary account to the next one
- **THEN** an event names both account ids and the binding, and contains no token
