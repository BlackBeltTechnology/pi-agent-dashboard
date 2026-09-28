/**
 * The unread-trigger site (`stampUnreadIfTriggered`) is the single push hook:
 * it calls `pushDispatcher.fanout(sessionId, {eventType, after, payload,
 * unreadEdge})` on every qualifying live trigger for a known session.
 *
 * Harness: the `wireEvents` dependency stub from
 * `event-wiring-dispatch-tombstone.test.ts`; trigger semantics per
 * `unread-trigger-wiring.test.ts`.
 * See change: add-server-push-notifications (test-plan #E1–#E8, #P1).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { wireEvents } from "../event-wiring.js";
import { createBrowserGateway } from "../pairing/browser-gateway.js";
import { createPendingForkRegistry } from "../pending/pending-fork-registry.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import type { PushDispatcher } from "../push/push-dispatcher.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { makeFakeDirectoryService } from "./helpers/load-fixtures.js";

type FanoutCall = Parameters<PushDispatcher["fanout"]>;

function makeRig(opts: { withPush?: boolean; withTracker?: boolean; pushDispatcher?: PushDispatcher } = {}) {
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
  const fanoutCalls: FanoutCall[] = [];
  const pushDispatcher: PushDispatcher =
    opts.pushDispatcher ??
    ({
      fanout: vi.fn((...args: FanoutCall) => {
        fanoutCalls.push(args);
      }),
      test: vi.fn(async () => []),
      shutdown: vi.fn(),
    } as PushDispatcher);

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
    ...(opts.withTracker === false ? {} : { viewedSessionTracker: browserGateway.viewedSessionTracker }),
    ...(opts.withPush === false ? {} : { pushDispatcher }),
  });

  const send = (sessionId: string, msg: Record<string, unknown>) =>
    piGateway.onEvent!(sessionId, { sessionId, ...msg } as any);
  const event = (sessionId: string, eventType: string, data: Record<string, unknown> = {}) =>
    send(sessionId, { type: "event_forward", event: { eventType, timestamp: Date.now(), data } });
  // pi-gateway registers the session record, then forwards `session_register`
  // (which opens the replay window) to the wiring.
  const register = (sessionId: string, live = true) => {
    sessionManager.register({ id: sessionId, cwd: "/tmp/proj", source: "cli", startedAt: 1 } as any);
    send(sessionId, { type: "session_register", cwd: "/tmp/proj", source: "cli" });
    if (live) send(sessionId, { type: "replay_complete" });
  };

  return { sessionManager, browserGateway, fanoutCalls, pushDispatcher, send, event, register };
}

describe("event-wiring → push fan-out", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("read session, no viewer, live crash → unread true + one fanout with unreadEdge:true (test-plan #E1)", () => {
    const { sessionManager, fanoutCalls, event, register } = makeRig();
    register("s1");
    expect(sessionManager.get("s1")?.unread).toBeFalsy();
    event("s1", "agent_end", { error: "boom" });
    expect(sessionManager.get("s1")?.unread).toBe(true);
    expect(fanoutCalls).toHaveLength(1);
    const [sid, ctx] = fanoutCalls[0];
    expect(sid).toBe("s1");
    expect(ctx.unreadEdge).toBe(true);
    expect(ctx.eventType).toBe("agent_end");
    expect(ctx.payload).toEqual({ error: "boom" });
  });

  it("already-unread session → no unread broadcast, one fanout with unreadEdge:false (test-plan #E2)", () => {
    const { sessionManager, browserGateway, fanoutCalls, event, register } = makeRig();
    register("s2");
    sessionManager.update("s2", { unread: true });
    event("s2", "agent_start");
    const broadcast = vi.spyOn(browserGateway, "broadcastSessionUpdated");
    event("s2", "agent_end"); // streaming → idle
    const unreadBroadcasts = broadcast.mock.calls.filter((c) => (c[1] as any)?.unread !== undefined);
    expect(unreadBroadcasts).toHaveLength(0);
    expect(fanoutCalls).toHaveLength(1);
    expect(fanoutCalls[0][1].unreadEdge).toBe(false);
    expect(fanoutCalls[0][1].after.status).toBe("idle");
  });

  it("viewed session → no fanout, unread stays false (test-plan #E3)", () => {
    const { sessionManager, browserGateway, fanoutCalls, event, register } = makeRig();
    register("s3");
    browserGateway.viewedSessionTracker.view("s3", {} as any);
    event("s3", "tool_execution_start", { toolName: "ask_user" });
    expect(fanoutCalls).toHaveLength(0);
    expect(sessionManager.get("s3")?.unread).toBeFalsy();
  });

  // Test-plan #E4 anticipated TWO fanout calls (one per caller). Measured: the
  // second caller sees `before.currentTool === "ask_user"` already, so
  // `isUnreadTrigger` is false and it never reaches `fanout` — in either order.
  // Asserted here as the stronger invariant: exactly one call, carrying the
  // edge and `after.currentTool === "ask_user"`, so a webhook is never pushed
  // twice for one question even without coalescing.
  it("one ask_user edge via event_forward AND prompt_request → exactly one unreadEdge:true fanout (test-plan #E4)", () => {
    // event_forward first, then the prompt_request for the same question.
    const a = makeRig();
    a.register("s4");
    a.event("s4", "tool_execution_start", { toolName: "ask_user" });
    a.send("s4", { type: "prompt_request", promptId: "p1", prompt: { type: "input", question: "?" } });
    expect(a.fanoutCalls.filter((c) => c[1].unreadEdge === true)).toHaveLength(1);
    expect(a.fanoutCalls).toHaveLength(1);
    expect(a.fanoutCalls.every((c) => c[1].after.currentTool === "ask_user")).toBe(true);

    // prompt_request first (no payload), then the event_forward.
    const b = makeRig();
    b.register("s4b");
    b.send("s4b", { type: "prompt_request", promptId: "p2", prompt: { type: "input", question: "?" } });
    b.event("s4b", "tool_execution_start", { toolName: "ask_user" });
    expect(b.fanoutCalls.filter((c) => c[1].unreadEdge === true)).toHaveLength(1);
    expect(b.fanoutCalls).toHaveLength(1);
    const promptCall = b.fanoutCalls.find((c) => c[1].eventType === "prompt_request");
    expect(promptCall).toBeDefined();
    expect(promptCall![1].after.currentTool).toBe("ask_user");
    expect(promptCall![1].payload).toBeUndefined();
  });

  it("replayed crash → no fanout, unread unchanged (test-plan #E5)", () => {
    const { sessionManager, fanoutCalls, event, register } = makeRig();
    register("s5", false); // no replay_complete yet
    event("s5", "agent_start");
    event("s5", "agent_end", { error: "boom" });
    expect(fanoutCalls).toHaveLength(0);
    expect(sessionManager.get("s5")?.unread).toBeFalsy();
  });

  it("unknown session → no fanout (test-plan #E6)", () => {
    const { fanoutCalls, event } = makeRig();
    event("ghost", "agent_end", { error: "boom" });
    expect(fanoutCalls).toHaveLength(0);
  });

  it("no pushDispatcher → unread set as before, nothing logged (test-plan #E7)", () => {
    const errorSpy = vi.spyOn(console, "error");
    const warnSpy = vi.spyOn(console, "warn");
    const { sessionManager, event, register } = makeRig({ withPush: false });
    register("s7");
    event("s7", "agent_end", { error: "boom" });
    expect(sessionManager.get("s7")?.unread).toBe(true);
    const pushLogs = [...errorSpy.mock.calls, ...warnSpy.mock.calls].filter((c) => /push|dispatcher/i.test(String(c[0])));
    expect(pushLogs).toHaveLength(0);
  });

  it("hanging transports do not delay the session_updated broadcast (test-plan #P1)", async () => {
    const { createPushDispatcher } = await import("../push/push-dispatcher.js");
    const { createPushTokenRegistry } = await import("../push/push-token-registry.js");
    const os = await import("node:os");
    const path = await import("node:path");
    const fs = await import("node:fs");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "push-p1-"));

    function run(withPush: boolean): number[] {
      let pushDispatcher: PushDispatcher | undefined;
      if (withPush) {
        const registry = createPushTokenRegistry({ path: path.join(dir, `tokens-${Math.random()}.json`) });
        for (let i = 0; i < 50; i++) registry.add({ deviceToken: `https://h${i}.example/x`, transport: "webhook" });
        pushDispatcher = createPushDispatcher({
          registry,
          transports: { webhook: { kind: "webhook", send: () => new Promise(() => {}) } },
          coalesceWindowMs: 5_000,
          getSession: () => undefined,
          logger: { info() {}, warn() {}, error() {} },
        });
      }
      const rig = makeRig({ withPush, pushDispatcher });
      const latencies: number[] = [];
      let sentAt = 0;
      const orig = rig.browserGateway.broadcastSessionUpdated.bind(rig.browserGateway);
      vi.spyOn(rig.browserGateway, "broadcastSessionUpdated").mockImplementation((id: string, u: any) => {
        if (u?.unread === true) latencies.push(performance.now() - sentAt);
        return orig(id, u);
      });
      for (let i = 0; i < 200; i++) {
        const sid = `p1-${withPush}-${i}`;
        rig.register(sid);
        rig.event(sid, "agent_start");
        sentAt = performance.now();
        rig.event(sid, "agent_end");
      }
      return latencies.sort((x, y) => x - y);
    }

    const p95 = (xs: number[]) => xs[Math.floor(xs.length * 0.95)];
    const base = run(false);
    const withPush = run(true);
    expect(base).toHaveLength(200);
    expect(withPush).toHaveLength(200);
    expect(p95(withPush) - p95(base)).toBeLessThan(10);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("server.ts pairs pushDispatcher with viewedSessionTracker (test-plan #E8)", () => {
  afterEach(() => {
    vi.doUnmock("../event-wiring.js");
    vi.resetModules();
  });

  it("createServer with push.enabled passes both deps to wireEvents", async () => {
    vi.resetModules();
    const seen: Array<Record<string, unknown>> = [];
    vi.doMock("../event-wiring.js", async (importOriginal) => {
      const mod = await importOriginal<typeof import("../event-wiring.js")>();
      return {
        ...mod,
        wireEvents: (deps: any) => {
          seen.push(deps);
          return mod.wireEvents(deps);
        },
      };
    });
    const { createTestServer } = await import("../test-support/test-server.js");
    const handle = await createTestServer({ push: { enabled: true, coalesceWindowMs: 30_000 } });
    try {
      expect(seen).toHaveLength(1);
      expect(seen[0].pushDispatcher).toBeDefined();
      expect(typeof (seen[0].pushDispatcher as PushDispatcher).fanout).toBe("function");
      expect(seen[0].viewedSessionTracker).toBeDefined();
    } finally {
      await handle.stop();
    }
  });

  it("createServer without push passes no dispatcher", async () => {
    vi.resetModules();
    const seen: Array<Record<string, unknown>> = [];
    vi.doMock("../event-wiring.js", async (importOriginal) => {
      const mod = await importOriginal<typeof import("../event-wiring.js")>();
      return { ...mod, wireEvents: (deps: any) => { seen.push(deps); return mod.wireEvents(deps); } };
    });
    const { createTestServer } = await import("../test-support/test-server.js");
    const handle = await createTestServer();
    try {
      expect(seen[0].pushDispatcher).toBeUndefined();
    } finally {
      await handle.stop();
    }
  });
});
