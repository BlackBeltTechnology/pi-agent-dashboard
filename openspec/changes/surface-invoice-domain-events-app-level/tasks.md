## 1. Protocol type

- [ ] 1.1 In `packages/shared/src/browser-protocol.ts`, add a `ServerToBrowser` message type for the app-level domain-event frame: `{ type: "ib_domain_event", sessionId: string, event: { eventType: string; data: unknown } }`, and include it in the `ServerToBrowserMessage` union.

## 2. Server rebroadcast

- [ ] 2.1 In `packages/server/src/event-wiring.ts`, in the `event_forward` handler, detect a lifecycle `ib_*` domain-event type (the stable renamed names) and, in addition to the existing per-session `broadcastEvent`, call `broadcastToAll` with the new app-level frame carrying `sessionId` + `{ eventType, data }`.
- [ ] 2.2 Guard the rebroadcast: skip malformed / payload-less events without throwing; no-op when no browser is connected (existing `broadcast` behaviour).
- [ ] 2.3 Do NOT alter the per-session path — the app-level broadcast is strictly additive.

## 3. Observability

- [ ] 3.1 Add a bounded log/metric at the rebroadcast site so a misfire or flood is visible (per `observability-instrumentation`).

## 4. Tests (faux / offline gate)

- [ ] 4.1 Assert a forwarded lifecycle `ib_*` event reaches a connected-but-unsubscribed browser on the app-level channel, carrying the correct `sessionId` and payload.
- [ ] 4.2 Assert the per-session stream still delivers the event to that session's subscribers (additive, not replacing).
- [ ] 4.3 Assert no-browser-connected is a no-op and a malformed event does not crash the gateway.
- [ ] 4.4 Assert a reconnecting client resumes the live stream with no historical replay.

## 5. Docs

- [ ] 5.1 Update `AGENTS.md` rows for `event-wiring.ts` (app-level rebroadcast) and the new `browser-protocol.ts` message type (caveman style). Add `See change: surface-invoice-domain-events-app-level`.

## 6. Verify

- [ ] 6.1 Server + shared package tests green (offline/faux; no live LLM).
- [ ] 6.2 `openspec validate surface-invoice-domain-events-app-level --strict` passes.
