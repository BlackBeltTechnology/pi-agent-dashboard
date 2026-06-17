## Context

The browser gateway (`packages/server/src/browser-gateway.ts`) fans out messages to all connected browser sockets through `fanout(serialized)`, which guards each send with `readyState === OPEN` and `bufferedAmount > MAX_WS_BUFFER` (4 MB default, `browser-gateway.ts:265`). `openspec_update` is broadcast via `broadcastToAll` / `broadcastOpenSpecUpdate` keyed by `cwd` — never filtered by per-socket subscription. The poll loop (`directory-service.ts::startPolling`, interval `pollIntervalSeconds: 60`) drives these from `session-bootstrap.ts`, and a cold-boot `Promise.all` over `knownDirectories()` fires a burst at connect.

The existing harness `browser-gateway-broadcast-serialize-once.test.ts` proves correctness with a static fake socket (`send: vi.fn()`, `bufferedAmount: 0`). It cannot model timing: nothing accumulates in the buffer, nothing drains, so head-of-line blocking is invisible. We need a timing-aware fake socket plus a virtual clock.

## Goals / Non-Goals

**Goals**
- Reproduce head-of-line blocking deterministically: measure how long a focused-session live `event` waits behind competing `openspec_update` traffic on a shared socket.
- Quantify wasted bytes (openspec payloads delivered to sockets that don't view the cwd) and dropped frames (sends skipped by the `MAX_WS_BUFFER` guard).
- Distinguish "periodic (openspec poll cadence)" from "continuous (upstream)" lag signatures.
- Run in `npm test` with zero wall-clock sleeps and zero flakiness.

**Non-Goals**
- No production fix. Subscription-scoped fan-out, payload diffing, or per-cwd routing are follow-on changes gated on this harness's evidence.
- No real end-to-end socket benchmark against a live server (a heavier, separately-filed step if absolute ms numbers are later needed).
- No client-side render measurement.

## Decisions

### Decision 1 — Virtual clock, not real timers
`DrainingFakeWs.advance(ms)` mutates `bufferedAmount` synchronously by `drainRateBytesPerMs * ms`, clamped at 0. Tests advance the clock explicitly between/after broadcasts. No `setTimeout`, no `await sleep`. This makes every scenario deterministic and sub-millisecond to run.

**Alternative rejected:** `vi.useFakeTimers()`. The gateway's `fanout` is synchronous and does not schedule timers; the queue drain is a property of the transport, not of gateway code. Modeling drain as an explicit clock the test owns is simpler and avoids coupling to vitest timer internals.

### Decision 2 — `bufferedAmount` is the single source of truth for queue depth
`send(frame)` does `bufferedAmount += byteLength(frame)` and pushes a record `{ seq, enqueuedAt: now, bytesAtEnqueue: bufferedAmount, type, cwd, sessionId }`. `timeToFlush(record)` = the smallest `advance` total at which cumulative drained bytes ≥ `bytesAtEnqueue`. This directly models FIFO wire drain: a frame is "flushed" only once everything queued ahead of it (plus itself) has drained. This is the head-of-line metric.

**Why byte length, not frame count:** the cost that blocks the wire is bytes, and openspec payloads vary by orders of magnitude (empty vs many-changes repo). Frame count would hide the payload-size amplifier (scenario C).

### Decision 3 — Drive the REAL gateway, fake only the socket
Tests call `createBrowserGateway(realSessionManager, realEventStore, stubPiGateway)` and `gateway.wss.emit("connection", ws, {})` exactly like the existing test. Only the socket is the `DrainingFakeWs`. This guarantees the harness measures the actual `fanout` / `broadcastOpenSpecUpdate` / backpressure-guard code, not a reimplementation. If production fan-out logic changes, the harness tracks it for free.

### Decision 4 — `drainRateBytesPerMs` is a fixture parameter with two named presets
`FAST` ≈ LAN (e.g. 50 MB/s → 50_000 bytes/ms) and `SLOW` ≈ constrained mobile/tunnel (e.g. 0.5 MB/s → 500 bytes/ms). The harness proves **relative** effects (B worse than A; amplifiers C/D/E worsen B) robustly. Absolute presets are documented as illustrative, not calibrated to a real link. The doc states this caveat explicitly so results are never over-claimed.

### Decision 5 — Budgets are assertions, not just logs
Each scenario asserts an upper bound (e.g. scenario A focused-event flush < X virtual ms; scenario B wasted-bytes-to-focused-socket > 0 to prove the leak exists, and a regression bound once a fix lands). Budgets are defined as named constants at the top of the test so a future fix can tighten them in one place. Until a fix lands, B/C/D/E budgets are written as **characterization** assertions (documenting current behavior) with a `// REGRESSION TARGET:` comment marking the value a scoped-fan-out change should achieve.

### Decision 6 — Synthetic openspec payloads sized by target serialized bytes
`makeOpenSpecPayload(sizeBytes)` pads a valid `OpenSpecData` shape (changes array of synthetic entries) until `JSON.stringify` length ≈ `sizeBytes`. This lets scenario C sweep payload size independent of topology, isolating the size amplifier.

## Risks / Trade-offs

- **Model fidelity vs reality.** A linear drain model ignores TCP slow-start, Nagle, and OS buffer behavior. Mitigation: scope claims to relative effects + document the caveat; absolute numbers require the separately-filed live benchmark.
- **Harness drift.** If the gateway later batches or coalesces broadcasts, budgets must be revisited. Mitigation: harness drives real code, so behavioral changes surface as test failures (a feature, not a bug) and force a deliberate budget update.
- **False precision.** Named FAST/SLOW presets could be mistaken for calibrated link speeds. Mitigation: explicit "illustrative, not calibrated" note in code comment and doc.

## Migration Plan

Additive, test-only. No migration. Lands green by characterizing current behavior; a follow-on fix change tightens the REGRESSION TARGET budgets.
