/**
 * #X2 (subagent-live-detail-reliability: resync removed): an old client that
 * still sends `subagent_resync_request` gets no reply, no error, and keeps its
 * connection; nothing is forwarded to the bridge.
 * Rig mirrors browser-gateway-critical-frames.test.ts.
 * See change: move-subagents-to-plugin (D6).
 */
import { describe, expect, it } from "vitest";
import { createDrainingWs } from "./helpers/draining-ws.js";
import { buildLoadGatewayEx, flushAsync, seedReplayEvents, seedSessions } from "./helpers/load-fixtures.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";

describe("incoming subagent_resync_request is a no-op (#X2)", () => {
  it("sends no reply or error frame and leaves the socket open", async () => {
    const seed = seedSessions({ focusedCwd: "/repo/a", idleCwds: [] });
    const store = createMemoryEventStore(() => false);
    seedReplayEvents(store, seed.focusedSessionId, 1, 16);
    const { gateway } = buildLoadGatewayEx(seed.manager, { eventStore: store });
    const ws = createDrainingWs({ drainRateBytesPerMs: 1 });
    gateway.wss.emit("connection", ws, {});
    ws.drainFully(); // clear the on-connect bootstrap frames
    const before = ws.sent.length;

    ws.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "subagent_resync_request",
          sessionId: seed.focusedSessionId,
          agentId: "a1",
          requestId: "r1",
          reason: "open",
        }),
      ),
    );
    await flushAsync(20);

    expect(ws.sent.slice(before)).toEqual([]);
    expect(ws.readyState).toBe(1);
    expect(ws.terminatedCount()).toBe(0);
  });
});
