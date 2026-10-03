/**
 * Live server accumulation of non-message usage: tool-result `message_end`,
 * bridge-drained `usage_recorded`, and the replay invariant that keeps
 * register-time history replay from re-counting.
 *
 * Harness: the `wireEvents` rig from `event-wiring-push.test.ts`.
 * test-plan #E4 (live) #E5 #E6 #E18. See change: count-non-message-usage.
 */
import { replayEntriesAsEvents } from "@blackbelt-technology/pi-dashboard-shared/state-replay.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { wireEvents } from "../event-wiring.js";
import { createBrowserGateway } from "../pairing/browser-gateway.js";
import { createPendingForkRegistry } from "../pending/pending-fork-registry.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { makeFakeDirectoryService } from "./helpers/load-fixtures.js";

function makeRig() {
  const sessionManager = createMemorySessionManager();
  const eventStore = createMemoryEventStore(() => false);
  const piGateway = {
    start: vi.fn(),
    stop: vi.fn(),
    sendToSession: vi.fn(),
    getConnectedSessionIds: vi.fn(() => []),
    isSessionConnected: vi.fn(() => true),
    onEvent: vi.fn(),
  } as any;
  const browserGateway = createBrowserGateway(sessionManager, eventStore, piGateway);
  const broadcastEvent = vi.spyOn(browserGateway, "broadcastEvent");
  wireEvents({
    sessionManager,
    eventStore,
    piGateway,
    browserGateway,
    sessionOrderManager: {
      insert: vi.fn(),
      remove: vi.fn(),
      getOrder: vi.fn(() => []),
      reorder: vi.fn(),
      getAllOrders: vi.fn(() => ({})),
      moveToFront: vi.fn(),
      rekey: vi.fn(),
    } as any,
    preferencesStore: {
      getPinnedDirectories: () => [],
      setPinnedDirectories: () => {},
      getSessionOrder: () => ({}),
      setSessionOrder: () => {},
      getAutoNameSessions: () => false,
    } as any,
    pendingForkRegistry: createPendingForkRegistry(),
    directoryService: makeFakeDirectoryService().service,
    knownSessionIds: new Set<string>(),
    pendingDashboardSpawns: new Map<string, number>(),
  });

  const send = (sessionId: string, msg: Record<string, unknown>) =>
    piGateway.onEvent!(sessionId, { sessionId, ...msg } as any);
  const event = (sessionId: string, eventType: string, data: Record<string, unknown> = {}) =>
    send(sessionId, { type: "event_forward", event: { eventType, timestamp: Date.now(), data } });
  const register = (sessionId: string, live = true) => {
    sessionManager.register({ id: sessionId, cwd: "/tmp/proj", source: "cli", startedAt: 1 } as any);
    send(sessionId, { type: "session_register", cwd: "/tmp/proj", source: "cli" });
    if (live) send(sessionId, { type: "replay_complete" });
  };
  const statsEvents = (sessionId: string) =>
    eventStore.getEvents(sessionId, 0).filter((e) => e.event.eventType === "stats_update").map((e) => e.event);
  const totals = (sessionId: string) => {
    const s = sessionManager.get(sessionId)!;
    return { tokensIn: s.tokensIn, tokensOut: s.tokensOut, cacheRead: s.cacheRead ?? 0, cacheWrite: s.cacheWrite ?? 0, cost: s.cost };
  };
  return { sessionManager, eventStore, broadcastEvent, send, event, register, statsEvents, totals };
}

const usage = (u: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: number }) => ({
  input: u.input ?? 0,
  output: u.output ?? 0,
  cacheRead: u.cacheRead ?? 0,
  cacheWrite: u.cacheWrite ?? 0,
  totalTokens: (u.input ?? 0) + (u.output ?? 0),
  cost: { total: u.cost ?? 0 },
});

afterEach(() => vi.restoreAllMocks());

