/**
 * Fixtures for the status-reconcile debt register (a shed `session_updated` is
 * re-sent from CURRENT server state once the socket drains).
 *
 * These drive the REAL `createBrowserGateway` against a `DrainingWs` whose
 * `bufferedAmount` the test owns outright (`drainRateBytesPerMs: 0`), so
 * saturation and drain are exact rather than approximated by frame volume.
 * A tiny `maxWsBufferBytes` keeps the sheds cheap — the threshold predicate is
 * the same code path at 1 kB as at 4 MB.
 *
 * `DrainingWs.sent` records do not retain the raw frame, so `attachCapturedWs`
 * wraps `send` to keep the serialized strings: the reconcile's whole point is
 * WHICH values a frame carries, which a byte count cannot answer.
 *
 * See change: fix-backpressure-status-and-subagent-frames.
 */
import type { SessionUpdatedMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { WebSocket } from "ws";
import type { BrowserGateway } from "../../pairing/browser-gateway.js";
import { createBrowserGateway } from "../../pairing/browser-gateway.js";
import { createMemoryEventStore } from "../../persistence/memory-event-store.js";
import type { SessionManager } from "../../session/memory-session-manager.js";
import { createMemorySessionManager } from "../../session/memory-session-manager.js";
import type { DrainingWs } from "./draining-ws.js";
import { createDrainingWs } from "./draining-ws.js";
import { makeStubPiGateway } from "./load-fixtures.js";

/** The draining fake satisfies the gateway's `WebSocket` surface at runtime. */
export const asWs = (w: DrainingWs) => w as unknown as WebSocket;

/** Small threshold so a shed needs bytes, not megabytes. */
export const TEST_MAX_WS_BUFFER = 1000;

export interface DebtHarness {
  gateway: BrowserGateway;
  manager: SessionManager;
  /** The shed threshold this gateway was built with. */
  maxWsBuffer: number;
}

/**
 * A gateway with an explicit shed threshold, over a seeded manager.
 * Raise `maxWsBufferBytes` when a test must fit MANY reconcile sends under the
 * threshold in one flush — the fake never drains, so each send is cumulative.
 */
export function buildDebtGateway(sessionIds: string[] = [], maxWsBufferBytes = TEST_MAX_WS_BUFFER): DebtHarness {
  const manager = createMemorySessionManager();
  for (const id of sessionIds) manager.register({ id, cwd: "/repo/a", source: "tui" });
  const gateway = createBrowserGateway(
    manager,
    createMemoryEventStore(() => false),
    makeStubPiGateway(),
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    maxWsBufferBytes,
  );
  return { gateway, manager, maxWsBuffer: maxWsBufferBytes };
}

export interface CapturedWs {
  ws: DrainingWs;
  /** Every serialized frame the gateway handed to `ws.send`, in order. */
  frames: string[];
  /** Parsed `session_updated` frames only. */
  statusFrames(): SessionUpdatedMessage[];
  /** Saturate: park `bufferedAmount` above the shed threshold. */
  saturate(): void;
  /** Drain: park `bufferedAmount` at 0. */
  drain(): void;
}

/**
 * Connect a captured socket through the REAL connection handler and clear the
 * bootstrap frames, so any frame recorded afterwards is the one under test.
 */
export function attachCapturedWs(gateway: BrowserGateway, maxWsBuffer = TEST_MAX_WS_BUFFER): CapturedWs {
  const ws = createDrainingWs({ drainRateBytesPerMs: 0 });
  const frames: string[] = [];
  const originalSend = ws.send.bind(ws) as (...a: unknown[]) => void;
  ws.send = ((...args: unknown[]) => {
    frames.push(String(args[0]));
    // Forward EVERY argument: `sendState` passes an `onStateSent` completion
    // callback as the second one, and swallowing it disables callback-driven
    // re-flush. The interval masks that today; a future test would not see it.
    return originalSend(...args);
  }) as DrainingWs["send"];

  gateway.wss.emit("connection", ws, {});
  ws.bufferedAmount = 0;
  frames.length = 0; // discard the on-connect bootstrap

  return {
    ws,
    frames,
    statusFrames: () =>
      frames
        .map((f) => {
          try {
            return JSON.parse(f) as { type?: string };
          } catch {
            return undefined;
          }
        })
        .filter((m): m is SessionUpdatedMessage => m?.type === "session_updated"),
    saturate: () => {
      ws.bufferedAmount = maxWsBuffer + 1;
    },
    drain: () => {
      ws.bufferedAmount = 0;
    },
  };
}
