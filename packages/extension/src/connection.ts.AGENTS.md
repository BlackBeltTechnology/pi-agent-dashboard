# connection.ts — index

WebSocket connection manager with exponential backoff reconnect, message buffering while disconnected,… → see `connection.ts.AGENTS.md` `IMMEDIATE_TYPES` also carries `request_models`: serialized, a hung catalogue refresh head-of-line-blocks the pump and later `send_prompt`s never dispatch. See change: fix-optimistic-prompt-stuck-sending. Migration gate: `retargetTo`/`noteRegistered`/reversal+cooldown replace `updateUrl`. See change: fix-bridge-mdns-migration-hijack.

`DialPlan`/`planDial` per attempt; `ws.on('upgrade')` verifies the server counter-proof BEFORE `open` (fails closed without an emitter); identity failure → quarantine 5 s/30 s doubling to 300 s, single `pendingIdentityReports` slot (≤20) flushed only on a verified open of the same endpoint. See change: loopback-credential-proof (D6, D8).

- Option `outboundFilter(message) → frames[]` applied before serialize/buffer in `send`/`sendIfOpen`; throw fails closed for `event_forward`. See change: add-credential-vault.

`pauseAutoStart(ms)` normalizes + bounds via shared `normalizeQuiesceMs` (invalid ignored, fraction rounded up, capped `MAX_QUIESCE_MS` 120000) and returns the applied ms (0 = ignored); only extends, never shortens; suppression is inclusive (`now <= suppressUntil`). `retargetTo` refusal reason is "candidate health or identity check did not pass". See change: harden-bridge-inbound-and-discovery (D17, D19).

`rejectUnauthorized: true` for remote wss dials; `certValidation` getter. See change: prove-vault-bridge-tls.

Outbound send buffer = two FIFO queues (`controlQueue` ≤256, `otherQueue` ≤`maxBufferSize`) tagged with a monotonic `seq`; `frameType()` reads `frame.type` once at `send()` (no re-parse). `PINNED_FRAME_TYPES` (`session_register`/`session_unregister`/`replay_complete`/`commands_list`/`models_list`/`providers_list`) are never evicted for age, only past the 256 cap; overflow evicts the oldest non-control (amortised O(1): head index + periodic compaction, never `shift`); flush merges by `seq` (`drainBuffer`). Overflow warning reports per-type counts (`droppedTypes=a:n,b:m`), reset on flush; `getDroppedBufferedCount()` stays a monotonic total. Not pinned (known residual): `event_forward` incl. `replay:true`, `session_name_update`/`first_message_update`/`usage_recorded`. See changes: fix-bridge-keep-session-register-on-overflow, fix-session-bridge-registration (D2).

`handleDisconnect` sets `ws.onerror` to a no-op (never null) before `close()`: `ws` emits async `error` closing a CONNECTING socket; unlistened → pi exit 1 (watchdog force-close during stalled reconnect). Test: `__tests__/connection-close-while-connecting.test.ts`.

`openSocket` resets `lastMessageAt` at dial start: watchdog silence measured per dial, each dial gets full `watchdogTimeout` handshake budget; never-opening handshake still torn down. Tests: `__tests__/watchdog.test.ts` (dial-start budget cases).
