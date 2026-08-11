# pin-invoicebot-role-models

## Why

Pinning the spawn model fixed which model an InvoiceBot *session* boots with, but
the agents that run inside that session resolve their model through **role
aliases** (`@classification`, `@extraction`, `@bank-intake`, `@rule-authoring`,
`@validation`, plus `@fast`/`@smart`). Those come from the role map, not from the
spawn option, so a role can silently point at a different provider than the
pinned spawn model.

Observed on a working deployment: the spawn model and most roles agreed, while
`@rule-authoring` and `@validation` resolved to a completely different provider.
Nothing in the product noticed or reported it — the divergence was only visible
by eye in the settings UI. A role pointing at a provider whose credentials are
absent or expired fails the step at run time, mid-invoice.

## What Changes

- Declare the InvoiceBot role set in one place, beside the spawn-model owner.
- Add an audit that compares every InvoiceBot role against the pinned spawn
  model and reports each divergence with the role name and offending value:
  - `divergent` — role resolves to a different provider/model than the pin,
  - `unset` — role has no assignment and would fall through to a host default.
- Run the audit at plugin activation and log one explicit line: either every
  InvoiceBot role is pinned to the resolved model, or exactly which roles are
  not. Divergence is reported, never silently repaired — the role map is
  operator-owned configuration.
- Read the role map defensively: a missing, unreadable or malformed file yields
  an empty map instead of throwing, so activation can never fail on it.
- Reads role identifiers only. No credential is read, logged or forwarded.

## Impact

- Affected specs: `invoicebot-session-profile`
- Affected code: `packages/invoicebot-plugin/src/server/role-models.ts` (new),
  `packages/invoicebot-plugin/src/server/index.ts` (activation audit + log)
- No REST, protocol, client or spawn-path behaviour change: the audit is
  observational. Nothing is rewritten on the operator's behalf.

## Discipline Skills

- `observability-instrumentation` — the defect's whole cost was that a
  misresolved role produced no runtime signal; this change makes it visible.
- `security-hardening` — the audit sits beside credential-selecting
  configuration and must read identifiers only.
