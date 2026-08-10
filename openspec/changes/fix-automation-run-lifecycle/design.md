## Context

See proposal.md — Why. Design-relevant facts, all established by execution against a live container (dashboard source at `/app/pi-agent-dashboard`, flow `invoicebot:process`, automation `invoicebot-intake`):

- Host topology: pi's extension loader builds a **per-extension** event surface. In pi 0.84.1 it is literally `events: { emit(channel,data){ eventBus.emit(...) }, on(channel,handler){ ... } }` (`pi-coding-agent/dist/core/extensions/loader.js` ≈ 206/332-342). Therefore `pi.events.emit = wrapper` inside `packages/extension/src/bridge.ts` (≈1815-1839) mutates **only the bridge's own** surface.
- Measured proof: with probes at the intercept site, a real automation run logged `INSTALL wrapper`, `WRAP flow:list-flows`, `WRAP flow:run`, and **`BUS-ON flow:complete`** (the bridge's own `pi.events.on("flow:complete")` listener fired) but **never `WRAP flow:complete`**. The session JSONL recorded `flow_complete "success"` at the same instant. So `on()` sees foreign emissions; the patched `emit` does not.
- Server side is already correct: a throwaway integration test booting the real `registerPlugin` with the real `flowsActionContributions`, firing through the real run path, and pushing one forwarded `{eventType:"flow_complete"}` into the real `ctx.onEvent` drove `run.json` to `status:"done"`. `runCompletion`/`summarize`/`onSessionEnded` all work. Delivery is the sole break.
- `EventBus` (`dist/core/event-bus.js`) is a thin `node:events` wrapper: `emit`, `on(channel, handler) => unsubscribe`, `clear`. **No wildcard channel.**
- Bridge self-emits (`flow:run`, `flow:list-flows`, `roles:*`) are today forwarded via the wrapper. Any replacement must keep forwarding them — exactly once.

## Goals / Non-Goals

**Goals:**
- Foreign-extension flow/subagent events reach the server live, on a mechanism that cannot silently observe only our own emissions.
- One code path for all emitters (no self-emit special case), so a future channel cannot be half-wired.
- Preserve the existing gating semantics: not-ready → drop (non-subagent) / buffer (subagent frames), and never let forwarding failure affect emission delivery.
- Prove the fix by observed run state (`status: "done"`), not by unit assertions alone.

**Non-Goals:**
- No change to the server, client, or wire protocol; `event_forward` shape is untouched.
- No change to pi core-event (`pi.on(...)`) subscriptions — that path always worked.
- No attempt to reinstate a true wildcard catch-all (host offers none).
- No redesign of automation finalization, the reaper, or run-store persistence.
- Not fixing the persisted-flow-event replay path (`packages/shared/src/state-replay.ts`); it stays as the cold-hydration mechanism.

## Decisions

**D1 — Forward from per-channel `pi.events.on` subscriptions; delete the emit monkey-patch.**
`on()` is proven to receive foreign emissions (`BUS-ON`). The subscription handler does exactly what `sendEventForward(channel, data)` does today, so the rename map, gating, and message shape are unchanged.
*Alternatives:* (a) keep the patch and additionally subscribe — rejected: double-forwards our own emits and leaves a dead, misleading mechanism in place; (b) ask the host for a wildcard subscription — rejected: an upstream pi change we cannot land here and cannot ship against installed versions (0.80.x/0.84.x both lack it); (c) have pi-flows push events to the dashboard itself — rejected: inverts the dependency and would need the same treatment per extension.

**D2 — Derive the subscription list from `EVENT_BUS_MAP`, not a hand-written list.**
Iterate the map's keys so "mapped but unsubscribed" becomes structurally impossible; keep the mapping as the single declaration point. A channel needing forwarding without a rename is declared with an identity entry. A test asserts subscription coverage over the map.
*Alternative:* a second `FORWARDED_CHANNELS` array — rejected: two lists drift, which is precisely the class of bug being fixed.

**D3 — Drop the wildcard "unknown channel forwarded by its channel name" behaviour, deliberately.**
It is unimplementable without emit interception, and it was already inert for every emitter except the bridge itself, so nothing that works today regresses. The spec delta records the removal with a migration (declare the channel).

**D4 — Subscribe once per bridge instance, at wiring time, before `sessionReady`.**
The existing `sessionReady && isActive()` guard inside the handler keeps premature events out, and subscriptions established early avoid a race where a fast flow completes before wiring. Duplicate-subscription risk is handled by subscribing exactly once per bridge instance and releasing the returned unsubscribers on teardown/supersede — replacing today's `pi.events.emit = origEventsEmit` restore, which must go away (there is nothing to restore).

**D5 — Home the subscription loop in `flow-event-wiring.ts`, injected with the bridge's `sendEventForward` + gating.**
That module already owns pi-flows/subagent channel knowledge (`FLOW_EVENT_MAP`, `SUBAGENT_EVENT_MAP`) and already registers `pi.events.on` listeners; its comment currently defers to the broken intercept. `bridge.ts` keeps ownership of `sendEventForward`, `sessionReady`, `isActive`, and the subagent frame buffer.

**D6 — Subagent frames keep their buffer/flush semantics on the new path.**
`SubagentFrameBuffer.isSubagentChannel(channel)` branching moves verbatim into the shared handler; `connection.isConnected` gating and the reconnect flush are unchanged. Because this path has never actually run for foreign emitters, its behaviour under the new mechanism is **verified by execution**, not assumed (task 6).

**D7 — Two-layer, test-first verification; the mirror test is deleted, not adapted.**
Layer A (extension): construct ONE `node:events` emitter and TWO independent `{emit,on}` facades over it — pi's real topology — hand facade **A** to the production wiring and emit `flow:complete` through facade **B**; assert a real `event_forward{eventType:"flow_complete"}` reached a fake connection. This is not a mirror: it imports and runs production wiring, and the event originates from a *foreign* facade, i.e. the exact failing link. It fails against today's monkey-patch. Layer B (server): boot the real `registerPlugin` with the real flows contribution, fire through the real run path, push a forwarded `flow_complete`, assert on-disk `run.json.status === "done"` — assertions on production-produced state, nothing re-implemented. `packages/automation-plugin/src/__tests__/finalize-event-dispatched.test.ts` is **deleted**; its four cases become Layer-B cases.

**D8 — Add a one-line diagnostic for the finalize path taken.**
The failure was invisible for 101 runs because a delivery outage looks like independent timeouts. Log which path finalized a run (completion event / `agent_end` / session death / reaper) so the systematic case is greppable.

## Risks / Trade-offs

- **Losing the wildcard breaks an unknown third-party channel** → It was already inert for foreign extensions (proven), so only bridge-self-emitted undeclared channels could regress; those are in-repo and enumerable. Migration is one map entry, recorded in the spec delta.
- **Double-forwarding the bridge's own emits** (self-emit now arrives via the subscription too) → single handler, no separate self path; Layer-A test asserts exactly one `event_forward` per emission.
- **A channel emitted before wiring is lost** → subscribe at wiring time (D4), earlier than the current patch's effective window; the not-ready guard, not subscription timing, governs drops.
- **Subagent live-detail regression** → D6 keeps the branch verbatim and task 6 verifies by running a real subagent, since no execution evidence exists for that path today.
- **`pi.events.on` handlers are wrapped in an async `safeHandler` by the host** (errors logged, not thrown) → forwarding failures can no longer break an emitter, which is the desired contract; but a thrown error is now swallowed by the host, so the handler must log its own failure rather than rely on propagation.
- **Ordering vs the old path**: the old wrapper forwarded *before* the original emit; the new one forwards from a listener, i.e. interleaved with other subscribers → no consumer depends on bridge-forward-first, and forwarding is asynchronous over a WebSocket regardless.
- **Fix verified against one pi line** → verify against the pi the dashboard actually resolves (bare-import, 0.84.1 in the container) and note that 0.80.x behaved identically in the measurement.

## Migration Plan

1. Land the extension change; no persisted data, config, or protocol migration is involved.
2. Reload connected sessions (`npm run reload`) — extension-only change; already-running sessions must be reloaded to pick up the new wiring.
3. Verify end-to-end: fire an automation with a `flows.run` action and observe `run.json` reach `status: "done"` in seconds, with no `run exceeded max age`.
4. Rollback: revert the extension commit and reload; the reaper backstop keeps schedules unwedged in the meantime (the pre-fix behaviour).
5. Historical runs already reaped to `error` are left as-is — no back-fill.
