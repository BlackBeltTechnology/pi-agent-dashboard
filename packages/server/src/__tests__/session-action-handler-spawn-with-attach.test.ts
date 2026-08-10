/**
 * Verifies that `handleSpawnSession` enqueues a pending-attach intent
 * when the browser sends `attachProposal`, and does NOT enqueue when omitted.
 * See change: add-folder-task-checker-and-spawn-attach.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../spawn-process/process-manager.js", () => ({
  spawnPiSession: vi.fn(),
}));
vi.mock("../../../shared/src/config.js", () => ({
  loadConfig: () => ({ spawnStrategy: "headless" as const }),
}));
vi.mock("@blackbelt-technology/pi-dashboard-shared/config.js", () => ({
  loadConfig: () => ({ spawnStrategy: "headless" as const }),
}));

import { handleSpawnSession } from "../browser-handlers/session-action-handler.js";
import { spawnPiSession } from "../spawn-process/process-manager.js";

function makeCtx() {
  const enqueue = vi.fn();
  const ctx = {
    ws: { readyState: 1 } as unknown as WebSocket,
    headlessPidRegistry: { register: vi.fn() },
    pendingDashboardSpawns: new Map<string, number>(),
    pendingAttachRegistry: { enqueue, consume: vi.fn(), size: vi.fn() },
    sendTo: () => {},
  } as any;
  return { ctx, enqueue };
}

describe("handleSpawnSession — attachProposal", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("enqueues exactly once when attachProposal is set", async () => {
    (spawnPiSession as any).mockResolvedValueOnce({ success: true });
    const { ctx, enqueue } = makeCtx();
    await handleSpawnSession(
      { type: "spawn_session", cwd: "/proj", attachProposal: "add-foo" } as any,
      ctx,
    );
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith("/proj", "add-foo");
  });

  it("does NOT enqueue when attachProposal is absent", async () => {
    (spawnPiSession as any).mockResolvedValueOnce({ success: true });
    const { ctx, enqueue } = makeCtx();
    await handleSpawnSession({ type: "spawn_session", cwd: "/proj" } as any, ctx);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("does NOT enqueue when attachProposal is empty string", async () => {
    (spawnPiSession as any).mockResolvedValueOnce({ success: true });
    const { ctx, enqueue } = makeCtx();
    await handleSpawnSession(
      { type: "spawn_session", cwd: "/proj", attachProposal: "" } as any,
      ctx,
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("enqueues BEFORE awaiting spawnPiSession (intent survives a fast register)", async () => {
    let spawnCalled = false;
    const { ctx, enqueue } = makeCtx();
    enqueue.mockImplementation(() => {
      // The spawn must not have started yet at the time we enqueue.
      expect(spawnCalled).toBe(false);
    });
    (spawnPiSession as any).mockImplementation(async () => {
      spawnCalled = true;
      return { success: true };
    });
    await handleSpawnSession(
      { type: "spawn_session", cwd: "/proj", attachProposal: "add-bar" } as any,
      ctx,
    );
    expect(enqueue).toHaveBeenCalledOnce();
  });

  it("still enqueues even when spawn throws (spawn failure isn't a reason to lose intent — TTL handles it)", async () => {
    (spawnPiSession as any).mockRejectedValueOnce(new Error("boom"));
    const { ctx, enqueue } = makeCtx();
    await handleSpawnSession(
      { type: "spawn_session", cwd: "/proj", attachProposal: "add-baz" } as any,
      ctx,
    );
    expect(enqueue).toHaveBeenCalledOnce();
  });

  it("works when pendingAttachRegistry is undefined (back-compat)", async () => {
    (spawnPiSession as any).mockResolvedValueOnce({ success: true });
    const ctx: any = {
      ws: { readyState: 1 },
      headlessPidRegistry: { register: vi.fn() },
      pendingDashboardSpawns: new Map(),
      sendTo: () => {},
    };
    await expect(
      handleSpawnSession(
        { type: "spawn_session", cwd: "/proj", attachProposal: "add-foo" } as any,
        ctx,
      ),
    ).resolves.toBeUndefined();
  });
});
