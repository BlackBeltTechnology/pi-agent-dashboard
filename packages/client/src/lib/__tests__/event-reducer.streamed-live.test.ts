/**
 * Provenance flag on `thinking` messages.
 *
 * change: reasoning-auto-collapse-timer
 *
 * A thinking message is marked `streamedLive:true` only when reduced via the
 * live path (`reduceEvent(..., { isLive: true })`). The replay path (omitting
 * opts, or passing `isLive:false`) leaves it falsy, so cold-loaded / replayed
 * reasoning never arms the auto-collapse timer.
 */

import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { createInitialState, reduceEvent, type SessionState } from "../chat/event-reducer.js";

function thinkingEvents(): DashboardEvent[] {
  let ts = 1000;
  const next = () => (ts += 100);
  const mk = (type: string, extra: Record<string, unknown> = {}): DashboardEvent => ({
    eventType: "message_update",
    timestamp: next(),
    data: { assistantMessageEvent: { type, ...extra } },
  });
  return [mk("thinking_start"), mk("thinking_delta", { delta: "pondering…" }), mk("thinking_end")];
}

function reduceAll(events: DashboardEvent[], opts?: { isLive?: boolean }): SessionState {
  let s = createInitialState();
  for (const e of events) s = reduceEvent(s, e, opts);
  return s;
}

describe("thinking provenance (streamedLive)", () => {
  it("sets streamedLive:true on the live path", () => {
    const s = reduceAll(thinkingEvents(), { isLive: true });
    const thinking = s.messages.filter((m) => m.role === "thinking");
    expect(thinking).toHaveLength(1);
    expect(thinking[0].streamedLive).toBe(true);
  });

  it("leaves streamedLive falsy on the replay path (opts omitted)", () => {
    const s = reduceAll(thinkingEvents());
    const thinking = s.messages.filter((m) => m.role === "thinking");
    expect(thinking).toHaveLength(1);
    expect(thinking[0].streamedLive).toBeFalsy();
  });

  it("leaves streamedLive falsy when isLive:false", () => {
    const s = reduceAll(thinkingEvents(), { isLive: false });
    expect(s.messages.find((m) => m.role === "thinking")?.streamedLive).toBeFalsy();
  });

  it("re-replay of a historical thinking block keeps streamedLive falsy (idempotency)", () => {
    const events = thinkingEvents();
    let s = reduceAll(events); // replay
    // Re-replay the same batch on top (reconnect delta without reset).
    for (const e of events) s = reduceEvent(s, e);
    const thinking = s.messages.filter((m) => m.role === "thinking");
    for (const m of thinking) expect(m.streamedLive).toBeFalsy();
  });

  it("streamingThinkingCollapsed forces streamedLive:false even on the live path", () => {
    const [start, delta, end] = thinkingEvents();
    let s = createInitialState();
    s = reduceEvent(s, start, { isLive: true });
    s = reduceEvent(s, delta, { isLive: true });
    // User collapsed the streaming block mid-stream.
    s = { ...s, streamingThinkingCollapsed: true };
    s = reduceEvent(s, end, { isLive: true });
    const thinking = s.messages.find((m) => m.role === "thinking");
    expect(thinking?.streamedLive).toBe(false);
    // Flag reset after flush.
    expect(s.streamingThinkingCollapsed).toBe(false);
  });
});
