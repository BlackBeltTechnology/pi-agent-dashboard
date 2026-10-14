## ADDED Requirements

### Requirement: Escalations are recorded and shown to the operator

An escalation SHALL record conversation id, customer display (the token `name` claim or a short hash of the customer id), reason (≤ 500 characters), the last 10 customer/assistant turns as text capped at 16 KB, creation time and status (`open`, `claimed`, `closed`), stored with mode `0600` under the plugin data directory. Creating one SHALL emit `status: escalated` on the conversation stream; at most 500 escalations MAY be open at once across all customers — beyond that a new escalation SHALL NOT be recorded, the model SHALL receive the acknowledgement, and the event SHALL be logged. The plugin's operator panel SHALL list escalations, newest first, and let the operator claim and close them. The operator panel and its routes SHALL refuse any principal whose issuer is a customer issuer (in addition to the host policy). When `escalationWebhookUrl` (an `https` URL, or `http` only for a loopback host) is configured, the plugin SHALL POST `{ id, conversationId, customerDisplay, reason, createdAt }` as JSON to it once, with a 5-second timeout and no retry; a webhook failure SHALL be logged and SHALL NOT affect the escalation. The `reason`, the customer display and the transcript excerpt are customer-influenced text and SHALL be rendered as plain text, never as markup, in the panel.

#### Scenario: Escalation appears in the inbox
- **WHEN** the model escalates a conversation
- **THEN** the operator panel SHALL list it as `open` and the customer stream SHALL receive `status: escalated`

#### Scenario: Webhook failure is non-fatal
- **WHEN** the webhook times out
- **THEN** the escalation SHALL still be recorded as `open`
