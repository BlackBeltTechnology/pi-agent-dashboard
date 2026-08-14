## REMOVED Requirements

### Requirement: The per-invoice processing producer is surfaced under the invoice's scoped session name

**Reason:** The per-invoice fan-out producer is a `flows.run invoicebot:process`
run that terminates on completion, not a held-open chat session. Surfacing it
under the scoped session name so it is adopted as canonical made the canonical
scoped session a dead process (no live scoped process, card binds to the global
Ask session, stale mid-run query) and did not fix greeting liveness. Replaced by
"The canonical per-invoice scoped session is a persistent held-open session".

## ADDED Requirements

### Requirement: The canonical per-invoice scoped session is a persistent held-open session

The invoice's canonical scoped session (the detail/chat surface bound to the
card) SHALL be a persistent, held-open session — the flow-less scoped session the
dashboard spawns and binds for the invoice, carrying `IB_TOOLSET=scoped-invoice`
+ `IB_INVOICE_ID`. Resolution SHALL NOT adopt a transient per-invoice processing
producer run (a `flows.run invoicebot:process` fan-out run that terminates on
completion) as the canonical session.

The per-invoice fan-out producer run SHALL keep the automation's own name; it is
therefore never matched by the invoice's canonical-session resolution and never
adopted. When no persistent scoped session yet exists for the invoice,
resolution SHALL spawn one (the scoped spawn path) rather than binding to a
producer run. This SHALL NOT relax the existing global-never-adopted guard: a
shared/global session is still never adopted.

#### Scenario: An ended per-invoice producer run is not adopted

- **WHEN** the only session recorded for an invoice is a per-invoice fan-out
  producer run (`flows.run invoicebot:process`) that has ENDED
- **THEN** resolution SHALL NOT adopt it as the invoice's canonical session
- **AND** `ensureScopedSession` SHALL spawn a fresh persistent scoped session
  stamped `invoicebot-scoped:<invoice_id>` and carrying env
  `{ IB_TOOLSET: "scoped-invoice", IB_INVOICE_ID: <invoice_id> }`

#### Scenario: The per-invoice fan-out producer keeps the automation name

- **WHEN** the per-invoice fan-out fires a run bound to a specific invoice
- **THEN** the spawned run's `automationRun.name` SHALL be the automation's own
  name (not a scoped session name)
- **AND** the run SHALL NOT be adopted as that invoice's canonical session

#### Scenario: The global-never-adopted guard is unchanged

- **WHEN** the only session recorded for an invoice is a shared
  `invoicebot-intake` / `invoicebot-pull` or global `ask` session
- **THEN** resolution SHALL still NOT adopt it as the invoice's canonical session
