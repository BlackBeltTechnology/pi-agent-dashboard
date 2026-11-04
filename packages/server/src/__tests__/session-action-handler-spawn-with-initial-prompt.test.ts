/**
 * Verifies that `handleSpawnSession` enqueues a pending-initial-prompt intent
 * when the browser sends `initialPrompt`, and does NOT enqueue when omitted.
 * See change: project-init-skill-and-profiles.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { createPendingAttachRegistry } from "../pending/pending-attach-registry.js";
import { createPendingInitialPromptRegistry } from "../pending/pending-initial-prompt-registry.js";
import { spawnPiSession } from "../spawn-process/process-manager.js";

function makeCtx() {
  const enqueue = vi.fn();
  const ctx = {
    ws: { readyState: 1 } as unknown as WebSocket,
    headlessPidRegistry: { register: vi.fn() },
    pendingDashboardSpawns: new Map<string, number>(),
    pendingInitialPromptRegistry: { enqueue, consume: vi.fn(), size: vi.fn(), withdraw: vi.fn() },
    sendTo: () => {},
  } as any;
  return { ctx, enqueue };
}

describe("handleSpawnSession — initialPrompt", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("enqueues exactly once when initialPrompt is set", async () => {
    (spawnPiSession as any).mockResolvedValueOnce({ success: true });
    const { ctx, enqueue } = makeCtx();
    await handleSpawnSession(
      { type: "spawn_session", cwd: "/bare", initialPrompt: "/skill:project-init" } as any,
      ctx,
    );
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith("/bare", "/skill:project-init");
  });

  it("does NOT enqueue when initialPrompt is absent", async () => {
    (spawnPiSession as any).mockResolvedValueOnce({ success: true });
    const { ctx, enqueue } = makeCtx();
    await handleSpawnSession({ type: "spawn_session", cwd: "/bare" } as any, ctx);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("does NOT enqueue when initialPrompt is empty string", async () => {
    (spawnPiSession as any).mockResolvedValueOnce({ success: true });
    const { ctx, enqueue } = makeCtx();
    await handleSpawnSession(
      { type: "spawn_session", cwd: "/bare", initialPrompt: "" } as any,
      ctx,
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("works when pendingInitialPromptRegistry is undefined (back-compat)", async () => {
    (spawnPiSession as any).mockResolvedValueOnce({ success: true });
    const ctx: any = {
      ws: { readyState: 1 },
      headlessPidRegistry: { register: vi.fn() },
      pendingDashboardSpawns: new Map(),
      sendTo: () => {},
    };
    await expect(
      handleSpawnSession(
        { type: "spawn_session", cwd: "/bare", initialPrompt: "/skill:project-init" } as any,
        ctx,
      ),
    ).resolves.toBeUndefined();
  });
});

// test-plan #X3 — see change: add-spawn-model-choice.
describe("handleSpawnSession — failed spawn withdraws its own intents", () => {
  it("X3: prompt queue keeps the other spawn's head; attach queue drops ours", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    (spawnPiSession as any).mockResolvedValueOnce({ success: false, message: "boom" });
    const norm = { normalize: (c: string) => c };
    const prompts = createPendingInitialPromptRegistry(norm);
    const attach = createPendingAttachRegistry(norm);
    prompts.enqueue("/p", "A");
    const sent: any[] = [];
    const ctx: any = {
      ws: { readyState: 1 },
      headlessPidRegistry: { register: vi.fn() },
      pendingDashboardSpawns: new Map(),
      pendingInitialPromptRegistry: prompts,
      pendingAttachRegistry: attach,
      sendTo: (_ws: unknown, m: unknown) => sent.push(m),
    };
    await handleSpawnSession({ type: "spawn_session", cwd: "/p", initialPrompt: "B", attachProposal: "c" } as any, ctx);
    expect(sent.find((m) => m.type === "spawn_result").success).toBe(false);
    expect(prompts.size("/p")).toBe(1);
    expect(prompts.consume("/p")).toBe("A");
    expect(attach.size("/p")).toBe(0);
  });
});
