## 1. Extend the rename map

- [x] 1.1 In `packages/extension/src/flow-event-wiring.ts`, extend `IB_EVENT_MAP` with the full lifecycle set: `ib:invoice-state-changed`, `ib:connector-registered`, `ib:connector-health`, `ib:connector-needs-auth`, `ib:intake-paused`, `ib:intake-resumed`, `ib:intake-poll-complete`, `ib:automation-toggled`, `ib:automation-cadence-set`, `ib:source-item-detected`, `ib:source-item-dispatched`, `ib:source-item-skipped`, `ib:source-error` — each mapped to its `ib_*` underscore form.
- [x] 1.2 Leave the two existing entries (`ib:approval-requested`, `ib:approval-decided`) unchanged.
- [x] 1.3 Confirm no per-field remapping is needed — payloads ride inside `data` and forward verbatim via the existing catch-all.

## 2. Tests (faux / offline gate)

- [x] 2.1 Assert `ib:invoice-state-changed` with `{ invoice_id, state, hold_reason? }` forwards as `ib_invoice_state_changed` with payload preserved.
- [x] 2.2 Assert every lifecycle entry in `IB_EVENT_MAP` renames to its mapped `ib_*` type (table-driven).
- [x] 2.3 Regression: assert `ib:approval-requested` / `ib:approval-decided` still map to `ib_approval_requested` / `ib_approval_decided`.
- [x] 2.4 Assert an unmapped `ib:*` channel passes through under its raw name.
- [x] 2.5 Assert events emitted before session-ready are not forwarded.

## 3. Docs

- [x] 3.1 Update the `flow-event-wiring.ts` row in the nearest `packages/extension/src/AGENTS.md` to note the extended `IB_EVENT_MAP` lifecycle coverage (caveman style). Add `See change: surface-invoice-domain-events-bridge`.

## 4. Verify

- [x] 4.1 Extension package tests green (offline/faux; no live LLM).
- [x] 4.2 `openspec validate surface-invoice-domain-events-bridge --strict` passes.
