## MODIFIED Requirements

### Requirement: Delivery only to granted sessions on trusted devices
The hub SHALL deliver a binding only when both of the following hold:
- the session's project has a grant for that binding and, for repository keys, the checkout is confirmed (see `credential-vault`);
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
- **WHEN** a session on a paired device, connected over TLS as defined in "The hub proves a remote session's TLS itself", starts in a confirmed checkout of a project granted `SONIOX_API_KEY`
- **THEN** that session receives `SONIOX_API_KEY`

#### Scenario: Empty vault changes nothing
- **WHEN** the vault has no accounts
- **THEN** sessions behave exactly as they did before the vault existed

#### Scenario: Hub session without a local credential
- **WHEN** a session connects to the hub's gateway from `127.0.0.1` on the legacy raw local token or the tokenless grace, in a project granted `SONIOX_API_KEY`
- **THEN** no vault value is delivered to it

## ADDED Requirements

### Requirement: The hub proves a remote session's TLS itself
A remote session SHALL count as "over TLS" only when the hub observes all of the following on the connection that currently carries the session:
- it arrived on the native TLS listener with no proxy-forwarding header;
- its ticket was minted the same way;
- its device is active with tracked, unexposed history (`bearer-device-auth`);
- its bridge declared certificate validation enforced.

A ticket-admitted connection SHALL never be hub-local. Trust SHALL be re-evaluated at register, sync and push.

#### Scenario: Remote session over the native TLS listener
- **WHEN** a paired device with a tracked, unexposed bearer mints its ticket on the native TLS listener and connects there from a confirmed checkout granted `SONIOX_API_KEY`
- **THEN** that session receives `SONIOX_API_KEY`

#### Scenario: TLS terminated by a proxy is not TLS
- **WHEN** a paired device connects through `wss://` to a proxy that forwards plain `ws` to the hub's gateway port with `X-Forwarded-Proto: https`
- **THEN** no vault value is delivered to it

#### Scenario: Forwarded request on the TLS listener is not TLS
- **WHEN** a paired device's bridge upgrade reaches the native TLS listener through a proxy that adds `X-Forwarded-For`
- **THEN** no vault value is delivered to it

#### Scenario: Loopback forwarder to the plain gateway is not hub-local
- **WHEN** a paired device reaches the gateway port through `ssh -L` from `127.0.0.1` and registers with its device ticket in a project granted `SONIOX_API_KEY`
- **THEN** no vault value is delivered to it

#### Scenario: Ticket minted over plain HTTP
- **WHEN** a paired device connects on the native TLS listener with a ticket it minted at `http://dash.example:8000/api/ws-ticket`
- **THEN** no vault value is delivered to it

#### Scenario: Exposed bearer
- **WHEN** a paired device whose bearer was once presented over plain HTTP connects on the native TLS listener with a ticket minted there
- **THEN** no vault value is delivered to it

#### Scenario: Device paired before exposure tracking
- **WHEN** a device paired before exposure tracking existed connects on the native TLS listener with a ticket minted there
- **THEN** no vault value is delivered to it

#### Scenario: Bridge without the validation declaration
- **WHEN** an eligible device connects on the native TLS listener with a bridge that does not declare certificate validation enforced
- **THEN** no vault value is delivered to it

#### Scenario: Downgrade on reconnect withdraws
- **WHEN** a trusted remote session holding `SONIOX_API_KEY` loses its TLS connection and its bridge re-registers over `ws://`
- **THEN** the hub SHALL deny the session before sending anything on the new connection
- **AND** the session SHALL no longer hold `SONIOX_API_KEY`

#### Scenario: Hub-local sessions unchanged
- **WHEN** a session on the hub connects over the local socket, with a local credential proof, or through the in-process connection, in a project granted `SONIOX_API_KEY`
- **THEN** that session receives `SONIOX_API_KEY` as before

#### Scenario: Disconnected session keeps its offline state
- **WHEN** a trusted session's bridge disconnects and no other connection carries it
- **THEN** the hub SHALL send nothing for it, and its view SHALL show `hub-unreachable` for the bindings it held

#### Scenario: Accept bridges turned off
- **WHEN** an operator turns Accept bridges off while a trusted remote session holds `SONIOX_API_KEY`
- **THEN** within 5 seconds that session's TLS bridge connection SHALL be closed, and no value SHALL be delivered to it until it is again proven

### Requirement: Deactivating a device withdraws its delivered values
When a paired device is revoked or held, or its bearer is recorded as exposed, the hub SHALL send a denial within 5 seconds to every connected session attributed to it. When its bearer expires, it SHALL do so within 60 seconds. The bridge then withdraws the delivered values as for any revocation. The hub SHALL NOT wait for a reconnect or sync.

#### Scenario: Revoke while connected
- **WHEN** an operator revokes a paired device whose connected session holds `SONIOX_API_KEY`
- **THEN** that session SHALL receive a denial within 5 seconds without reconnecting
- **AND** its next command SHALL NOT see `SONIOX_API_KEY`
- **AND** its session view SHALL show the outcome `untrusted` with the cause `device-inactive`

#### Scenario: Expiry while connected
- **WHEN** a connected trusted device's bearer expiry passes
- **THEN** its sessions SHALL receive a denial within 60 seconds

#### Scenario: Exposure while connected
- **WHEN** a connected trusted device's bearer is presented over plain HTTP
- **THEN** its sessions SHALL receive a denial within 5 seconds

#### Scenario: Other devices unaffected
- **WHEN** one of two paired devices is revoked
- **THEN** the other device's trusted sessions SHALL keep their values

### Requirement: A refused remote session names the missing proof
The session state of a remote session refused as `untrusted` or `transport-insecure` SHALL carry a cause. The cause is one of `unattributed`, `local-unproven`, `device-inactive`, `plain-transport`, `bearer-exposed`, `history-unknown`, `ticket-plain` or `bridge-outdated`. The session view SHALL show it as text with an icon and its remedy. The hub SHALL log one line, with no value and no bearer, each time a session's outcome or cause changes.

#### Scenario: Plain transport explains the fix
- **WHEN** a paired device's session is connected over `ws://dash.example:9999`
- **THEN** its session view SHALL say it has no proven TLS connection
- **AND** it SHALL name enabling Built-in HTTPS with Accept bridges and connecting with `wss://`

#### Scenario: Exposed bearer explains the fix
- **WHEN** a paired device's session is refused with cause `bearer-exposed` or `history-unknown`
- **THEN** its session view SHALL say the device token was used without TLS or predates tracking
- **AND** it SHALL say to issue a new token from the dashboard opened over HTTPS and connect only over `wss://`

#### Scenario: Cause change logged once
- **WHEN** a refused session syncs three times with the same outcome and cause
- **THEN** the hub SHALL log its trust line once
