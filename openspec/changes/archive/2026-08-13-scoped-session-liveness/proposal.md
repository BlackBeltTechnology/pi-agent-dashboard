# scoped-session-liveness

## Why

With an invoice's detail view held open for its entire processing cycle, the
screen looks frozen: the greeting never changes, the progress track never
advances, the invoice data fields stay empty, and the row is transiently
classified as unprocessable until a manual refresh — yet **processing cost
updates live on that same mounted screen**.

That asymmetry is the whole diagnosis. Cost and state travel two different roads:

- **Cost** rides the plugin bridge's app-level broadcast: the plugin bridge
  entry subscribes the declared `ib:*` set directly and the plugin server pushes
  `ib_domain_event` to every browser (`packages/invoicebot-plugin/src/bridge/index.ts`,
  `.../src/server/index.ts`). Cost updating live is the existence proof that this
  road works end-to-end.
- **Greeting / progress / data** depend on the invoice having a **scoped session
  of its own** to render — and the running container shows several shared
  `invoicebot-intake` sessions and **zero** scoped ones. An opened invoice has no
  session to bind its conversation to, so greeting/progress/data have nowhere to
  land; the transient "unprocessable" flash follows from an unbound, empty view.

`ib:invoice-state-changed` is in the *same* declared+forwarded set as
`ib:invoice-cost-updated` — so the dashboard's forwarding does not drop state.
The two remaining gaps are (1) no per-invoice scoped session exists for the
detail view to adopt, and (2) state-changed only lands when the invoice's
conversation is bound to that scoped session.

The producer half (out of this repo) is being changed so that each invoice's
flow **runs in its own scoped session** bound with `IB_INVOICE_ID` /
`IB_TOOLSET=scoped-invoice`, so scoped sessions **will** exist and the engine's
recorded runs will resolve to them. This change makes the dashboard half meet
that seam.

## What Changes

This change drives the two existing home specs to the observable liveness
outcome; it introduces **no new mechanism** and stays entirely under
`packages/invoicebot-plugin/`.

- **`invoicebot-session-profile`** — the plugin's canonical-session resolution
  (`ensureScopedSession` / `resolveRecordedSessionIds` in
  `src/server/session-link.ts`) SHALL **adopt the producer-run per-invoice scoped
  session** as the invoice's canonical session: when the engine runs an invoice's
  flow in a session bound to that invoice (`IB_INVOICE_ID`, surfaced as
  `automationRun.name === "invoicebot-scoped:<invoice_id>"` or a per-invoice
  `invoicebot:process` run), resolving the invoice SHALL return that live scoped
  session id without the dashboard spawning a second one.

- **Dashboard role under Fork A is adopt/resolve + forward — no proactive
  spawn for liveness.** The `POST /scoped-session` spawn *fallback* remains for an
  explicit on-demand call when the invoice genuinely has no scoped session, but
  the liveness path relies on adopting the producer's session, not on the
  dashboard initiating a spawn.

- **`invoicebot-event-bridge`** — the forwarded domain-event frame SHALL remain
  **invoice-addressable**: `payload.data` carries `invoice_id` verbatim so a
  consumer holding an invoice open can route state/progress to it without knowing
  which session produced it, exactly as cost already does. `ib_invoice_state_changed`
  SHALL be forwarded for **every** observed transition on the scoped session's
  bus (not only terminal ones), on the same road cost proves.

## Dashboard role (explicit, Fork A)

The dashboard does **not** proactively spawn a scoped session to achieve
liveness. Its responsibilities are exactly: (a) **resolve/adopt** the producer's
per-invoice scoped run session as canonical and return it through the plugin API,
and (b) **forward** the invoice's `ib:*` domain events to the browser addressed
by invoice (`invoice_id` in `payload.data`). Spawning remains only the explicit
`POST /scoped-session` fallback for an invoice with no scoped session.

## Discipline Skills

- `systematic-debugging` — the change acts on a measured root cause (the live
  cost/state asymmetry proves transport + renderer are fine; the defect is the
  missing per-invoice scoped session and its adoption), not a guessed rendering
  fix.
- `review-code` — the adoption gate must never widen to admit a shared
  `invoicebot-intake` / global session as an invoice's canonical session; a
  careful review of the gate is required.

## Non-goals

- No new WebSocket message type and no change to the `ib_domain_event` wire
  contract; consumers of `{ type:"ib_domain_event", sessionId, event:{ eventType,
  data } }` need zero changes.
- No change to `packages/extension` / `packages/server` / `packages/shared`; all
  work stays under `packages/invoicebot-plugin/`.
- The producer-side change (running each invoice's flow in its own scoped
  session, emitting mid-flight `ib:invoice-state-changed`) is out of scope for
  this repo.
- Upload placement, harness hygiene, and branch routing are out of scope.
