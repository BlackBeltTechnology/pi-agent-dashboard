## MODIFIED Requirements

### Requirement: Delivery only to granted sessions on trusted devices
The hub SHALL deliver a binding only when both of the following hold:
- the session's project has a grant for that binding and, for repository keys, the checkout is confirmed (see `credential-vault`), or the binding's reach is "All my projects" and the project has no exclusion for it (see `vault-reach`);
- the bridge connection is authenticated either:
  - for a session on another machine, as a paired device, over TLS; or
  - for a session on the hub, by the hub's local credential proof.

A session that is not trusted SHALL receive nothing, and SHALL behave exactly as it does without the vault.

#### Scenario: Remote session without device authentication
- **WHEN** a session on another machine connects without authenticating as a paired device
- **THEN** no vault value is delivered to it

#### Scenario: Remote session without TLS
- **WHEN** a paired device's session connects over an unencrypted `ws://` connection
- **THEN** no vault value is delivered to it

#### Scenario: Remote trusted session in a granted project
- **WHEN** a session on a paired device, connected over TLS, starts in a confirmed checkout of a project granted `SONIOX_API_KEY`
- **THEN** that session receives `SONIOX_API_KEY`

#### Scenario: Empty vault changes nothing
- **WHEN** the vault has no accounts
- **THEN** sessions behave exactly as they did before the vault existed

#### Scenario: Reach delivers only to trusted sessions
- **WHEN** binding `SONIOX_API_KEY` has the reach "All my projects", and a paired device's session connects over an unencrypted `ws://` connection
- **THEN** no vault value is delivered to it
