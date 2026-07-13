## Context

The invoicebot plugin already: serves the four REST ops, dispatches flows into a
workspace session, and relays that session's timeline to the browser. The
browser also receives `flow:*` lifecycle events via the extension's flow-event
wiring (`FLOW_EVENT_MAP`), which the client folds for flow rendering.

Two gaps block in-chat consent UI. First, an `ask_user` confirmation needs a
registered interactive component with an inline placement; `flow-question-routing`
suppresses any prompt whose component resolves to a widget-bar placement, so the
consent components must be registered as generic-dialog (inline). Second, the
invoicebot domain events (`ib:*`) that carry approval requests are emitted on the
session bus but never mapped to a browser protocol event — only `flow:*` and
`subagents:*` are wired.

## Goals / Non-Goals

**Goals**
- Register inline components for all consent surfaces so they render in chat.
- Forward `ib:*` domain events to the browser, payload-preserving.

**Non-Goals**
- No new REST endpoints; the consent commit actions use the existing ops.
- No client-side rendering of the components here (a consumer draws them).
- No change to flow dispatch or session linkage.

## Decisions

### D1 — Consent components are generic-dialog (inline), never widget-bar
Each consent component is registered with the inline/generic-dialog placement so
`flow-question-routing` renders it in the transcript. A widget-bar placement
would suppress it from chat, which is the wrong surface for a consent card.

### D2 — Mirror the flow-event wiring for `ib:*`
Add an `IB_EVENT_MAP` alongside `FLOW_EVENT_MAP`, registering listeners for the
invoicebot domain events and forwarding each to the browser as a protocol event
with its `data` preserved verbatim (the same catch-all payload path the flow
wiring uses). Headless-safe: no subscriber ⇒ no-op.

### D3 — Preserve the `flowName` discriminator
`flow_started` already carries `data.flowName`. This change asserts and tests
that the discriminator survives forwarding, so a consumer can filter runs by
flow. No new field is introduced.

### D4 — One component family, parameterized by kind
The consent surfaces share a shape (title, preview body, accept/decline). Register
them as a small family keyed by kind (rule-activation, rule-archive,
approval-request, repair, config, handoff) rather than six unrelated components,
to keep the placement and answer contract uniform.

## Risks / Trade-offs

- **Placement regression** — if a component is registered widget-bar by mistake,
  its card vanishes from chat. Mitigated by a test asserting inline placement for
  every consent component kind.
- **Event volume** — forwarding all `ib:*` events adds traffic. Mitigated by
  mapping only the events a consumer needs (approval-requested/decided first),
  extensible later.

## Open Questions

- Whether to forward the full `ib:*` set now or only the approval events. This
  change wires the approval events; the map is structured to extend to
  connector/intake events without a contract change.
