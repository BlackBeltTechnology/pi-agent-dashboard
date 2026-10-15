## ADDED Requirements

### Requirement: The public API uses fixed routes

The plugin SHALL register exactly these public routes (fixed paths, as the host namespace requires), each with `allowHeaders: ["Content-Type", "Authorization", "X-Web-Chat-Token"]`: `POST conversations` (create), `POST messages` (`{ conversationId, text }`), `POST close` (`{ conversationId }`), `GET stream?cid=<conversationId>` (event stream), and `GET widget.js` (unauthenticated asset). No conversation id SHALL appear in a path.

#### Scenario: Token-mode preflight succeeds
- **WHEN** a listed origin preflights `POST messages` requesting `Content-Type, X-Web-Chat-Token`
- **THEN** the preflight SHALL grant both headers

### Requirement: A conversation is one isolated, hidden, ownerless session

`POST conversations` (optional body `{ clientRequestId }`; a repeat with the same id from the same customer within 2 minutes SHALL return the same conversation) SHALL create a conversation for the authenticated customer by spawning a pi session with `pluginRef: { webChat: { conversationId } }` (the conversation is bound to its session id only through the host's `onSessionResolved` notification for that ref, before any message is delivered), `recover: false`, `scope.agentDir` = `<ctx.dataDir>/customers/<customerHash>/conv-<n>/agent`, a fresh empty working directory and `sessionDir` under the same conversation directory, the web-chat extension and persona prompt from copies the plugin provisions under `ctx.dataDir` (so packaged installs under the operator's `~/.pi` tree still pass core isolation validation), the concrete customer-tool names, `noMcp: true` and no owner (ownerless sessions are invisible to human principals; that, not `lifecycle.hidden`, is the visibility control). Before spawning, the plugin SHALL write the agent dir's `settings.json` with no packages and its `auth.json` (mode `0600`) holding the customer-traffic model credential. Unless the spawn result is `success: true` and `isolated: true`, the plugin SHALL answer `503` and shut down any session later resolved for that ref; the delivery queue SHALL drain only for conversations whose recorded spawn result was `isolated: true`. Shutdown SHALL use the host shutdown hook and fall back to abort; if both report failure the conversation SHALL be marked failed and its mode's gate closed. The response SHALL return `{ conversationId }` (256 random bits, not derived from the session id) without waiting for the session to become ready.

#### Scenario: Conversation created
- **WHEN** an authenticated customer posts to `conversations`
- **THEN** a hidden isolated session SHALL be spawned with an agent dir under `ctx.dataDir` and the response SHALL carry a `conversationId`

#### Scenario: Session bound through the plugin ref
- **WHEN** the host resolves the spawned session for ref `{ webChat: { conversationId: c1 } }`
- **THEN** conversation `c1` SHALL be bound to that session id, and messages, stream frames and shutdown SHALL target only that session

#### Scenario: Non-isolated result is rejected
- **WHEN** the spawn returns `success: true` without `isolated: true`
- **THEN** the plugin SHALL shut that session down and answer `503`

### Requirement: Messages are accepted asynchronously

`POST messages` SHALL validate and enqueue the text (text whose first non-space character is `/` SHALL be answered `400`, so customer input never reaches pi's command dispatch), answer `202` immediately, and deliver it to the session once the session's guard has reported ready; replies arrive only on the stream. If the guard has not reported ready within 25 seconds of the conversation's creation, the conversation SHALL end with stream `error: not_ready` and `status: ended`.

#### Scenario: Message before ready is queued
- **WHEN** a customer posts a message before the guard reported ready
- **THEN** the answer SHALL be `202` and the message SHALL reach the session after the ready signal

#### Scenario: Ready timeout
- **WHEN** the guard never reports ready
- **THEN** after 25 seconds the stream SHALL carry `error: not_ready` and `status: ended`

### Requirement: Conversations are owner-exact and non-enumerable

Every request naming a conversation SHALL resolve it only when its customer id equals the authenticated customer id exactly and the conversation is live; any other case — unknown id, another customer's id, an ended or pre-restart conversation — SHALL be answered `404` with an identical body.

#### Scenario: Foreign conversation is not found
- **WHEN** customer A opens a stream with customer B's conversation id
- **THEN** the answer SHALL be `404`, identical to an unknown id

### Requirement: Caps, limits and lifetime

The plugin SHALL enforce: at most `maxLiveConversations` live conversations (default 100) → `503`; at most 300 conversations created per hour across all customers → `503`; per customer at most 3 open conversations → `429` and at most 6 created per hour → `429`; at most one active stream per conversation (a new stream replaces and closes the previous one) and at most 4 open streams per customer → `429`; per customer at most 10 messages per minute and 60 per hour → `429` with `Retry-After`; message text 1–4000 characters after trimming → else `400`. A conversation SHALL end — session shut down via the host shutdown hook, stream sent `status: ended` and closed — on `POST close`, after 30 minutes without a customer message, after 4 hours total, when its session ends, when the plugin is disabled, and when the serving gate closes; the plugin SHALL re-check each mode's gate at least every 5 seconds independently of traffic for this purpose. On server start every persisted conversation SHALL be marked ended and its end-cleanup (agent dir and workspace deletion) SHALL run.

#### Scenario: Length boundaries
- **WHEN** a customer sends texts of 0, 1, 4000 and 4001 characters
- **THEN** the 1- and 4000-character texts SHALL be accepted and the others answered `400`

#### Scenario: Per-customer rate
- **WHEN** a customer sends an 11th message within one minute
- **THEN** it SHALL be answered `429` with `Retry-After` and SHALL NOT reach the session

#### Scenario: Creation churn bounded
- **WHEN** a customer creates a 7th conversation within one hour (closing each before the next)
- **THEN** it SHALL be answered `429`

#### Scenario: Gate closing ends live conversations
- **WHEN** the host access policy is unregistered while conversations are live in identity mode
- **THEN** within 5 seconds those conversations SHALL end and their streams SHALL carry `status: ended`

### Requirement: Retention is bounded

When a conversation ends, the plugin SHALL delete its agent dir and working directory immediately and its session files (including the persisted plugin ref) after 30 days, and earlier — oldest first — whenever the plugin's stored session files exceed 2 GB; registry entries of ended conversations SHALL be pruned after 30 days; closed escalations SHALL be pruned after 90 days and open escalations SHALL be closed as expired after 14 days.

#### Scenario: One stream per conversation
- **WHEN** a customer opens a second stream for the same conversation
- **THEN** the first stream SHALL be closed and only the second SHALL receive frames

#### Scenario: Slash-prefixed text refused
- **WHEN** a customer sends ` /reload`
- **THEN** the answer SHALL be `400` and nothing SHALL reach the session

#### Scenario: Agent dir removed at end
- **WHEN** a conversation ends
- **THEN** its agent dir (including `auth.json`) SHALL no longer exist