describe("live non-message usage accumulation", () => {
  it("#E4 tool-result usage counted exactly once (message_end, not turn_end.toolResults)", () => {
    const r = makeRig();
    r.register("s1");
    const toolResult = { role: "toolResult", toolCallId: "t1", toolName: "classify", content: [], usage: usage({ input: 300 }) };
    r.event("s1", "message_end", { message: toolResult });
    r.event("s1", "turn_end", {
      message: { role: "assistant", content: [], usage: usage({ input: 0 }) },
      toolResults: [toolResult],
    });
    expect(r.totals("s1").tokensIn).toBe(300);
    const tool = r.statsEvents("s1").filter((e) => e.data.usageKind === "tool");
    expect(tool).toHaveLength(1);
    expect(tool[0].data.turnUsage).toMatchObject({ input: 300 });
    expect(tool[0].data).not.toHaveProperty("contextUsage");
  });

  it("#E5 assistant message_end is not counted; turn_end is the only source", () => {
    const r = makeRig();
    r.register("s1");
    const assistant = { role: "assistant", content: [], usage: usage({ input: 1000 }) };
    r.event("s1", "message_end", { message: assistant });
    r.event("s1", "turn_end", { message: assistant });
    expect(r.totals("s1").tokensIn).toBe(1000);
    const stats = r.statsEvents("s1");
    expect(stats).toHaveLength(1);
    expect(stats[0].data).not.toHaveProperty("usageKind");
  });

  it("#E6 usage_recorded accumulates all totals and stores + broadcasts a kind-marked stats_update", () => {
    const r = makeRig();
    r.register("s1");
    r.send("s1", { type: "usage_recorded", kind: "usage:cache_warm", provider: "anthropic", model: "m", usage: usage({ cacheRead: 50000, cost: 0.015 }) });
    expect(r.totals("s1").cacheRead).toBe(50000);
    expect(r.totals("s1").cost).toBeCloseTo(0.015, 10);
    const stats = r.statsEvents("s1");
    expect(stats).toHaveLength(1);
    expect(stats[0].data.usageKind).toBe("usage:cache_warm");
    expect(stats[0].data.turnUsage).toMatchObject({ cacheRead: 50000 });
    expect(stats[0].data).not.toHaveProperty("contextUsage");
    const broadcastStats = r.broadcastEvent.mock.calls.filter((c) => (c[2] as any)?.eventType === "stats_update");
    expect(broadcastStats).toHaveLength(1);
    expect((broadcastStats[0][2] as any).data.usageKind).toBe("usage:cache_warm");
  });

  it("every token field of a compaction usage_recorded accumulates", () => {
    const r = makeRig();
    r.register("s1");
    r.send("s1", { type: "usage_recorded", kind: "compaction", usage: usage({ input: 40000, output: 900, cacheWrite: 5, cost: 0.12 }) });
    expect(r.totals("s1")).toMatchObject({ tokensIn: 40000, tokensOut: 900, cacheWrite: 5 });
    expect(r.totals("s1").cost).toBeCloseTo(0.12, 10);
  });

  it("untrusted usage_recorded / tool-result usage: negative or non-finite values never lower totals", () => {
    const r = makeRig();
    r.register("s1");
    r.send("s1", { type: "usage_recorded", kind: "compaction", usage: usage({ input: 100, cost: 0.5 }) });
    r.send("s1", {
      type: "usage_recorded",
      kind: "usage:evil",
      usage: { input: -100, output: -1, cacheRead: -5, cacheWrite: Number.POSITIVE_INFINITY, cost: { total: -0.5 } },
    });
    r.event("s1", "message_end", {
      message: { role: "toolResult", toolCallId: "t", content: [], usage: { input: -7, cost: { total: -1 } } },
    });
    expect(r.totals("s1")).toEqual({ tokensIn: 100, tokensOut: 0, cacheRead: 0, cacheWrite: 0, cost: 0.5 });
  });

  it("#E18 register-time replay adds no usage (no tool-result message_end in replay)", () => {
    const r = makeRig();
    const history = [
      { type: "message", id: "u1", message: { role: "user", content: "go" } },
      { type: "message", id: "a1", message: { role: "assistant", content: [{ type: "toolCall", id: "t1", name: "classify", arguments: {} }], usage: usage({ input: 10 }) } },
      { type: "message", id: "r1", message: { role: "toolResult", toolCallId: "t1", toolName: "classify", content: [], usage: usage({ input: 300 }) } },
      { type: "usage", id: "w1", kind: "cache_warm", provider: "p", model: "m", usage: usage({ cacheRead: 50000, cost: 0.015 }) },
    ];
    const replay = replayEntriesAsEvents("s1", history);
    const types = replay.map((m) => m.event.eventType);
    expect(types).toContain("tool_execution_end");
    expect(
      replay.some((m) => m.event.eventType === "message_end" && (m.event.data as any).message?.role === "toolResult"),
    ).toBe(false);

    r.register("s1", false); // replay window open
    for (const m of replay) r.send("s1", m as any);
    r.send("s1", { type: "replay_complete" });
    expect(r.totals("s1")).toEqual({ tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
  });
});
