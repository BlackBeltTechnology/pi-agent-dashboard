/**
 * Unit tests for the centralized post-install rescan hook.
 *
 * Asserts that the helper invoked from the bootstrap-state subscribe
 * callback calls `registry.rescan()` (no arg → full registry invalidate)
 * exactly once on `installing → ready` and never on other transitions.
 *
 * See change: fix-openspec-buttons-after-bootstrap-install.
 */
import { describe, it, expect, vi } from "vitest";
import { runPostInstallRepair, makeBootstrapTransitionHandler } from "../server.js";

interface SpyRegistry {
  rescan: ReturnType<typeof vi.fn>;
}

interface SpyDirSvc {
  knownDirectories: ReturnType<typeof vi.fn>;
  getOpenSpecData: ReturnType<typeof vi.fn>;
  refreshOpenSpec: ReturnType<typeof vi.fn>;
  refreshPiResources: ReturnType<typeof vi.fn>;
}

interface SpyGateway {
  broadcastToAll: ReturnType<typeof vi.fn>;
}

function makeRegistry(): SpyRegistry {
  return { rescan: vi.fn() };
}

function makeDirSvc(): SpyDirSvc {
  return {
    knownDirectories: vi.fn(() => []),
    getOpenSpecData: vi.fn(() => undefined),
    refreshOpenSpec: vi.fn(async () => ({ initialized: false, changes: [] })),
    refreshPiResources: vi.fn(async () => ({ initialized: false, packages: [] })),
  };
}

function makeGateway(): SpyGateway {
  return { broadcastToAll: vi.fn() };
}

describe("runPostInstallRepair", () => {
  it("calls registry.rescan() with no argument (full registry)", async () => {
    const registry = makeRegistry();
    const directoryService = makeDirSvc();
    const browserGateway = makeGateway();
    await runPostInstallRepair({
      registry: registry as never,
      directoryService: directoryService as never,
      browserGateway: browserGateway as never,
    });
    expect(registry.rescan).toHaveBeenCalledTimes(1);
    expect(registry.rescan).toHaveBeenCalledWith();
  });
});

describe("makeBootstrapTransitionHandler", () => {
  it("invokes the post-install repair exactly once on installing → ready", async () => {
    const repair = vi.fn(async () => undefined);
    const flushAll = vi.fn(async () => undefined);
    const handler = makeBootstrapTransitionHandler({
      onTransitionToReady: repair,
      flushQueue: flushAll,
    });
    handler({ status: "installing" } as never);
    handler({ status: "ready" } as never);
    // Wait one microtask tick for the fire-and-forget to fire.
    await Promise.resolve();
    expect(repair).toHaveBeenCalledTimes(1);
    expect(flushAll).toHaveBeenCalledTimes(1);
  });

  it("does not call repair on ready → ready", async () => {
    const repair = vi.fn(async () => undefined);
    const flushAll = vi.fn(async () => undefined);
    const handler = makeBootstrapTransitionHandler({
      onTransitionToReady: repair,
      flushQueue: flushAll,
    });
    // Initial state defaults to ready, so first ready-snapshot is a no-op.
    handler({ status: "ready" } as never);
    handler({ status: "ready" } as never);
    await Promise.resolve();
    expect(repair).not.toHaveBeenCalled();
    expect(flushAll).not.toHaveBeenCalled();
  });

  it("does not call repair on installing → failed", async () => {
    const repair = vi.fn(async () => undefined);
    const flushAll = vi.fn(async () => undefined);
    const handler = makeBootstrapTransitionHandler({
      onTransitionToReady: repair,
      flushQueue: flushAll,
    });
    handler({ status: "installing" } as never);
    handler({ status: "failed" } as never);
    await Promise.resolve();
    expect(repair).not.toHaveBeenCalled();
    expect(flushAll).not.toHaveBeenCalled();
  });

  it("does not call repair on the very first subscribe snapshot", async () => {
    // Bootstrap state defaults to "ready"; the first emitted snapshot
    // (e.g. from an immediate broadcast) should NOT trigger the hook.
    const repair = vi.fn(async () => undefined);
    const flushAll = vi.fn(async () => undefined);
    const handler = makeBootstrapTransitionHandler({
      onTransitionToReady: repair,
      flushQueue: flushAll,
    });
    handler({ status: "ready" } as never);
    await Promise.resolve();
    expect(repair).not.toHaveBeenCalled();
  });

  it("calls repair on a second installing → ready cycle (e.g. user retry)", async () => {
    const repair = vi.fn(async () => undefined);
    const flushAll = vi.fn(async () => undefined);
    const handler = makeBootstrapTransitionHandler({
      onTransitionToReady: repair,
      flushQueue: flushAll,
    });
    handler({ status: "installing" } as never);
    handler({ status: "ready" } as never);
    handler({ status: "installing" } as never);
    handler({ status: "ready" } as never);
    await Promise.resolve();
    expect(repair).toHaveBeenCalledTimes(2);
    expect(flushAll).toHaveBeenCalledTimes(2);
  });
});
