/**
 * Builders for the browser-gateway broadcast load harness. These wire the
 * REAL `createBrowserGateway` against `DrainingFakeWs` sockets — no fan-out
 * logic is reimplemented here.
 *
 * See change: add-ws-broadcast-load-harness.
 */
import { vi } from "vitest";
import type { DashboardEvent, OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { createMemorySessionManager } from "../../session/memory-session-manager.js";
import { createMemoryEventStore } from "../../persistence/memory-event-store.js";
import type { EventStore } from "../../persistence/memory-event-store.js";
import { createBrowserGateway } from "../../pairing/browser-gateway.js";
import type { BrowserGateway } from "../../pairing/browser-gateway.js";
import type { DirectoryService } from "../../directory-service.js";
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

// ─────────────────────────────────────────────────────────────────────────
// Oracle-extension fixtures — close the D2 coverage gap.
//
// Scenarios A–E above drive ONLY `{ type: "subscribe" }` and never call the
// message paths that reach the async sites this change hardened. These helpers
// let the oracle DRIVE `openspec_refresh` / `openspec_bulk_archive` /
// `shutdown` and a NON-EMPTY replay through the REAL gateway, then prove the
// sites actually landed via spies/counters rather than a coverage report.
// See change: cleanup-async-semantics-server-extension (test-plan #P1/#P2/#P3).
// ─────────────────────────────────────────────────────────────────────────

/** Minimal well-formed `OpenSpecData` for a resolved refresh/poll. */
export function emptyOpenSpecData(): OpenSpecData {
  return { initialized: true, changes: [], hasOpenspecDir: true };
}

export interface FakeDirectoryServiceSpec {
  /** cwds returned by `knownDirectories()` (drives the on-connect snapshot). */
  knownDirectories?: string[];
  /** `refreshOpenSpec` outcome: resolve with data, or reject with a reason. */
  refresh?: { resolve: OpenSpecData } | { reject: unknown };
  /** `pollDirectoryGated` (post-archive) outcome. */
  poll?: { resolve: OpenSpecData } | { reject: unknown };
}

export interface FakeDirectoryService {
  service: DirectoryService;
  /** vi spy over `refreshOpenSpec` — `.mock.calls` is the invocation counter. */
  refreshOpenSpec: ReturnType<typeof vi.fn>;
  /** vi spy over `pollDirectoryGated` — `.mock.calls` is the invocation counter. */
  pollDirectoryGated: ReturnType<typeof vi.fn>;
}

/**
 * A stub `DirectoryService` whose openspec methods are vi spies. Only the
 * members the gateway's message paths touch are implemented; the rest throw if
 * unexpectedly reached, so a wrong path is loud rather than silent.
 */
export function makeFakeDirectoryService(spec: FakeDirectoryServiceSpec = {}): FakeDirectoryService {
  const dirs = spec.knownDirectories ?? [];
  const refreshOpenSpec = vi.fn((_cwd: string): Promise<OpenSpecData> =>
    spec.refresh && "reject" in spec.refresh
      ? Promise.reject(spec.refresh.reject)
      : Promise.resolve(spec.refresh?.resolve ?? emptyOpenSpecData()),
  );
  const pollDirectoryGated = vi.fn((_cwd: string): Promise<OpenSpecData> =>
    spec.poll && "reject" in spec.poll
      ? Promise.reject(spec.poll.reject)
      : Promise.resolve(spec.poll?.resolve ?? emptyOpenSpecData()),
  );
  const service = {
    knownDirectories: () => dirs,
    getOpenSpecData: () => undefined,
    refreshOpenSpec,
    pollDirectoryGated,
    cancelLoad: vi.fn(),
    loadSessionEvents: vi.fn(async () => ({ success: false, error: "cancelled" as const })),
    onDirectoryAdded: vi.fn(async () => ({ sessions: [], openspecData: emptyOpenSpecData() })),
  } as unknown as DirectoryService;
  return { service, refreshOpenSpec, pollDirectoryGated };
}

export interface LoadGatewayExOpts {
  /** Pre-seeded event store (so a NON-EMPTY replay backlog can be staged). */
  eventStore?: EventStore;
  /** Stub pi-gateway (spy `sendToSession` to observe the shutdown forward). */
  piGateway?: PiGateway;
  /** Directory service so `openspec_*` message paths are live. */
  directoryService?: DirectoryService;
}

export interface LoadGatewayEx {
  gateway: BrowserGateway;
  eventStore: EventStore;
  piGateway: PiGateway;
  directoryService?: DirectoryService;
}

/**
 * Like `buildLoadGateway`, but exposes/injects the collaborators the oracle
 * extension needs to reach the hardened sites: a seedable `eventStore`, an
 * observable `piGateway`, and a live `directoryService`. Wires the REAL
 * `createBrowserGateway` — no fan-out or handler logic is reimplemented.
 */
export function buildLoadGatewayEx(manager: SessionManager, opts: LoadGatewayExOpts = {}): LoadGatewayEx {
  const eventStore = opts.eventStore ?? createMemoryEventStore(() => false);
  const piGateway = opts.piGateway ?? makeStubPiGateway();
  const gateway = createBrowserGateway(
    manager,
    eventStore,
    piGateway,
    undefined, // _pendingLoadManager
    undefined, // pendingForkRegistry
    undefined, // sessionOrderManager
    undefined, // preferencesStore
    opts.directoryService, // directoryService (message paths gate on this)
  );
  return { gateway, eventStore, piGateway, directoryService: opts.directoryService };
}

/** Emit a Browser→Server frame through the REAL connection message listener. */
export function sendMessage(ws: DrainingWs, msg: unknown): void {
  ws.emit("message", Buffer.from(JSON.stringify(msg)));
}

/**
 * Drain the real microtask/macrotask queue. The gateway message handler is
 * `async` and `sendEventBatches` yields via `setImmediate`, so the async
 * continuations (the sites under test) settle only after the event loop turns.
 * Bounded so a genuinely stuck promise fails the test instead of hanging.
 */
export async function flushAsync(ticks = 50): Promise<void> {
  for (let i = 0; i < ticks; i++) await new Promise<void>((r) => setImmediate(r));
}

/**
 * Insert `count` replay events (non-`message_update`, so compaction keeps all
 * of them) under `sessionId`, each padded to ~`padBytes`. Staging these before
 * a `subscribe` puts the replay path INSIDE the measured window instead of
 * running as the empty-replay setup the old harness exercised.
 */
export function seedReplayEvents(store: EventStore, sessionId: string, count: number, padBytes: number): number {
  const pad = "x".repeat(padBytes);
  for (let i = 0; i < count; i++) {
    store.insertEvent(sessionId, {
      eventType: "replay_probe",
      timestamp: 1_000 + i,
      data: { i, pad },
    } as unknown as DashboardEvent);
  }
  return count;
}

/**
 * An event store with truncation/trim disabled, so seeded replay payloads keep
 * their byte size (the drain-latency metric is bytes/rate). Unlimited events,
 * huge per-string / per-event ceilings.
 */
export function makeUntruncatedEventStore(): EventStore {
  return createMemoryEventStore(() => false, 128, 0, 10_000_000, 1_000_000_000);
}
