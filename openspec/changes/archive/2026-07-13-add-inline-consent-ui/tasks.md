## 1. Stable names for invoicebot domain events

- [x] 1.1 Add `IB_EVENT_MAP` in `flow-event-wiring.ts` mapping `ib:approval-requested` → `ib_approval_requested` and `ib:approval-decided` → `ib_approval_decided`.
- [x] 1.2 Merge `IB_EVENT_MAP` into the bridge's `EVENT_BUS_MAP` so the EventBus catch-all renames these channels (payload preserved; other `ib:*` still pass through as-is).

## 2. Consent prompts are inline (verify, don't widget-bar)

- [x] 2.1 Confirm a consent `ask_user` prompt not claimed by a widget-bar adapter resolves to inline placement (prompt-bus default), so it renders in the transcript.
- [x] 2.2 Confirm no widget-bar adapter claims the consent prompts (they are not `flow-question`/`architect-prompt`), so `flow-question-routing` does not suppress them.

## 3. Flow discriminator

- [x] 3.1 Assert the forwarded `flow_started` carries `data.flowName` so a consumer can filter runs by flow.

## 4. Tests (faux/offline gate)

- [x] 4.1 Assert `ib:approval-requested` / `ib:approval-decided` emitted on the bus forward via the catch-all with the renamed protocol type and payload preserved.
- [x] 4.2 Assert an unclaimed consent-style prompt resolves to inline placement.
- [x] 4.3 Assert `flow_started` forwarding preserves `flowName`.
- [x] 4.4 Run the extension/plugin test gate and the build green.

## 5. Docs

- [x] 5.1 Document the `ib:*` stable-name forwarding and the inline-by-default consent placement in the plugin README / architecture notes.
