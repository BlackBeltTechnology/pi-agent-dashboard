/**
 * Tombstone regression tests for the retired `dispatch_extension_command`
 * message (test-plan F3, X4).
 *
 * The bridge dispatches extension slash commands in-process now, so the only
 * producer left is a bridge that was NOT reloaded after this server restarted.
 * The tombstone must answer with a TERMINAL `command_feedback` error that is
 * PERSISTED and BROADCAST — a broadcast-only terminal would re-create the
 * stuck "in progress" pill on browser reattach, which is exactly why the
 * deleted `dispatch-router.ts` stored before broadcasting.
 *
 * Harness: `browser-gateway-register-handler.test.ts` for the `wireEvents`
 * dependency stub, and the (now deleted) `dispatch-extension-command-router`
 * test for the `insertEvent` + `broadcastEvent` spy shape.
 *
 * See change: retire-slash-dispatch-via-expand-prompt-templates (design D4).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { wireEvents } from "../event-wiring.js";
import { createBrowserGateway } from "../pairing/browser-gateway.js";
import { createPendingForkRegistry } from "../pending/pending-fork-registry.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { makeFakeDirectoryService } from "./helpers/load-fixtures.js";

type TombstoneMsg = {
  type: "dispatch_extension_command";
  sessionId: string;
  command: string;
  requestId: string;
};

const TOMBSTONE_MESSAGE = "bridge outdated — reload the session";

function makeRig() {
  const sessionManager = createMemorySessionManager();
  const eventStore = createMemoryEventStore(() => false);
  const piGateway = {
    start: vi.fn(),
    stop: vi.fn(),
    sendToSession: vi.fn(),
    getConnectedSessionIds: vi.fn(() => []),
    onEvent: vi.fn(),
  } as any;
  const browserGateway = createBrowserGateway(sessionManager, eventStore, piGateway);

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

  // `wireEvents` ASSIGNED piGateway.onEvent; that is the bridge→server entry.
  const send = (msg: TombstoneMsg) => piGateway.onEvent!(msg.sessionId, msg as any);

  return { sessionManager, eventStore, piGateway, browserGateway, send };
}

describe("event-wiring: dispatch_extension_command tombstone", () => {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  afterEach(() => {
    warnSpy.mockClear();
  });

  it("F3: persists AND broadcasts a terminal command_feedback error, warns once, writes no keeper socket", () => {
    const { eventStore, browserGateway, send } = makeRig();
    const insertSpy = vi.spyOn(eventStore, "insertEvent");
    const broadcastSpy = vi.spyOn(browserGateway, "broadcastEvent");

    send({
      type: "dispatch_extension_command",
      sessionId: "S1",
      command: "/ctx-stats",
      requestId: "r1",
    });

    // Persisted exactly once with the terminal payload.
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const [sid, event] = insertSpy.mock.calls[0];
    expect(sid).toBe("S1");
    expect(event.eventType).toBe("command_feedback");
    expect(event.data).toEqual({
      command: "/ctx-stats",
      status: "error",
      message: TOMBSTONE_MESSAGE,
    });

    // Broadcast exactly once, with the STORED event (so reattach replays it).
    expect(broadcastSpy).toHaveBeenCalledTimes(1);
    const [bSid, seq, stored] = broadcastSpy.mock.calls[0];
    expect(bSid).toBe("S1");
    expect(seq).toBe(insertSpy.mock.results[0].value);
    expect(stored).toMatchObject({ eventType: "command_feedback" });

    // One warning naming the tombstone.
    const tombstoneWarns = warnSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.includes("[event-wiring] tombstone"));
    expect(tombstoneWarns).toHaveLength(1);
    expect(tombstoneWarns[0]).toContain("/ctx-stats");

    // No keeper socket write is even possible: the UDS write client is gone.
    const registry = (browserGateway as any).headlessPidRegistry;
    expect(registry).toBeTruthy();
    expect(typeof registry.writeRpc).toBe("undefined");
    expect(typeof registry.writeRpcToSockPath).toBe("undefined");
  });

  it("F3b: the terminal is replayable — it is readable back out of the store", () => {
    const { eventStore, send } = makeRig();
    const insertSpy = vi.spyOn(eventStore, "insertEvent");

    send({
      type: "dispatch_extension_command",
      sessionId: "S2",
      command: "/curator",
      requestId: "r2",
    });

    const seq = insertSpy.mock.results[0].value;
    const replayed = eventStore.getEvents("S2", seq);
    expect(replayed.map((e) => e.event)).toEqual([
      expect.objectContaining({
        eventType: "command_feedback",
        data: { command: "/curator", status: "error", message: TOMBSTONE_MESSAGE },
      }),
    ]);
  });

  it("X4: a throwing eventStore does not escape the handler and is logged", () => {
    const { eventStore, browserGateway, send } = makeRig();
    vi.spyOn(eventStore, "insertEvent").mockImplementation(() => {
      throw new Error("store exploded");
    });
    const broadcastSpy = vi.spyOn(browserGateway, "broadcastEvent");

    // A `void`-invoked throw here would surface as an unhandled rejection and
    // take the bridge WS handler down; the tombstone swallows it.
    expect(() =>
      send({
        type: "dispatch_extension_command",
        sessionId: "S3",
        command: "/ctx-stats",
        requestId: "r3",
      }),
    ).not.toThrow();

    // No seq ⇒ nothing safe to broadcast; the failure is logged instead.
    expect(broadcastSpy).not.toHaveBeenCalled();
    const failed = warnSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.includes("failed to persist command_feedback"));
    expect(failed).toHaveLength(1);
  });
});
