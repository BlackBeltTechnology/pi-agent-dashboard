# invoicebot-session-profile Specification

## Purpose
TBD - created by archiving change scope-session-toolset-by-profile. Update Purpose after archive.
## Requirements
### Requirement: Per-invoice spawned sessions are scoped by profile env

The invoice plugin SHALL, when it spawns a session to run a flow for a bound
invoice, set the spawn-time environment `IB_TOOLSET=scoped-invoice` and
`IB_INVOICE_ID=<invoice id>` on that spawn, so the session boots scoped to that
one invoice. The `IB_INVOICE_ID` value SHALL be the id of the bound invoice.

#### Scenario: Per-invoice spawn carries the scope env

- **WHEN** the plugin spawns a session for a flow with a bound invoice id
- **THEN** the spawn SHALL carry `IB_TOOLSET=scoped-invoice`
- **AND** the spawn SHALL carry `IB_INVOICE_ID` set to that invoice id

#### Scenario: Scoped session boots limited to its invoice

- **WHEN** a per-invoice session starts with `IB_TOOLSET=scoped-invoice` and a
  bound `IB_INVOICE_ID`
- **THEN** the session's active tool surface SHALL be the scoped-invoice profile
  clamped to that invoice, not the full surface

### Requirement: The global session is spawned without a scope

The invoice plugin SHALL NOT set `IB_TOOLSET` or `IB_INVOICE_ID` on a spawn that
is not bound to a single invoice (the persistent global "Ask"/Kérdezz session),
so that session retains the full tool surface.

#### Scenario: Global session keeps the full surface

- **WHEN** the plugin spawns a session with no bound invoice id
- **THEN** the spawn SHALL NOT carry `IB_TOOLSET` or `IB_INVOICE_ID`
- **AND** the session SHALL retain the full (default-profile) tool surface

### Requirement: A usable scoped session is obtainable on demand for any invoice

The plugin SHALL expose `POST /api/plugins/invoicebot/scoped-session
{ cwd, invoice_id } → { sessionId }`. It SHALL resolve the invoice's **single
canonical session** (see "Each invoice has one canonical session"): reuse it when
live, resume it when ended-but-restorable, and spawn exactly one only when the
invoice has no canonical session. The returned value SHALL be a real session id
that is already live or safely auto-resumable through the existing per-session
WebSocket. It SHALL never return a spawn token as `sessionId`.

The endpoint SHALL NOT dispatch `flow:run`, SHALL NOT change the global WebSocket
protocol, and SHALL NOT be consent-gated. Invalid input SHALL return HTTP 400.
Failure to produce a session SHALL return HTTP 503 with an error envelope.

#### Scenario: Reuse the canonical session when live

- **WHEN** the invoice's canonical session is live
- **THEN** its session id SHALL be returned
- **AND** no session SHALL be spawned
- **AND** an unrelated invoicebot session in the same cwd SHALL NOT be selected

#### Scenario: Resume the canonical session when it is ended

- **WHEN** the invoice's canonical session is `ended` and its `sessionFile`
  exists on disk
- **THEN** that same session id SHALL be returned so the existing WebSocket
  `send_prompt` auto-resume can restore it
- **AND** no new session SHALL be spawned

#### Scenario: New invoice spawns exactly one canonical session

- **WHEN** the invoice has no canonical session (never resolved before)
- **THEN** exactly one session SHALL be spawned and recorded as the invoice's
  canonical session
- **AND** its registered session id SHALL be returned

#### Scenario: Bind timeout never masquerades as success

- **WHEN** spawn succeeds but no matching session registers before timeout
- **THEN** the endpoint SHALL return HTTP 503
- **AND** SHALL NOT return the spawn token as a session id

#### Scenario: Existing per-session WebSocket owns conversation

- **WHEN** the endpoint returns `sessionId`
- **THEN** clients SHALL use the existing `/ws` subscribe/replay/send protocol for
  that session
- **AND** this change SHALL introduce no new WebSocket message type

### Requirement: Each invoice has one canonical session (durable identity)

The plugin SHALL maintain a durable mapping from an invoice to its single
canonical session id that survives a dashboard restart, and SHALL treat that
mapping as the sole source of the invoice's session identity. The mapping SHALL
be persisted in a dedicated store keyed by the invoice (scoped to its workspace),
owned by the plugin — NOT reconstructed from a session's own persisted metadata.
Identity resolution SHALL NOT reject a candidate solely because it is `ended`.
When the in-memory link is absent (e.g. after restart), the plugin SHALL recover
the canonical id from the dedicated store regardless of the session's status.

