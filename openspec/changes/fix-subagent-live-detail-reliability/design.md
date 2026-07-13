## Context

The subagent inspector renders a live timeline from `session.subagents.get(agentId).entries[]`. That map is fed by two paths with very different durability:

- **Ephemeral live path** — the `pi-dashboard-subagents` extension emits `subagents:*` on the EventBus. `packages/extension/src/bridge.ts` monkey-patches `pi.events.emit` and forwards each frame via `connection.send({ type: "event_forward", ... })`. This is fire-and-forget over WS, gated on `sessionReady && isActive()`, throttled to ≤4/sec, and carries a **full snapshot** per tick (`entries` replaced wholesale). There are no sequence numbers and no replay.
- **Durable completed path** — `packages/client/src/lib/event-reducer.ts` (~§1632) backfills `next.subagents` from the `tool_execution_end` result of the `Agent` tool call (`toolName === "Agent"` + `details.agentId`). That event is part of the persisted parent message stream and is replayed by `state-replay.ts` on refresh/resume.

Result: completed subagents always resolve (durable backfill), but a *running* subagent depends entirely on live frames surviving the WS + gate. When a frame is dropped (backpressure, e.g. many concurrent subagents), gated (`sessionReady` false during reconnect/discovery/`/reload`), or lost across a bridge takeover, the live timeline goes empty or stale until the next tick — the observed "sometimes streams, sometimes not."

Two compounding defects: `readSubagentDetails` accepts `entries: []` and overwrites a populated list; and `AgentToolRenderer` opens detail with `window.open(popoutUrl, "_blank")` (a fullscreen route `SubagentPopoutPage`), which is janky/blocked on Electron/PWA/mobile — whereas `flow-agent-detail` already standardized on the `ui:dialog` primitive for the equivalent flow-agent surface.

## Goals / Non-Goals

**Goals:**
- Live running-subagent timeline is reconcilable: a transient gap self-heals instead of leaving the panel empty.
- The reducer never loses a populated timeline to an empty-array frame.
- Subagent detail opens in `ui:dialog`, at parity with `flow-agent-detail`.
- Fixes are dashboard-side (this repo) and require no change to the sibling extension to remove the intermittency.

**Non-Goals:**
- Persisting the full running-subagent timeline to disk (the completed-case backfill remains the durable source of truth after completion).
- Redesigning the extension's synchronous/foreground spawn model, adding background spawn, or steering (the tool-start entry + spawn timeout are coordinated in the sibling `pi-dashboard-subagents` repo and tracked separately).
- Changing the throttle rate or the full-snapshot-per-tick emission shape.

## Decisions

### D1 — Buffer-and-flush subagent frames across a not-ready window (bridge)

The `pi.events.emit` intercept currently drops frames when `!(sessionReady && isActive())`. Instead, when a `subagent_*`-mapped channel is emitted while not ready, push the frame into a bounded per-`agentId` pending buffer (keep latest snapshot per agent). On the next successful `session_start`/re-register, flush the buffer in order.

- **Why:** frames carry full snapshots, so keeping the latest per agent is sufficient and cheap; this closes the reconnect/`/reload`/discovery gap that produces most intermittency.
- **Alternative considered:** an ack/retransmit protocol per frame — rejected as heavyweight for full-snapshot data where "latest wins."

### D2 — Resync responder for running subagents (bridge + client)

Add a lightweight client→bridge request that asks for the latest retained `AgentDetails` snapshot of a running `agentId`; the bridge replies with a synthetic `subagent_started` `event_forward`. The client triggers it on reconnect and when opening detail for a running subagent whose `entries[]` is empty.

- **Why:** completes the recovery story for the case where the gap outlived the buffer (e.g. long disconnect) — the client can pull current state instead of waiting for the next throttled tick or completion.
- **Alternative considered:** client-only retry (re-render and hope for a fresh tick) — rejected: a wedged/slow subagent may not emit again for a long time.

### D3 — Empty-array overwrite guard (reducer)

In `readSubagentDetails` (and the `subagent_*` merge arms), only replace `entries` when the incoming array is non-empty; an incoming `[]` preserves existing entries.

- **Why:** the initial `subagent_started` and any late/reordered frame carry `entries: []`; today they clobber a populated timeline.
- **Trade-off:** a subagent that legitimately transitions to zero entries cannot be represented — acceptable, as entries only ever grow within a run.

### D4 — Subagent detail → `ui:dialog` (client)

Replace `AgentToolRenderer`'s `window.open` popout with the shell `ui:dialog` primitive (already reachable via `useUiPrimitive`, as `SubagentDetailView` demonstrates). Open the dialog `flush`/without a title (the view renders its own header); map `onBack` → close. Keep inline expand as-is. Retire the `window.open` route usage; the `SubagentPopoutClaim`/`SubagentPopoutPage` overlay-route may remain for deep-link URLs but is no longer the card's affordance.

- **Why:** parity with `flow-agent-detail`; fixes Electron/PWA/mobile popout breakage.
- **Alternative considered:** anchored `Popover` — explicitly rejected by `flow-agent-detail` ("No anchored popover for detail").

## Risks / Trade-offs

- [Bridge buffer grows unbounded during a long outage] → bound the buffer and keep only the latest snapshot per `agentId`; drop-oldest beyond the bound.
- [Flush-on-register races the reducer's completed-case backfill] → merges are commutative (mergeNonUndefined + non-empty-entries guard), so order does not matter.
- [Resync adds a new protocol message] → keep it minimal (request `{ agentId }`, reply reuses the existing `subagent_started` `event_forward` shape); a no-op for unknown/finished agents.
- [Dialog change touches a widely-used renderer] → covered by the existing `agent-tool-rendering` Playwright/inspector test cases; scope the diff to `CardControls` + the detail affordance.

## Migration Plan

Dashboard-side only; no data migration. Ship reducer guard (D3) and dialog (D4) first (self-contained, low-risk), then bridge buffering (D1) and resync (D2). Rollback = revert; the durable completed-case backfill is untouched, so completed subagents keep resolving regardless.

## Open Questions

- Does a cleanly *completed* subagent ever still render empty detail (a distinct second bug), or is every empty-detail report explained by the live-path gaps above? Resolve via a deterministic repro in the `systematic-debugging` task before wiring D2.
- Should the resync (D2) be omitted if D1's buffer-and-flush proves sufficient in practice? Gate D2 on evidence from the repro.
