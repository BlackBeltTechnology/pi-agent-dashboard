# Tasks — relocate-ib-domain-events-to-plugin

## 1. Tests first (red)

- [x] 1.1 `packages/invoicebot-plugin/src/__tests__/ib-events.test.ts` — unit:
      declared channel list = 16 lifecycle channels; mechanical rename
      (`:`/`-` → `_`) for every declared channel; undeclared channel rejected.
- [x] 1.2 `packages/invoicebot-plugin/src/__tests__/ib-bridge-entry.test.ts` —
      unit: activating the bridge entry against a fake shared bus subscribes
      via `on()`; a FOREIGN facade emitting `ib:invoice-state-changed` yields
      exactly one `dashboard:plugin-message` with the exact envelope
      `{ pluginId:"invoicebot", messageType:"ib_domain_event", payload:{ eventType, data } }`;
      undeclared channel emits nothing; payload verbatim (cost payload incl.
      sub-cent numbers + absent model).
- [x] 1.3 `packages/invoicebot-plugin/src/server/__tests__/ib-app-level-rebroadcast.test.ts`
      — integration (full server, ported from
      `event-wiring-ib-app-level.test.ts`): a `plugin_pi_message` frame over
      the pi WS reaches an UNSUBSCRIBED browser as
      `{ type:"ib_domain_event", sessionId, event:{ eventType, data } }`;
      malformed (null data) skipped; well-formed after malformed still
      broadcast. THIS IS THE REGRESSION TEST — record red output on the
      unmodified tree.
- [x] 1.4 Run 1.1–1.3, confirm red.

## 2. Plugin implementation (green)

- [x] 2.1 `packages/invoicebot-plugin/src/shared/ib-events.ts` — declared
      channel list (16), `renameIbChannel()`, envelope constants.
- [x] 2.2 `packages/invoicebot-plugin/src/bridge/index.ts` — bridge entry
      (goal-plugin shape): per-channel `pi.events.on` → re-emit
      `dashboard:plugin-message`.
- [x] 2.3 Manifest: add `"bridge": "./src/bridge/index.ts"` to
      `pi-dashboard-plugin` in `packages/invoicebot-plugin/package.json`.
- [x] 2.4 `packages/invoicebot-plugin/src/server/index.ts` —
      `registerPiHandler("ib_domain_event", …)` → validate → 
      `broadcastToSubscribers({ type:"ib_domain_event", sessionId, event: payload })`,
      malformed skip + rate-limited warn.

## 3. Core decontamination

- [x] 3.1 Delete `IB_EVENT_MAP` (+ doc block) from
      `packages/extension/src/flow-event-wiring.ts`.
- [x] 3.2 Delete its import (bridge.ts:45) and the `[IB_EVENT_MAP]` extraMaps
      arg (bridge.ts:2036) from `packages/extension/src/bridge.ts`.
- [x] 3.3 Delete the `startsWith("ib_")` rebroadcast block and the
      `ibRebroadcastCount`/`ibRebroadcastSkipped` counters from
      `packages/server/src/event-wiring.ts`.
- [x] 3.4 Port-and-delete core tests:
      `packages/extension/src/__tests__/surface-invoice-domain-events-bridge.test.ts`,
      `packages/server/src/__tests__/event-wiring-ib-app-level.test.ts`;
      trim the IB describe from
      `packages/extension/src/__tests__/add-inline-consent-ui.test.ts`
      (PromptBus half stays).
- [x] 3.5 Acceptance gate:
      `grep -rn "ib_\|ib:" packages/extension/src packages/server/src`
      returns nothing invoicebot-specific.

## 4. Validate

- [x] 4.1 `npx tsc --noEmit` clean (modulo pre-existing unrelated errors, none
      expected).
- [x] 4.2 Scoped `npm test` green: invoicebot-plugin suites + extension
      `flow-event-wiring`/consent suites + server event-wiring suites.
- [x] 4.3 `npx openspec validate relocate-ib-domain-events-to-plugin --strict`.
- [x] 4.4 Docs: update nearest `AGENTS.md` rows for new files
      (invoicebot-plugin bridge/shared/tests).
