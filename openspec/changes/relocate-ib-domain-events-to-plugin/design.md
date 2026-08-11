# Design — relocate-ib-domain-events-to-plugin

## Decision 1 — plugin bridge entry over the generic seam (copy goal-plugin)

The invoicebot plugin gains a `bridge` manifest entry, exactly like
goal-plugin. It runs in-session next to the invoice engine extension and uses
`pi.events.on` per declared channel — the same mechanism
`fix-automation-run-lifecycle` (#456) established, because `on()` observes
every emitter on the shared bus while patching/emitting through one
extension's facade does not.

Transport chain (all pre-existing, generic, untouched):

```
engine ext: pi.events.emit("ib:invoice-state-changed", data)
  → plugin bridge entry (this change): pi.events.on(channel)
      → pi.events.emit("dashboard:plugin-message",
          { pluginId:"invoicebot", messageType:"ib_domain_event",
            payload:{ eventType:"ib_invoice_state_changed", data } })
  → main bridge (bridge.ts:2388): wraps as
      { type:"plugin_pi_message", sessionId, pluginId, messageType, payload }
  → server event-wiring (:688): dispatchPluginPiMessage(messageType, msg)
  → invoicebot plugin server: registerPiHandler("ib_domain_event", …)
      → broadcastToSubscribers({ type:"ib_domain_event", sessionId,
                                 event: payload })   // wire frame UNCHANGED
```

`broadcastToSubscribers` is `browserGateway.broadcast()` — a fan-out to every
connected browser socket (`pairing/browser-gateway.ts:471` `fanout` iterates
`subscriptions` keys, i.e. all connected sockets, not per-session filters), so
the app-level "no per-session subscribe needed" property is preserved.

## Decision 2 — mechanical rename, owned by the plugin

`ib:invoice-state-changed` → `ib_invoice_state_changed` is
`channel.replace(/[:-]/g, "_")` for every declared channel. The channel list
and the rename live in ONE module in the plugin
(`src/shared/ib-events.ts`); nothing invoicebot-specific remains in
`packages/extension` or `packages/server`. A regression like `c60f3054`
(merge losing one of two core touch points) is structurally impossible: there
is one touch point and it is inside the product's own package.

## Decision 3 — per-session `ib_*` event_forward retired

The old design forwarded `ib_*` twice: per-session `event_forward` (into the
event store + per-session broadcast) AND the app-level rebroadcast. Verified:
no in-repo consumer reads per-session `ib_*` events
(`grep -rn 'ib_invoice|ib_approval|ib_domain' packages/client/src` → empty);
the external consumer contract is the app-level frame only
(`invoice-state-feed.ts:42-44`, `processing-cost-feed.ts:52-54`). Keeping the
per-session path would require `ib:*` knowledge in core forwarding — the exact
contamination this change removes. The `invoicebot-app-level-events` spec's
"per-session stream preserved" requirement is modified accordingly.

Consequence: `ib_*` frames no longer appear in a session's event store /
ChatView raw stream. Accepted — they were never rendered.

## Decision 4 — readiness gating is inherited, not re-implemented

The old bridge gate (`sessionReady && isActive()`) protected `event_forward`
framing. On the new path, the main bridge's `dashboard:plugin-message`
listener is registered inside the `session_start` handler (bridge.ts:2388),
so a `plugin_pi_message` can only be framed once the session is established —
equivalent gating with zero new mechanism. Emissions before that are dropped
exactly as before (delta-only channel; the client re-syncs its baseline out of
band per the existing spec).

## Decision 5 — malformed-frame policy moves to the plugin server

The old core block skipped `data === undefined || null` with a warn counter.
The plugin server handler keeps the same policy (skip + rate-limited warn),
plus guards `sessionId` and `payload.eventType` presence, since the generic
channel is looser-typed than the old dedicated one.

## Rejected alternative — restore `...IB_EVENT_MAP` in bridge.ts:1515

One-line fix, wrong owner. It survives until the next core refactor/merge
touches either of the two core sites again, and it keeps the
`startsWith("ib_")` product special-case in the server hot path. Rejected per
the plugin-boundary principle already applied to goal-plugin.

## Test placement

- Unit (plugin): declared-set + mechanical rename + envelope shape + foreign
  emitter observed via `on()` + undeclared channel not forwarded.
- Integration (plugin, full server): `plugin_pi_message` in over the pi WS →
  `ib_domain_event` out to an unsubscribed browser; malformed skip; frame
  shape byte-compatible with the old test's assertions (ported from
  `event-wiring-ib-app-level.test.ts`).
- Core tests pinned to the old placement are deleted WITH their coverage
  ported (no coverage loss): `surface-invoice-domain-events-bridge.test.ts`,
  `event-wiring-ib-app-level.test.ts`, IB half of
  `add-inline-consent-ui.test.ts`.
