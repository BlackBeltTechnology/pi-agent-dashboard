## ADDED Requirements

### Requirement: The per-invoice processing producer is surfaced under the invoice's scoped session name

When the per-invoice fan-out runs an invoice's flow (a fire bound to a specific
invoice — the scheduled drain fan-out or a manual per-invoice run-now), the
spawned run session SHALL be surfaced with
`automationRun.name === "invoicebot-scoped:<invoice_id>"` — the same scoped
session name the invoice's canonical-session resolution keys on — so that the
producer, which carries the invoice's persisted greeting history in its
`.jsonl`, is adopted as the invoice's canonical session (per "A producer-run
per-invoice scoped session is adopted as canonical without a dashboard spawn")
rather than bypassed for a fresh, greeting-less detail spawn.

A fire NOT bound to a single invoice (a folder- or global-scope fire) SHALL keep
the automation's own name. The scoped name SHALL be sourced from the invoicebot
scoped-session naming (the single source of truth for
`invoicebot-scoped:<invoice_id>`); the generic fan-out SHALL carry no
invoicebot-specific naming of its own. Surfacing the producer under the scoped
name SHALL NOT relax the global-never-adopted guard: a run that is not bound to a
single invoice keeps a non-scoped name and remains non-adoptable.

#### Scenario: A per-invoice fan-out run is named for adoption

- **WHEN** the fan-out fires a run bound to invoice `inv-7`
- **THEN** the spawned run's `automationRun.name` SHALL be `"invoicebot-scoped:inv-7"`
- **AND** resolving `inv-7` SHALL adopt that producer session as canonical instead of spawning a fresh detail session

#### Scenario: A folder/global fire is not scoped-named

- **WHEN** a fire is not bound to a single invoice (folder or global scope)
- **THEN** the spawned run keeps the automation's own name
- **AND** it remains non-adoptable as any invoice's canonical session

#### Scenario: The global-never-adopted guard is unchanged

- **WHEN** the only session recorded for an invoice is a shared `invoicebot-intake` / `invoicebot-pull` or global `ask` session
- **THEN** resolution SHALL still NOT adopt it as the invoice's canonical session
