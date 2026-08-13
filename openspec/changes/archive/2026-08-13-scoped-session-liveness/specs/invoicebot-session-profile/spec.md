# invoicebot-session-profile (delta) — scoped-session-liveness

## ADDED Requirements

### Requirement: A producer-run per-invoice scoped session is adopted as canonical without a dashboard spawn

When an invoice's flow is run by the producer in a session **bound to that
invoice** — a session carrying the invoice's scoped profile
(`IB_TOOLSET=scoped-invoice`, `IB_INVOICE_ID=<invoice_id>`), surfaced as
`automationRun.name === "invoicebot-scoped:<invoice_id>"`, or a per-invoice
`invoicebot:process` run bound to that same invoice — resolving the invoice
(`ensureScopedSession(cwd, invoice_id)` and its
`resolveRecordedSessionIds(cwd, invoice_id)` recorded-run read) SHALL **adopt
that session** as the invoice's canonical session and return its live (or
auto-resumable) session id. The dashboard SHALL NOT spawn a second session for
the invoice when such a bound scoped session already exists.

The dashboard SHALL NOT proactively spawn a scoped session merely to achieve
liveness. Spawning remains only the explicit fallback of
`POST /api/plugins/invoicebot/scoped-session` when the invoice has **no** bound
scoped session at all. A shared `invoicebot-intake` / `invoicebot-pull` or
global `ask` session SHALL NEVER be adopted as the canonical session (the
existing global-never-adopted guard is unchanged).

#### Scenario: The producer's scoped run session is adopted, not re-spawned

- **WHEN** the producer has run an invoice's flow in a session bound to that
  invoice (`IB_INVOICE_ID` set; `automationRun.name` `invoicebot-scoped:<invoice_id>`
  or a per-invoice `invoicebot:process` run) and it is live or ended-restorable
- **THEN** resolving the invoice SHALL return that scoped session's id
- **AND** the dashboard SHALL NOT spawn a new session for the invoice

#### Scenario: The recorded-run read surfaces the producer's scoped session

- **WHEN** the engine's `view:runs` for the `invoice_id` records the producer's
  bound scoped run session
- **THEN** `resolveRecordedSessionIds` SHALL surface that session id as a
  canonical candidate for adoption

#### Scenario: No proactive spawn when no scoped session exists yet

- **WHEN** an invoice has no bound scoped session (the producer has not yet run
  it) and no explicit `POST /scoped-session` call has been made
- **THEN** the dashboard SHALL NOT spawn a session on its own
- **AND** resolution SHALL yield no canonical session until one is adopted or the
  on-demand endpoint is invoked

#### Scenario: A shared intake session is still never adopted for liveness

- **WHEN** only a shared `invoicebot-intake` session that processed the invoice
  is present in the recorded runs
- **THEN** resolution SHALL NOT adopt it as the invoice's canonical session
- **AND** the mounted detail view SHALL NOT be bound to that shared session
