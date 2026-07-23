## ADDED Requirements

### Requirement: A usable scoped session is obtainable on demand for any invoice

The plugin SHALL expose `POST /api/plugins/invoicebot/scoped-session
{ cwd, invoice_id } → { sessionId }`. It SHALL choose **reuse → recorded-session
resume candidate → spawn** in that order. The returned value SHALL be a real
session id for a session bound to the invoice (`IB_TOOLSET=scoped-invoice`,
`IB_INVOICE_ID=invoice_id`) that is already live or safely auto-resumable through
the existing per-session WebSocket. It SHALL never return a spawn token as
`sessionId`.

The endpoint SHALL NOT dispatch `flow:run`, SHALL NOT change the global WebSocket
protocol, and SHALL NOT be consent-gated. Invalid input SHALL return HTTP 400.
Failure to produce a session SHALL return HTTP 503 with an error envelope.

#### Scenario: Reuse an exact live bound session
- **WHEN** a live invoicebot session in `cwd` is already bound to `invoice_id`
- **THEN** its session id SHALL be returned
- **AND** no session SHALL be spawned
- **AND** an unrelated invoicebot session in the same cwd SHALL NOT be selected

#### Scenario: Use the invoice's latest recorded session
- **WHEN** no exact live scoped-chat session exists and the engine's `view:"runs"`
  returns recorded sessions for the invoice
- **THEN** candidates SHALL be evaluated newest-first by `started_at`
- **AND** a live candidate SHALL be reused
- **AND** an ended candidate SHALL be returned only when its `sessionFile` exists
  on disk, so the existing WebSocket `send_prompt` auto-resume can restore it

#### Scenario: Spawn a fresh scoped session when no candidate survives
- **WHEN** no live or safely auto-resumable recorded session exists
- **THEN** a fresh session SHALL be spawned with guarded env
  `{ IB_TOOLSET:"scoped-invoice", IB_INVOICE_ID:invoice_id }`
- **AND** its persisted automation metadata SHALL encode the invoice identity
- **AND** registration SHALL correlate by unique `automationRun.runId`
- **AND** no `flow:run` SHALL be emitted
- **AND** the registered session id SHALL be returned

#### Scenario: Bind timeout never masquerades as success
- **WHEN** spawn succeeds but no matching session registers before timeout
- **THEN** the endpoint SHALL return HTTP 503
- **AND** SHALL NOT return the spawn token as a session id

#### Scenario: Existing per-session WebSocket owns conversation
- **WHEN** the endpoint returns `sessionId`
- **THEN** clients SHALL use the existing `/ws` subscribe/replay/send protocol for
  that session
- **AND** this change SHALL introduce no new WebSocket message type
