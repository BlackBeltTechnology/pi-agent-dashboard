# connection.ts — index

WebSocket connection manager with exponential backoff reconnect, message buffering while disconnected,… → see `connection.ts.AGENTS.md` `IMMEDIATE_TYPES` also carries `request_models`: serialized, a hung catalogue refresh head-of-line-blocks the pump and later `send_prompt`s never dispatch. See change: fix-optimistic-prompt-stuck-sending. Migration gate: `retargetTo`/`noteRegistered`/reversal+cooldown replace `updateUrl`. See change: fix-bridge-mdns-migration-hijack.

`DialPlan`/`planDial` per attempt; `ws.on('upgrade')` verifies the server counter-proof BEFORE `open` (fails closed without an emitter); identity failure → quarantine 5 s/30 s doubling to 300 s, single `pendingIdentityReports` slot (≤20) flushed only on a verified open of the same endpoint. See change: loopback-credential-proof (D6, D8).

- Option `outboundFilter(message) → frames[]` applied before serialize/buffer in `send`/`sendIfOpen`; throw fails closed for `event_forward`. See change: add-credential-vault.

`pauseAutoStart(ms)` normalizes + bounds via shared `normalizeQuiesceMs` (invalid ignored, fraction rounded up, capped `MAX_QUIESCE_MS` 120000) and returns the applied ms (0 = ignored); only extends, never shortens; suppression is inclusive (`now <= suppressUntil`). `retargetTo` refusal reason is "candidate health or identity check did not pass". See change: harden-bridge-inbound-and-discovery (D17, D19).
