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
2. The plugin forwards `flow:*` lifecycle events to the browser but **not the
   invoicebot domain events** (`ib:*`, e.g. approval-requested / approval-decided).
   A client cannot render a live approval request without them.

This change registers the inline consent components and adds an invoicebot
domain-event bridge, so a subscribed client can render each consent confirmation
in the conversation and react to approval requests live.

## What Changes

- Register **inline interactive components** for the consent surfaces, each with
  a generic-dialog (inline) placement so it renders in the chat transcript and is
  not suppressed by widget-bar routing.
- Add an **invoicebot domain-event bridge** that forwards `ib:*` events from the
  session bus to the browser as protocol events (mirroring the existing `flow:*`
  event wiring), preserving each event's payload verbatim.
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
