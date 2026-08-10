# replay-delta-on-reload.spec.ts — index

Playwright spec. Strategy A: reload of seen session resubscribes lastSeq>0 (delta replay). Captures WS subscribe frames via page.on("websocket")→framesent, asserts lastSeq>0 post-reload. Asserts chat repaints (IndexedDB rehydrate). Drives `[[faux:plain-text]]`. PI_E2E_SEED=1. See change: reduce-session-replay-traffic.
