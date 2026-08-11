# Relocate InvoiceBot domain-event forwarding into the invoicebot plugin

## Why

The app-level `ib_domain_event` rebroadcast has fired ZERO times on a live
deployment: merge `c60f3054` dropped `...IB_EVENT_MAP` from the bridge's
send-side rename map (parent had it at `bridge.ts:1490`; the merged tree's
`bridge.ts:1515` builds it from FLOW + SUBAGENT only), so subscribed `ib:*`
frames forward under their raw colon names and the server gate
`eventType?.startsWith("ib_")` (`event-wiring.ts:754`) never matches. The
InvoiceBot board/detail/progress surfaces are dead as a result.

Restoring the spread would fix the symptom but re-cement the defect that made
this regression possible: **the dashboard core hardcodes one product's domain
vocabulary in two places** — `IB_EVENT_MAP` in
`packages/extension/src/flow-event-wiring.ts` and the `startsWith("ib_")`
special case in `packages/server/src/event-wiring.ts`. Product knowledge split
across core files is exactly what a merge can silently tear apart.

The repo already has the correct seam, used by goal-plugin
(`add-goal-continuation-plugin`): a plugin **bridge entry** runs in-session,
observes its own domain, and forwards over the generic
`dashboard:plugin-message` → `plugin_pi_message` → `registerPiHandler`
channel. "Keeps plugin-specific payloads out of the typed core protocol: the
envelope is generic, `payload` is opaque."

## What Changes

- `packages/invoicebot-plugin` gains a **bridge entry**
  (`src/bridge/index.ts`, manifest `bridge` field): subscribes to the declared
  `ib:*` lifecycle channels via `pi.events.on` (observes foreign emitters —
  the engine extension), renames each mechanically (`:`/`-` → `_`), and
  re-emits on `dashboard:plugin-message` with
  `{ pluginId: "invoicebot", messageType: "ib_domain_event", payload: { eventType, data } }`.
- `packages/invoicebot-plugin/src/server/index.ts` registers
  `registerPiHandler("ib_domain_event", …)` and pushes the **byte-identical
  existing wire frame** `{ type: "ib_domain_event", sessionId, event: { eventType, data } }`
  to every connected browser via `broadcastToSubscribers` (which fans out to
  all browser sockets). Malformed / payload-less frames are skipped, never
  fatal.
- **Core decontamination**: DELETE `IB_EVENT_MAP` from
  `flow-event-wiring.ts`, its two `bridge.ts` references (import + extraMaps
  arg), and the `startsWith("ib_")` rebroadcast block + counters from
  `event-wiring.ts`. After this change,
  `grep -rn "ib_\|ib:" packages/extension packages/server` returns nothing
  invoicebot-specific.
- Per-session `event_forward` frames for `ib_*` are retired (no in-repo
  consumer exists; the browser contract is the app-level frame only).
- Core tests that pinned the old placement are ported to the plugin
  (`surface-invoice-domain-events-bridge.test.ts`,
  `event-wiring-ib-app-level.test.ts`, and the IB half of
  `add-inline-consent-ui.test.ts`); coverage is preserved like-for-like at the
  new owner.

## Non-goals

- No change to the browser wire contract: consumers of
  `{ type: "ib_domain_event", sessionId, event: { eventType, data } }` need
  zero changes.
- No change to flow/subagent event forwarding, the generic
  `dashboard:plugin-message` seam, or any other plugin.

## Capabilities

- **MODIFIED** `invoicebot-event-bridge` — forwarding moves from the core
  bridge rename map to the plugin bridge entry; declared-set semantics
  (undeclared channels are NOT forwarded); mechanical rename.
- **MODIFIED** `invoicebot-app-level-events` — the rebroadcast moves from
  core event-wiring to the plugin server entry over the generic plugin
  channel; wire frame unchanged; per-session `ib_*` stream retired.

## Discipline Skills

- `review-code` (non-trivial change, before commit)
