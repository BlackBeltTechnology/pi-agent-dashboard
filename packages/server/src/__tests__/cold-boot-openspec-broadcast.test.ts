/**
 * Cold-boot OpenSpec broadcast — bootstrap initial poll must broadcast
 * `openspec_update` to connected browsers when the prior cache was
 * empty/undefined or the polled data differs from prior.
 *
 * Mirrors `post-install-openspec-refresh.test.ts` contract for the
 * bootstrap path. See change: fix-cold-boot-openspec-protocol.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { discoverAndBroadcastSessions } from "../session/session-bootstrap.js";

interface SpyDirSvc {
  knownDirectories: ReturnType<typeof vi.fn>;
  discoverSessions: ReturnType<typeof vi.fn>;
  getOpenSpecData: ReturnType<typeof vi.fn>;
  refreshOpenSpec: ReturnType<typeof vi.fn>;
  startPolling: ReturnType<typeof vi.fn>;
}

function stubPolling(): { startPolling: ReturnType<typeof vi.fn> } {
  return { startPolling: vi.fn() };
}
interface SpySessionMgr {
  get: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
}
interface SpyGateway {
  broadcastToAll: ReturnType<typeof vi.fn>;
  broadcastSessionAdded: ReturnType<typeof vi.fn>;
}

function makeSessionMgr(): SpySessionMgr {
  return { get: vi.fn(() => undefined), restore: vi.fn() };
}
function makeGateway(): SpyGateway {
  return { broadcastToAll: vi.fn(), broadcastSessionAdded: vi.fn() };
}

/**
 * `discoverAndBroadcastSessions` fires the openspec poll fire-and-forget
 * (`void Promise.all(...)`). We need to await the microtask queue to let
 * those promises resolve before asserting on broadcasts. A few
 * `setImmediate` cycles is enough since the test mocks resolve synchronously.
 */
async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

describe("discoverAndBroadcastSessions: cold-boot openspec broadcast", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("broadcasts openspec_update for each cwd whose prior cache was empty/undefined", async () => {
    const cwds = ["/a", "/b"];
    const fresh = { initialized: true, changes: [{ name: "c1" } as never] };
    const directoryService: SpyDirSvc = {
      knownDirectories: vi.fn(() => cwds),
      discoverSessions: vi.fn(() => []),
      getOpenSpecData: vi.fn((cwd: string) =>
        cwd === "/a" ? undefined : { initialized: false, changes: [] },
      ),
      refreshOpenSpec: vi.fn(async () => fresh),
      ...stubPolling(),
    };
    const browserGateway = makeGateway();

    await discoverAndBroadcastSessions({
      sessionManager: makeSessionMgr() as never,
      browserGateway: browserGateway as never,
      directoryService: directoryService as never,
    });
    await flush();

    const broadcasts = browserGateway.broadcastToAll.mock.calls
      .map((c: unknown[]) => c[0])
      .filter((m: any) => m?.type === "openspec_update");
    expect(broadcasts).toHaveLength(2);
    expect(broadcasts).toContainEqual({ type: "openspec_update", cwd: "/a", data: fresh });
    expect(broadcasts).toContainEqual({ type: "openspec_update", cwd: "/b", data: fresh });
  });

  it("does not broadcast openspec_update when refreshed data equals prior data (warm-restart idempotency)", async () => {
    const same = { initialized: true, changes: [{ name: "stable" } as never] };
    const directoryService: SpyDirSvc = {
      knownDirectories: vi.fn(() => ["/p"]),
      discoverSessions: vi.fn(() => []),
      getOpenSpecData: vi.fn(() => same),
      refreshOpenSpec: vi.fn(async () => same),
      ...stubPolling(),
    };
    const browserGateway = makeGateway();

    await discoverAndBroadcastSessions({
      sessionManager: makeSessionMgr() as never,
      browserGateway: browserGateway as never,
      directoryService: directoryService as never,
    });
    await flush();

    const broadcasts = browserGateway.broadcastToAll.mock.calls
      .map((c: unknown[]) => c[0])
      .filter((m: any) => m?.type === "openspec_update");
    expect(broadcasts).toHaveLength(0);
  });

  it("broadcasts when prior is populated and fresh differs", async () => {
    const prior = { initialized: true, changes: [{ name: "old" } as never] };
    const fresh = { initialized: true, changes: [{ name: "new" } as never] };
    const directoryService: SpyDirSvc = {
      knownDirectories: vi.fn(() => ["/p"]),
      discoverSessions: vi.fn(() => []),
      getOpenSpecData: vi.fn(() => prior),
      refreshOpenSpec: vi.fn(async () => fresh),
      ...stubPolling(),
    };
    const browserGateway = makeGateway();

    await discoverAndBroadcastSessions({
      sessionManager: makeSessionMgr() as never,
      browserGateway: browserGateway as never,
      directoryService: directoryService as never,
    });
    await flush();

    const broadcasts = browserGateway.broadcastToAll.mock.calls
      .map((c: unknown[]) => c[0])
      .filter((m: any) => m?.type === "openspec_update");
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]).toEqual({ type: "openspec_update", cwd: "/p", data: fresh });
  });

  it("does not block on refreshOpenSpec failure; logs error and skips broadcast for that cwd", async () => {
    const fresh = { initialized: true, changes: [{ name: "ok" } as never] };
    const directoryService: SpyDirSvc = {
      knownDirectories: vi.fn(() => ["/bad", "/good"]),
      discoverSessions: vi.fn(() => []),
      getOpenSpecData: vi.fn(() => undefined),
      refreshOpenSpec: vi.fn(async (cwd: string) => {
        if (cwd === "/bad") throw new Error("boom");
        return fresh;
      }),
      ...stubPolling(),
    };
    const browserGateway = makeGateway();

    await discoverAndBroadcastSessions({
      sessionManager: makeSessionMgr() as never,
      browserGateway: browserGateway as never,
      directoryService: directoryService as never,
    });
    await flush();

    const broadcasts = browserGateway.broadcastToAll.mock.calls
      .map((c: unknown[]) => c[0])
      .filter((m: any) => m?.type === "openspec_update");
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]).toEqual({ type: "openspec_update", cwd: "/good", data: fresh });
  });
});
