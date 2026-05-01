/**
 * Unit tests for the post-install OpenSpec + pi-resources force-refresh
 * portion of `runPostInstallRepair`.
 *
 * See change: fix-openspec-buttons-after-bootstrap-install.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runPostInstallRepair } from "../server.js";

interface SpyRegistry { rescan: ReturnType<typeof vi.fn>; }
interface SpyDirSvc {
  knownDirectories: ReturnType<typeof vi.fn>;
  getOpenSpecData: ReturnType<typeof vi.fn>;
  refreshOpenSpec: ReturnType<typeof vi.fn>;
  refreshPiResources: ReturnType<typeof vi.fn>;
}
interface SpyGateway { broadcastToAll: ReturnType<typeof vi.fn>; }

function makeRegistry(): SpyRegistry { return { rescan: vi.fn() }; }
function makeGateway(): SpyGateway { return { broadcastToAll: vi.fn() }; }

describe("runPostInstallRepair: openspec + pi-resources refresh", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("calls refreshOpenSpec(cwd) once for every known directory", async () => {
    const registry = makeRegistry();
    const cwds = ["/p1", "/p2", "/p3"];
    const directoryService: SpyDirSvc = {
      knownDirectories: vi.fn(() => cwds),
      getOpenSpecData: vi.fn(() => ({ initialized: false, changes: [] })),
      refreshOpenSpec: vi.fn(async () => ({ initialized: true, changes: [{ name: "x" } as never] })),
      refreshPiResources: vi.fn(async () => ({})),
    };
    const browserGateway = makeGateway();

    await runPostInstallRepair({
      registry: registry as never,
      directoryService: directoryService as never,
      browserGateway: browserGateway as never,
    });

    expect(directoryService.refreshOpenSpec).toHaveBeenCalledTimes(3);
    expect(directoryService.refreshOpenSpec).toHaveBeenNthCalledWith(1, "/p1");
    expect(directoryService.refreshOpenSpec).toHaveBeenNthCalledWith(2, "/p2");
    expect(directoryService.refreshOpenSpec).toHaveBeenNthCalledWith(3, "/p3");
  });

  it("broadcasts openspec_update for each cwd whose prior cache was empty/undefined", async () => {
    const cwds = ["/a", "/b"];
    const fresh = { initialized: true, changes: [{ name: "c1" } as never] };
    const directoryService: SpyDirSvc = {
      knownDirectories: vi.fn(() => cwds),
      // Prior was undefined for /a, empty for /b — both should broadcast.
      getOpenSpecData: vi.fn((cwd: string) =>
        cwd === "/a" ? undefined : { initialized: false, changes: [] }
      ),
      refreshOpenSpec: vi.fn(async () => fresh),
      refreshPiResources: vi.fn(async () => ({})),
    };
    const browserGateway = makeGateway();

    await runPostInstallRepair({
      registry: makeRegistry() as never,
      directoryService: directoryService as never,
      browserGateway: browserGateway as never,
    });

    const broadcasts = browserGateway.broadcastToAll.mock.calls
      .map((c: unknown[]) => c[0])
      .filter((m: any) => m?.type === "openspec_update");
    expect(broadcasts).toHaveLength(2);
    expect(broadcasts).toContainEqual({ type: "openspec_update", cwd: "/a", data: fresh });
    expect(broadcasts).toContainEqual({ type: "openspec_update", cwd: "/b", data: fresh });
  });

  it("does not broadcast openspec_update when refreshed data equals prior data", async () => {
    const same = { initialized: true, changes: [{ name: "stable" } as never] };
    const directoryService: SpyDirSvc = {
      knownDirectories: vi.fn(() => ["/p"]),
      getOpenSpecData: vi.fn(() => same),
      refreshOpenSpec: vi.fn(async () => same),
      refreshPiResources: vi.fn(async () => ({})),
    };
    const browserGateway = makeGateway();

    await runPostInstallRepair({
      registry: makeRegistry() as never,
      directoryService: directoryService as never,
      browserGateway: browserGateway as never,
    });

    const broadcasts = browserGateway.broadcastToAll.mock.calls
      .map((c: unknown[]) => c[0])
      .filter((m: any) => m?.type === "openspec_update");
    expect(broadcasts).toHaveLength(0);
  });

  it("isolates a per-cwd refresh failure — the other cwd still refreshes and broadcasts", async () => {
    const cwds = ["/good", "/bad"];
    const fresh = { initialized: true, changes: [{ name: "ok" } as never] };
    const directoryService: SpyDirSvc = {
      knownDirectories: vi.fn(() => cwds),
      getOpenSpecData: vi.fn(() => undefined),
      refreshOpenSpec: vi.fn(async (cwd: string) => {
        if (cwd === "/bad") throw new Error("boom");
        return fresh;
      }),
      refreshPiResources: vi.fn(async () => ({})),
    };
    const browserGateway = makeGateway();

    await runPostInstallRepair({
      registry: makeRegistry() as never,
      directoryService: directoryService as never,
      browserGateway: browserGateway as never,
    });

    // Both cwds attempted.
    expect(directoryService.refreshOpenSpec).toHaveBeenCalledTimes(2);
    // Only the good one broadcasts.
    const broadcasts = browserGateway.broadcastToAll.mock.calls
      .map((c: unknown[]) => c[0])
      .filter((m: any) => m?.type === "openspec_update" && m.cwd === "/good");
    expect(broadcasts).toHaveLength(1);
    // Failure was logged, not propagated.
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("calls refreshPiResources(cwd) once for every known directory", async () => {
    const cwds = ["/a", "/b", "/c"];
    const directoryService: SpyDirSvc = {
      knownDirectories: vi.fn(() => cwds),
      getOpenSpecData: vi.fn(() => undefined),
      refreshOpenSpec: vi.fn(async () => ({ initialized: false, changes: [] })),
      refreshPiResources: vi.fn(async () => ({})),
    };

    await runPostInstallRepair({
      registry: makeRegistry() as never,
      directoryService: directoryService as never,
      browserGateway: makeGateway() as never,
    });

    expect(directoryService.refreshPiResources).toHaveBeenCalledTimes(3);
    expect(directoryService.refreshPiResources).toHaveBeenCalledWith("/a");
    expect(directoryService.refreshPiResources).toHaveBeenCalledWith("/b");
    expect(directoryService.refreshPiResources).toHaveBeenCalledWith("/c");
  });

  it("a refreshPiResources failure does not block other cwds or openspec broadcasts", async () => {
    const cwds = ["/good", "/bad"];
    const fresh = { initialized: true, changes: [{ name: "ok" } as never] };
    const directoryService: SpyDirSvc = {
      knownDirectories: vi.fn(() => cwds),
      getOpenSpecData: vi.fn(() => undefined),
      refreshOpenSpec: vi.fn(async () => fresh),
      refreshPiResources: vi.fn(async (cwd: string) => {
        if (cwd === "/bad") throw new Error("pi-resources blew up");
        return {};
      }),
    };
    const browserGateway = makeGateway();

    await runPostInstallRepair({
      registry: makeRegistry() as never,
      directoryService: directoryService as never,
      browserGateway: browserGateway as never,
    });

    expect(directoryService.refreshPiResources).toHaveBeenCalledTimes(2);
    const openSpecBroadcasts = browserGateway.broadcastToAll.mock.calls
      .map((c: unknown[]) => c[0])
      .filter((m: any) => m?.type === "openspec_update");
    expect(openSpecBroadcasts).toHaveLength(2);
  });
});
