# Design — scoped-session-liveness (dashboard half)

## The two roads (why cost lives and state does not)

```
                 ib:* domain events on the session bus
                 (invoice_id inside every payload.data)
                              │
              ┌───────────────┴─────────────────┐
              ▼                                  ▼
   ROAD A — GLOBAL BROADCAST          ROAD B — PER-INVOICE CONVERSATION
   plugin bridge subscribes ib:*      the invoice's own SCOPED session
   → ib_domain_event                  streams its greeting / progress /
   → broadcastToSubscribers           data through the existing /ws
   (every browser, address-less)      per-session replay+live channel
              │                                  │
              ▼                                  ▼
   cost badge updates LIVE            greeting/progress/data render
   (needs no session)                ONLY if the detail view is bound
                                      to a scoped session that exists
```

Cost lands because Road A needs no session — the frame reaches every browser and
the consumer keys the cost badge by `payload.data.invoice_id`. Greeting/progress/
data are the *conversation* of the invoice's own scoped session (Road B); with
**zero scoped sessions** in the container, the mounted detail view is bound to
nothing, so those never move.

## Fork A seam

The producer (engine, other repo) runs each invoice's flow **in its own scoped
session**, bound at spawn with `IB_TOOLSET=scoped-invoice` and
`IB_INVOICE_ID=<invoice_id>`, surfaced to the dashboard as
`automationRun.name === "invoicebot-scoped:<invoice_id>"` (or a per-invoice
`invoicebot:process` run bound to the same invoice). Therefore scoped sessions
now **exist**, and the engine's `view:runs` for an `invoice_id` resolves to them.

The dashboard's job is to **adopt** that session — not to spawn its own.

```
producer runs invoice flow ──► scoped session (IB_INVOICE_ID bound)
                                        │  registers, runs
                                        ▼
open invoice X ─► ensureScopedSession(cwd, X)
                    warm paths (cached/stored/restored) ─┐
                    recordedUsableSession(cwd, X) ◄──────┘ resolveRecordedSessionIds
                        → engine view:runs invoice_id=X → the scoped run session id
                    ADOPT it (scoped, bound) → return sessionId  (NO spawn)
                                        │
                                        ▼
              detail ChatView binds to sessionId over existing /ws
              → greeting/progress/data go live; state-changed lands
```

## What already exists (reused, not rebuilt)

- `session-link.ts:491` `ensureScopedSession` → `ensureScopedSessionUnsafe`
  warm-path chain (`cached → stored → restored → recorded → spawn`).
- `resolveRecordedSessionIds(cwd, invoiceId)` (wired at
  `src/server/index.ts:63`) → engine `query(cwd,{view:"runs",invoice_id})`.
- The canonical-adoption gate (`invoicebot-session-profile`): adopt a
  `invoicebot-scoped:<id>` or per-invoice `invoicebot:process` session; **never**
  adopt a shared `invoicebot-intake` / global session.
- `POST /api/plugins/invoicebot/scoped-session` (`routes.ts:153`) — the on-demand
  resolve surface; returns a real live/resumable sessionId, never a spawn token.
- The plugin bridge (`src/bridge/index.ts`) + plugin-server forwarder
  (`src/server/index.ts:100`) — Road A, already carrying cost live.

## The delta this change asserts

1. **Adoption of the producer-run scoped session is the primary resolve path.**
   `recordedUsableSession` must surface the producer's per-invoice scoped run and
   the gate must adopt it as canonical, so opening the invoice yields a live
   bound session **without a dashboard spawn**. The spawn branch becomes a
   fallback only (invoice with no scoped session at all).

2. **Forwarded domain events stay invoice-addressable and cover every
   transition.** `payload.data.invoice_id` is preserved verbatim (already the
   contract) and `ib_invoice_state_changed` is forwarded for each observed
   transition — the same declared+forwarded road cost proves — so a bound detail
   view reflects state live.

## Risks

- **Gate widening** — the adoption path must not admit a shared intake/global
  session as canonical (that reinstates the original defect). The existing
  "global session is never adopted" scenarios remain the guard; new scenarios
  add the producer-run scoped session as an explicit ADOPT case, not a widening.
- **No proactive spawn** — if the producer has not yet run the invoice, there is
  no scoped session to adopt; the on-demand `POST /scoped-session` fallback (or a
  later dispatch) is the only spawn trigger. This is intentional under Fork A.
