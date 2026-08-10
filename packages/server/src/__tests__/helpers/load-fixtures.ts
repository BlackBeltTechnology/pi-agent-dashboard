/**
 * Builders for the browser-gateway broadcast load harness. These wire the
 * REAL `createBrowserGateway` against `DrainingFakeWs` sockets — no fan-out
 * logic is reimplemented here.
 *
 * See change: add-ws-broadcast-load-harness.
 */
import { vi } from "vitest";
import type { OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { createMemorySessionManager } from "../../session/memory-session-manager.js";
import { createMemoryEventStore } from "../../persistence/memory-event-store.js";
import { createBrowserGateway } from "../../pairing/browser-gateway.js";
import type { BrowserGateway } from "../../pairing/browser-gateway.js";
import type { SessionManager } from "../../session/memory-session-manager.js";
import type { PiGateway } from "../../pi/pi-gateway.js";
import { createDrainingWs } from "./draining-ws.js";
import type { DrainingWs, DrainingWsOpts } from "./draining-ws.js";

/**
 * Named drain-rate presets. ILLUSTRATIVE, NOT CALIBRATED to a real link.
 * They exist to prove RELATIVE effects (B worse than A; C/D/E worsen B)
 * deterministically — never to claim absolute ms latency on any network.
 */
export const DRAIN_FAST = 50_000; // ~50 MB/s, illustrative LAN
export const DRAIN_SLOW = 500; //    ~0.5 MB/s, illustrative mobile/tunnel

export function makeStubPiGateway(): PiGateway {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    sendToSession: vi.fn(),
    getConnectedSessionIds: vi.fn(() => []),
    hasSession: vi.fn(() => false),
    onEvent: vi.fn(),
  } as unknown as PiGateway;
}

export function buildLoadGateway(manager: SessionManager): BrowserGateway {
  return createBrowserGateway(
    manager,
    createMemoryEventStore(() => false),
    makeStubPiGateway(),
  );
}

export interface SeedSpec {
  /** cwd of the one focused/viewed session. */
  focusedCwd: string;
  /** cwds of idle (running but unfocused) sessions that will fire openspec_update. */
  idleCwds: string[];
  /** sessions registered per cwd (focused cwd also gets `perCwd`; first is the focused one). */
  perCwd?: number;
}

export interface SeededSessions {
  manager: SessionManager;
  /** The session the focused socket subscribes to. */
  focusedSessionId: string;
  focusedCwd: string;
  /** All idle cwds and their session ids. */
  idle: { cwd: string; sessionIds: string[] }[];
}

/** Populate a `MemorySessionManager` with running sessions across cwds. */
export function seedSessions(spec: SeedSpec): SeededSessions {
  const manager = createMemorySessionManager();
  const perCwd = spec.perCwd ?? 1;
  let counter = 0;
  const reg = (cwd: string): string => {
    const id = `sess-${counter++}`;
    manager.register({ id, cwd, source: "tui" });
    return id;
  };

  // Focused cwd: register perCwd sessions; the first is the focused one.
  let focusedSessionId = "";
  for (let i = 0; i < perCwd; i++) {
    const id = reg(spec.focusedCwd);
    if (i === 0) focusedSessionId = id;
  }

  const idle = spec.idleCwds.map((cwd) => ({
    cwd,
    sessionIds: Array.from({ length: perCwd }, () => reg(cwd)),
  }));

  return { manager, focusedSessionId, focusedCwd: spec.focusedCwd, idle };
}

/**
 * Produce a valid `OpenSpecData` whose `JSON.stringify` length is ≈ `sizeBytes`.
 * Pads the last change's `name` to hit the target precisely, so scenario C can
 * sweep payload size independent of topology.
 */
export function makeOpenSpecPayload(sizeBytes: number): OpenSpecData {
  const base: OpenSpecData = {
    initialized: true,
    changes: [
      {
        name: "synthetic-change",
        status: "in-progress",
        completedTasks: 1,
        totalTasks: 3,
        artifacts: [
          { id: "proposal", status: "done" },
          { id: "tasks", status: "ready" },
        ],
      },
    ],
  };
  const baseLen = JSON.stringify(base).length;
  // Returned payload is at least baseLen bytes: when sizeBytes <= baseLen the
  // base is returned unchanged (no negative padding). Callers pass sizeBytes
  // well above baseLen, so the target serialized size is met in practice.
  if (sizeBytes > baseLen) {
    const pad = sizeBytes - baseLen;
    base.changes[0].name = "synthetic-change" + "x".repeat(pad);
  }
  return base;
}

/**
 * Emit `connection` for `n` draining sockets through the REAL gateway, drain
 * the on-connect bootstrap sends, and return the socket handles.
 */
export function attachClients(
  gateway: BrowserGateway,
  n: number,
  wsOpts: DrainingWsOpts,
): DrainingWs[] {
  const sockets: DrainingWs[] = [];
  for (let i = 0; i < n; i++) {
    const ws = createDrainingWs(wsOpts);
    gateway.wss.emit("connection", ws, {});
    ws.drainFully(); // clear the bootstrap snapshot frames
    sockets.push(ws);
  }
  return sockets;
}

/**
 * Subscribe a draining socket to a session via the REAL subscribe handler,
 * then drain the (empty) replay frame. After this the socket is "focused" on
 * `sessionId` and will receive live `event` frames through `broadcastEvent`.
 */
export function subscribeWs(gateway: BrowserGateway, ws: DrainingWs, sessionId: string): void {
  gateway.wss.emit("connection", ws, {});
  ws.drainFully();
  // The connection handler registered a `message` listener; emit a subscribe.
  ws.emit("message", Buffer.from(JSON.stringify({ type: "subscribe", sessionId })));
  ws.drainFully();
}