#### Scenario: Canonical link survives restart

- **WHEN** an invoice's canonical session was recorded, then the dashboard
  restarted (in-memory state lost)
- **THEN** resolving the invoice SHALL recover the same canonical session id from
  the dedicated store
- **AND** SHALL NOT spawn a new session for it

#### Scenario: Canonical link follows a resume successor

- **WHEN** the canonical session is resumed and the resume registers a new
  successor session id
- **THEN** the dedicated store SHALL be re-pointed to the successor id
- **AND** a subsequent resolution SHALL return the successor, not spawn a second
  session

#### Scenario: An ended canonical session is not skipped

- **WHEN** the only session recorded for the invoice is `ended`
- **THEN** resolution SHALL adopt it as canonical (not skip it in favour of a
  fresh spawn), provided its `sessionFile` exists

#### Scenario: Missing session file is the only re-spawn trigger

- **WHEN** the canonical session is `ended` and its `sessionFile` no longer
  exists on disk
- **THEN** resolution MAY spawn one replacement session and re-link it as the new
  canonical
- **AND** the invoice SHALL still have exactly one canonical session afterward

### Requirement: An invoice's canonical session is scoped to that invoice, never a global session

The canonical session recorded, resumed, or reused for an invoice SHALL be a
per-invoice **scoped** session: one spawned under the `scoped-invoice` profile
bound to that invoice (`IB_TOOLSET=scoped-invoice`, `IB_INVOICE_ID=<invoice_id>`)
— surfaced as `automationRun.name === "invoicebot-scoped:<invoice_id>"` — or a
per-invoice `invoicebot:process` run bound to that same invoice. A **global**
session SHALL NOT be adopted, reused, resumed, or recorded as an invoice's
canonical session, even when it is the session that processed the invoice and was
recorded in the engine's run history. A global session is any session without
the invoice's scoped profile — specifically the shared `invoicebot-intake` /
`invoicebot-pull` folder-automation sessions and the Ask/operator session (the
full-surface `ask` profile). When the invoice has no scoped canonical session,
resolution SHALL spawn a fresh scoped session rather than adopt a global one.

The looser "an invoicebot session live in this cwd" gate SHALL remain in force
ONLY for the `flow:run` **dispatch** reuse path — delivering a run into a live
batch/intake session is legitimate — and SHALL NOT govern the card's
canonical-session identity.

#### Scenario: A global intake session is never adopted as canonical

- **WHEN** the only session recorded for the invoice in the engine run history is
  a shared `invoicebot-intake` (or `invoicebot-pull`) session that processed it
- **THEN** resolution SHALL NOT adopt it as the invoice's canonical session
- **AND** SHALL spawn a fresh scoped session bound to the invoice
- **AND** the spawned session's opener SHALL be the invoice-scoped greeting, not
  the global Ask greeting

#### Scenario: A scoped session is adopted and reused

- **WHEN** a session named `invoicebot-scoped:<invoice_id>` for the invoice
  exists (live or ended-restorable)
- **THEN** resolution SHALL adopt/reuse it as the canonical session

#### Scenario: The dispatch path may still target an intake session

- **WHEN** a `flow:run` is dispatched for an invoice and a live `invoicebot-intake`
  session in the same cwd is the reuse target
- **THEN** the dispatch path MAY deliver the run into it (unchanged behavior)
- **AND** this SHALL NOT record that global session as the invoice's canonical
  card session

### Requirement: Concurrent resolution for one invoice spawns at most one session

The plugin SHALL de-duplicate concurrent resolutions for the same invoice into a
single in-flight bootstrap, so a burst of resolutions yields at most one spawn.

#### Scenario: Two simultaneous opens yield one session

- **WHEN** two resolutions for the same invoice arrive before either completes,
  and the invoice has no canonical session
- **THEN** exactly one session SHALL be spawned
- **AND** both resolutions SHALL return that same session id

### Requirement: A spawned invoice session that exits is finalized, never left active

The plugin SHALL finalize an invoicebot spawned session to `ended` when its
bridge connection closes (its process exits) outside a transient reconnect
window, and SHALL NOT leave a bridgeless session reporting `status: "active"`.

#### Scenario: Exited session becomes ended

- **WHEN** an invoicebot spawned session's bridge closes and does not reconnect
  within the existing grace window
- **THEN** the session's `status` SHALL become `ended`
- **AND** it SHALL NOT continue to report `active`

### Requirement: A prompt to a canonical session with no live bridge auto-resumes it

