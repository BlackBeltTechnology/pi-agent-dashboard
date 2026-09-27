## Purpose

Give a plugin's bridge entry a private request/reply channel to its server entry, so server-held secrets (e.g. short-lived access tokens) can reach a tool without being observable or forgeable by other extensions.

## ADDED Requirements

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
A reply SHALL be delivered only as the result of the call that caused it. Requests and replies SHALL NOT be emitted on the shared extension event bus, and no other extension SHALL be able to answer another caller's request. The lane SHALL NOT be treated as authenticating the caller. Handlers SHALL authorize requests from their payload as coming from any session of the dashboard's user.

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
