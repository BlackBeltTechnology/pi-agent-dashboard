# plugin-bridge-request-lane Specification

## Purpose
Give a plugin's bridge entry a private request/reply channel to its server entry, so server-held secrets (e.g. short-lived access tokens) can reach a tool without being observable or forgeable by other extensions.

## Requirements

### Requirement: Request/reply between plugin bridge and plugin server
A plugin bridge entry SHALL be able to send a request naming a plugin id, a message type and a payload, and SHALL receive exactly one reply as the result of that call. On the server:
- A plugin SHALL register an async handler per message type, bound to its own manifest id.
- Only one handler SHALL exist per plugin id and message type; a duplicate registration SHALL fail.
- The handler's return value SHALL become a success reply.
- A thrown error SHALL become a failure reply carrying only the error message.
- The handler SHALL receive the session id of the sending connection, determined by the host rather than taken from the payload.

#### Scenario: Handler result reaches the requester
- **WHEN** a bridge sends a request and the server handler returns `{ token: "t" }`
- **THEN** the call resolves with a success reply carrying `{ token: "t" }`

#### Scenario: Handler error becomes a failure reply
- **WHEN** the server handler throws `Error("tier_denied")`
- **THEN** the call resolves with a failure reply `tier_denied` and no stack trace

#### Scenario: Unknown message type
- **WHEN** no handler is registered for the request's plugin id and type
- **THEN** the call resolves with a failure reply `no_handler`

#### Scenario: Routing by plugin and type
- **WHEN** plugins `a` and `b` each register type `lease`, and a request names plugin `b`
- **THEN** only `b`'s handler runs

#### Scenario: Session attribution is not spoofable
- **WHEN** a request payload claims a different session id
- **THEN** the handler receives the session id of the connection the request arrived on

#### Scenario: Works for plugins of any priority
- **WHEN** a plugin with a priority above 100 registers a handler and its bridge sends a request
- **THEN** the reply is delivered

### Requirement: Reply privacy
A reply SHALL be delivered only as the result of the call that caused it. Requests and replies SHALL NOT be emitted on the shared extension event bus, and no other extension SHALL be able to answer another caller's request. The lane SHALL NOT authenticate the caller beyond what the host observed about the sending connection (its origin and channel). A handler that has not declared itself hub-local-only SHALL authorize requests from their payload as coming from any session of the dashboard's user.

#### Scenario: Other extensions cannot observe a reply
- **WHEN** another extension listens on every shared event while a request is answered
- **THEN** it observes no event containing the request or the reply

### Requirement: Bounded waiting and payloads
Each call SHALL fail with the named error in these cases:
- `timeout` if no reply arrives within 15 seconds;
- `disconnected` if the dashboard connection drops before the reply;
- `unavailable` if the dashboard bridge is not present;
- `request_too_large` for a request payload over 256 KiB;
- `reply_too_large` for a reply over 256 KiB;
- `reply_not_serializable` when the handler returns a value that cannot be serialized.

A late reply SHALL be discarded.

#### Scenario: Timeout
- **WHEN** the server handler never resolves
- **THEN** the call resolves with `timeout` after 15 seconds and a later reply is ignored

#### Scenario: Disconnect
- **WHEN** the bridge's dashboard connection closes while a request is pending
- **THEN** the call resolves with `disconnected`

#### Scenario: Old or absent bridge
- **WHEN** a plugin bridge sends a request in a session without the dashboard bridge
- **THEN** the call resolves immediately with `unavailable`

#### Scenario: Non-serializable reply
- **WHEN** the handler returns an object with a circular reference
- **THEN** the call resolves with `reply_not_serializable`

### Requirement: Handlers receive the sending session's origin and channel
The host SHALL give every handler, besides the session id, the origin (hub-local, or a remote device id) and the admission channel of the socket that sent the request, both observed by the host when that socket connected and never read from the payload or from another session's record. The host records both for every accepted socket, and the lane receives them only from the host's own connection context. A request dispatched without that context SHALL carry neither.

#### Scenario: Origin is not spoofable
- **WHEN** a request payload claims to come from a hub-local session
- **THEN** the handler receives the origin the host observed for the sending socket, not the claimed one

#### Scenario: A request without the host's connection context reaches no hub-local-only handler
- **WHEN** a request is dispatched to the lane without the host's connection context
- **THEN** it carries no origin and no channel
- **AND** a hub-local-only handler SHALL NOT run for it

### Requirement: A credential-bearing handler refuses a session that is not hub-local
A plugin SHALL be able to register a handler as hub-local-only. The host SHALL run such a handler only for a session whose origin is hub-local and whose socket was admitted locally (unix socket, local credential proof or in-process); otherwise it SHALL reply with a failure `origin_denied: <detail>` without running the handler. An absent origin or channel SHALL be refused. A handler that returns a credential, a token or a secret-derived value SHALL be registered hub-local-only.

#### Scenario: Remote-origin session is refused
- **WHEN** a session recorded with a remote device origin sends a request to a hub-local-only handler
- **THEN** the handler SHALL NOT run
- **AND** the reply SHALL be a failure starting `origin_denied:`

#### Scenario: Locally admitted hub-local session is served
- **WHEN** a hub-local session whose socket was admitted on the unix socket or by a local credential proof sends such a request
- **THEN** the handler SHALL run

#### Scenario: Deprecated admission is not local
- **WHEN** a hub-local session whose socket was admitted as `grace` (tokenless), `legacy-token` or `local-ticket` sends such a request
- **THEN** it SHALL be refused as `origin_denied`

#### Scenario: A device ticket is not local even when the origin reads hub-local
- **WHEN** a session whose socket was admitted as `device-ticket` reads hub-local by peer address and sends such a request
- **THEN** it SHALL be refused as `origin_denied`, as the credential vault's trust decision treats that socket as its ticket's device

#### Scenario: Unknown origin or channel fails closed
- **WHEN** a request is dispatched with no origin or no channel
- **THEN** a hub-local-only handler SHALL NOT run

#### Scenario: Refusal is logged
- **WHEN** the host refuses a request as `origin_denied`
- **THEN** the server log SHALL name the plugin id, message type, session id, origin kind and admission, and never the payload
- **AND** the line SHALL be rate-limited per plugin id and message type, with a 5_000 ms window

#### Scenario: A handler not declared hub-local-only is unchanged
- **WHEN** a handler registered without the declaration receives a request from a remote-origin session
- **THEN** it SHALL run as before and receive the origin and channel

### Requirement: A request is attributed only to the socket that owns its session
The gateway SHALL deliver a `plugin_request` to the lane only when the sending socket holds the routing entry for the session it is attributed to, as it already requires for `plugin_pi_message`. A frame from any other socket, including one that named a live-held session id in a first frame, SHALL be dropped before the lane runs and without a reply to the session's routing entry. The origin and channel passed to the lane SHALL be the sending socket's own.

#### Scenario: A non-owning socket's plugin_request is dropped
- **WHEN** socket A owns the routing entry for session `S` and socket B's first frame names `S`
- **AND** socket B then sends a `plugin_request`
- **THEN** no handler SHALL run and no reply SHALL be sent for it
- **AND** a hub-local-only handler SHALL NOT be reached through `S`'s hub-local origin

#### Scenario: A socket with no session sending a plugin_request
- **WHEN** a socket that never registered or claimed a session sends a `plugin_request`
- **THEN** the frame SHALL be dropped

#### Scenario: The owning socket's request carries its own origin and channel
- **WHEN** the owning socket of session `S` sends a `plugin_request`
- **THEN** the handler SHALL receive that socket's origin and admission channel
