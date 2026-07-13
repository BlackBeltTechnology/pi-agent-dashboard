## 1. Register inline consent components

- [ ] 1.1 Register the consent component family (kinds: rule-activation, rule-archive, approval-request, repair, config, handoff), each with a generic-dialog (inline) placement.
- [ ] 1.2 Confirm the answer contract for each kind: accept/decline (and, for approval-request, a reason on reject) round-trips via the existing prompt-response path.
- [ ] 1.3 Verify none of the consent kinds resolves to a widget-bar placement (so `flow-question-routing` does not suppress them from chat).

## 2. Invoicebot domain-event bridge

- [ ] 2.1 Add `IB_EVENT_MAP` alongside `FLOW_EVENT_MAP`, mapping `ib:approval-requested` and `ib:approval-decided` to browser protocol events.
- [ ] 2.2 Register the `ib:*` listeners on session start (mirroring the flow-event listener registration); forward each event's `data` verbatim via the payload catch-all.
- [ ] 2.3 Keep it headless-safe: no subscriber ⇒ no-op; no error when nothing is listening.

## 3. Flow discriminator

- [ ] 3.1 Assert the forwarded `flow_started` protocol event carries `data.flowName` so a consumer can filter runs by flow.

## 4. Tests (faux/offline gate)

- [ ] 4.1 Assert each consent component kind is registered with an inline (generic-dialog) placement, not widget-bar.
- [ ] 4.2 Assert `ib:approval-requested` / `ib:approval-decided` emitted on the session bus are forwarded to the browser with payload preserved.
- [ ] 4.3 Assert `flow_started` forwarding preserves `flowName`.
- [ ] 4.4 Run the plugin faux gate (fixtures, zero-network) and the build green.

## 5. Docs

- [ ] 5.1 Document the consent component family and the `ib:*` event bridge in the plugin README/architecture notes.
