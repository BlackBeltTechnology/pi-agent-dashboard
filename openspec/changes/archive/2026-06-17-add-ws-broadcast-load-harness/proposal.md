## Why

A user reports periodic WebSocket lag and suspects `openspec_update` frames for non-focused sessions clog the single browser socket. Investigation confirms the mechanism is plausible but unmeasured:

- Each browser tab holds **one** WebSocket, multiplexed across all sessions (`packages/server/src/browser-gateway.ts`).
- `openspec_update` is fanned out to **every** open socket keyed by `cwd`, not filtered by which cwd/session a client is viewing (`fanout()` in `browser-gateway.ts`; `broadcastToAll` call sites in `session-bootstrap.ts:109`, `server.ts:737`/`:755`, `directory-handler.ts`). The client filters client-side, so a focused tab still receives every other cwd's payload.
- The poll runs every 60 s by default (`pollIntervalSeconds: 60`, `packages/shared/src/config.ts:118`) over `computeKnownDirectories()` = pinned dirs + cwds of non-ended sessions. Ended sessions are already excluded (archived change `scope-openspec-poll-to-active-cwds`), but running-but-unfocused sessions are not.
- A cold-boot `Promise.all` over `knownDirectories()` fires a `broadcastToAll` per dir at connect time (`session-bootstrap.ts:104-114`) — a concentrated burst exactly when a client is loading.

The existing gateway tests (`browser-gateway-broadcast-serialize-once.test.ts`) prove **correctness** (serialize-once, skip-when-buffer-full) but are **blind to timing**: the fake socket's `send` is a synchronous spy and `bufferedAmount` is a static `0`. The pipe is infinitely fast in test, so head-of-line blocking cannot be reproduced. We cannot currently answer "is the lag periodic (openspec) or continuous (upstream)?" without touching production.

This change adds a deterministic, virtual-clock load harness that models the WS send queue, reproduces the suspected head-of-line blocking, and asserts latency / wasted-bytes budgets. It turns the open hypothesis into a measurable, regression-gated fact — **without** changing any production code or guessing at fixes.

## What Changes

- **NEW** `packages/server/src/__tests__/helpers/draining-ws.ts` — a `DrainingFakeWs` that models a real socket: `send(frame)` increments `bufferedAmount` by frame byte length and records `{ t, bytes, type, cwd?, sessionId? }`; a virtual clock `advance(ms)` drains `bufferedAmount` at a configurable `drainRateBytesPerMs`. Exposes `timeToFlush(predicate)` — the virtual ms between a matching frame's enqueue and the moment cumulative drain clears it from the buffer. Preserves the existing `readyState`/`OPEN`/`bufferedAmount` surface so it is a drop-in for the current `makeFakeWs`.
- **NEW** `packages/server/src/__tests__/helpers/load-fixtures.ts` — builders: `seedSessions({ focusedCwd, idleCwds, perCwd })` populates a `MemorySessionManager`; `makeOpenSpecPayload(sizeBytes)` produces a synthetic `OpenSpecData` of a target serialized size; `attachClients(gateway, n, wsOpts)` wires N `DrainingFakeWs` through the real `wss.emit("connection", ...)` path and drains the bootstrap sends.
- **NEW** `packages/server/src/__tests__/browser-gateway-load.test.ts` — the scenario matrix (A–E below), each driving the **real** `createBrowserGateway` + real `broadcastToAll` / `broadcastOpenSpecUpdate` paths against draining sockets, asserting per-scenario budgets:
  - **target-message latency**: virtual ms from enqueue→flush of a live `event` for the focused session, measured while competing openspec traffic is in the buffer.
  - **wasted bytes**: total `openspec_update` bytes delivered to a socket for cwds it is not subscribed to / viewing.
  - **dropped frames**: count of sends skipped by the `bufferedAmount > MAX_WS_BUFFER` guard (data the client silently never receives).
  - **peak bufferedAmount** on the focused socket.
- **NEW** `docs/perf-ws-broadcast-load.md` — documents the harness, the drain-rate model, the scenario matrix, the metric definitions, and how to read a result as "periodic (openspec) vs continuous (upstream)". Caveman style, delegated to a docs subagent.

Scenario matrix (each × drainRate ∈ {FAST≈LAN, SLOW≈mobile/tunnel}):

| ID | Topology / workload | Probes |
|----|---------------------|--------|
| A | 1 focused session, no openspec traffic | baseline latency |
| B | 1 focused + N idle running sessions, each idle cwd fires `openspec_update` per poll tick | the core hypothesis |
| C | B + large openspec payload per cwd (many changes) | amplifier: payload size |
| D | cold-boot connect: `broadcastToAll` per known dir fires at connect | amplifier: connect storm |
| E | B with poll interval lowered 60 s → 10 s | amplifier: cadence |

## Impact

- **Test-only.** No production source files modified. The harness exercises existing exported APIs (`createBrowserGateway`, `broadcastToAll`, `broadcastOpenSpecUpdate`, `MemorySessionManager`, `MemoryEventStore`).
- Runs inside `npm test` (vitest), deterministic via virtual clock — no wall-clock sleeps, no live server, no flakiness.
- Produces the evidence needed to decide whether a follow-on change (subscription-scoped `openspec_update` fan-out) is warranted. That fix is explicitly **out of scope** here — this change only measures.

## Capabilities

### New Capabilities

- `ws-broadcast-load-harness` — a deterministic virtual-clock load harness for the browser WebSocket gateway that models send-queue drain, reproduces head-of-line blocking under multi-cwd `openspec_update` fan-out, and asserts target-message latency, wasted-bytes, dropped-frame, and peak-buffer budgets across a fixed scenario matrix.

### Modified Capabilities

None. The harness is additive and test-only.
