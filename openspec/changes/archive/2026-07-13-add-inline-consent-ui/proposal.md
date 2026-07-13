## Why

The invoicebot plugin exposes invoice operations over REST and relays a session
conversation to the browser, but two things needed to surface consequential
actions as reviewable in-chat confirmations are missing:

1. There is no registered set of **inline interactive components** for the
   consent surfaces (rule activation, rule archive, invoice approve/reject in a
   routing chain, repair, configuration apply, bookkeeping handoff). Without an
   inline-placed component, an `ask_user` confirmation either has no dedicated
   renderer or — if it lands with a widget-bar placement — is suppressed from the
   chat transcript by `flow-question-routing`.
2. The bridge's EventBus catch-all forwards every session-bus channel to the
   browser, so `ib:*` domain events (approval-requested / approval-decided) DO
   reach the browser — but only as their raw channel name, with **no stable,
   renamed protocol type** (unlike `flow:*`, which are renamed via a map). A
   client has no fixed name to subscribe to.

This change gives the consumed `ib:*` events a stable renamed protocol type and
codifies (with tests) that consent `ask_user` prompts render inline in the
transcript, so a subscribed client can render each consent confirmation in the
conversation and react to approval requests live.

## What Changes

- Add a **stable rename** (`IB_EVENT_MAP`) for the consumed `ib:*` domain events
  (`ib:approval-requested` → `ib_approval_requested`, `ib:approval-decided` →
  `ib_approval_decided`), merged into the bridge's rename map so they forward
  under a fixed protocol type with payload preserved (mirroring `FLOW_EVENT_MAP`).
- Codify (with tests) that consent `ask_user` prompts resolve to an **inline**
  placement — the prompt-bus default — so they render in the transcript and are
  not claimed as widget-bar (which `flow-question-routing` suppresses).
- Ensure the forwarded `flow:*` events carry the `flowName` discriminator the
  client uses to distinguish flows (already present on `flow_started`), so a
  consumer can filter domain-specific runs.

## Capabilities

### New Capabilities
- `invoicebot-consent-components`: inline interactive components for the consent
  surfaces, registered with a placement that renders them in the chat transcript.
- `invoicebot-event-bridge`: forwarding of invoicebot `ib:*` domain events from
  the session bus to the browser, payload-preserving.

### Modified Capabilities
<!-- flow-question-routing and flow-event wiring stand; this change adds the
     consent components and the ib:* bridge alongside them. -->

## Impact

- **Plugin (`invoicebot-plugin`)** — registers the consent components and the
  `ib:*` event bridge; no change to the existing REST op surface.
- **Chat rendering** — inline consent components render in the transcript via the
  generic-dialog placement path; widget-bar-suppressed prompts are unaffected.
- **Event stream** — subscribers receive `ib:*` events in addition to `flow:*`;
  existing `flow:*` consumers are unaffected.
- No change to session spawn/dispatch or to the four REST endpoints.
