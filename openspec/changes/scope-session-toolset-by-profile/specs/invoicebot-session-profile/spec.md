## ADDED Requirements

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