`send_prompt` addressed to an invoice's canonical session SHALL be delivered live
only when the session has a live bridge connection. When there is no live bridge
(the session is `ended` or bridgeless), the plugin SHALL auto-resume the session
and deliver the queued prompt through the existing pending-resume path. A prompt
SHALL NOT be silently dropped because the session lacks a bridge.

#### Scenario: Send after the session was stopped resumes and delivers

- **WHEN** the operator sends a prompt to a canonical session that has no live
  bridge
- **THEN** the session SHALL be auto-resumed
- **AND** the queued prompt SHALL be delivered on the resumed session
- **AND** the send SHALL NOT be dropped or left indefinitely pending

### Requirement: Re-running an invoice reuses or resumes its canonical session

The plugin SHALL deliver a dispatched flow to the invoice's existing canonical
session — reusing it when live, or resuming it when it has no live bridge —
instead of spawning a fresh one-shot session; when the invoice has no canonical
session, the plugin SHALL spawn one (a new invoice always spawns).

#### Scenario: Re-run on a stopped invoice resumes the canonical session

- **WHEN** a flow is dispatched for an invoice whose canonical session is ended /
  bridgeless
- **THEN** that canonical session SHALL be resumed and receive the run
- **AND** a fresh one-shot session SHALL NOT be spawned in its place

#### Scenario: New invoice dispatch spawns

- **WHEN** a flow is dispatched for an invoice that has no canonical session
- **THEN** exactly one session SHALL be spawned to run it
- **AND** it SHALL be recorded as the invoice's canonical session

### Requirement: The recorded-session read boundary returns each session once

The plugin SHALL return each session id at most once, ordered by session recency
(newest first), when it reconstructs candidate session ids from the engine's
recorded run history. Duplicate run rows for one session SHALL NOT produce
duplicate candidate ids.

#### Scenario: Duplicate run rows collapse to one candidate

- **WHEN** the recorded run history contains multiple runs for the same session
- **THEN** that session id SHALL appear once in the candidate list
- **AND** the ordering SHALL reflect the session's most recent run

### Requirement: Every invoice-owned spawn pins the configured model

The invoice plugin SHALL pass an explicitly resolved model on EVERY session it
spawns — both the scoped per-invoice detail session and the processing/automation
run session — so no invoice-owned spawn inherits an unrelated host default
provider. The resolved value SHALL be supplied through the host's existing spawn
model option as a `provider/modelId` string.

The plugin SHALL resolve that model by first-valid-wins precedence:

1. the invoice plugin's own trusted configuration (`model`, else `defaultModel`),
2. the dashboard configuration's `defaultModel`,
3. the `IB_MODEL` environment variable,
4. otherwise no model is passed and the host default applies unchanged.

Every candidate SHALL be validated as `provider/modelId` with both parts
non-empty and free of whitespace and control characters. An invalid candidate
SHALL be logged and skipped so resolution continues down the precedence chain;
it SHALL NOT throw and SHALL NOT prevent the spawn. Resolution SHALL read
configuration values only and SHALL NOT read, log or forward any credential.

#### Scenario: scoped detail spawn uses the configured model

- **WHEN** the dashboard configuration sets `defaultModel` to
  `openai-codex/gpt-5.4` and a scoped session is spawned for an invoice
- **THEN** the spawn SHALL carry model `openai-codex/gpt-5.4`
- **AND** it SHALL NOT fall back to the host's built-in default provider

#### Scenario: processing run spawn uses the configured model

- **WHEN** a flow-dispatching spawn runs for an invoice under that same
  configuration
- **THEN** that spawn SHALL carry the identical resolved model

#### Scenario: plugin configuration outranks dashboard and environment

- **WHEN** the plugin's own configuration names a valid model AND the dashboard
  configuration and `IB_MODEL` name different valid models
- **THEN** the spawn SHALL carry the plugin-configured model

#### Scenario: environment backstop

- **WHEN** neither the plugin nor the dashboard configuration names a model and
  `IB_MODEL` names a valid one
- **THEN** the spawn SHALL carry the `IB_MODEL` model

#### Scenario: malformed configuration falls back safely

- **WHEN** a higher-precedence candidate is malformed (missing provider or
  model id, or containing whitespace)
- **THEN** it SHALL be skipped with a warning
- **AND** the next valid candidate in the chain SHALL be used
- **AND** the spawn SHALL still occur

#### Scenario: no configured model preserves host behaviour

- **WHEN** no plugin config, dashboard `defaultModel` or `IB_MODEL` is present
- **THEN** the spawn SHALL omit the model option entirely, exactly as before

