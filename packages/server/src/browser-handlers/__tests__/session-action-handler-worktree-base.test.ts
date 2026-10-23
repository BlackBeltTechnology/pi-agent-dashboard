/**
 * SE8 (test-plan #SE8): the WS `gitWorktreeBase` hint is validated before it is stored. An
 * option-like / control-character hint is dropped with ONE log line and NO error to the client.
 * See change: harden-git-terminal-plugin-boundaries (B1r).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../spawn-process/process-manager.js", () => ({
  spawnPiSession: vi.fn(),
  getKeeperManager: () => ({ isKeeperAlive: () => false }),
}));
vi.mock("@blackbelt-technology/pi-dashboard-shared/config.js", () => ({
  loadConfig: () => ({ spawnStrategy: "headless" as const, spawnRegisterTimeoutMs: 30000, defaultModel: "", defaultThinkingLevel: "" }),
}));
vi.mock("../../spawn-process/spawn-preflight.js", () => ({
  preflightSpawn: vi.fn().mockReturnValue({ ok: true, reasons: [] }),
}));
vi.mock("../../spawn-process/spawn-register-watchdog.js", () => ({
  getSpawnRegisterWatchdog: vi.fn().mockReturnValue({ arm: vi.fn() }),
  armSpawnWatchdog: vi.fn(),
}));
vi.mock("../../spawn-process/spawn-failure-log.js", () => ({ appendSpawnFailure: vi.fn() }));

import { spawnPiSession } from "../../spawn-process/process-manager.js";
import type { BrowserHandlerContext } from "../handler-context.js";
import { handleSpawnSession } from "../session-action-handler.js";

function makeCtx() {
  const enqueue = vi.fn();
  const sent: unknown[] = [];
  const ctx = {
    ws: { readyState: 1 },
    headlessPidRegistry: { register: vi.fn() },
    pendingDashboardSpawns: new Map<string, number>(),
    pendingWorktreeBaseRegistry: { enqueue, consume: vi.fn(), size: vi.fn() },
    sendTo: (_ws: unknown, m: unknown) => sent.push(m),
  } as unknown as BrowserHandlerContext;
  return { ctx, enqueue, sent };
}

describe("handleSpawnSession — gitWorktreeBase hint validation (SE8)", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.clearAllMocks();
    (spawnPiSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it.each(["-x", "--detach", "a\nb", "a\u007fb"])("drops %j: not stored, one log line, no client error", async (hint) => {
    const { ctx, enqueue, sent } = makeCtx();
    await handleSpawnSession({ type: "spawn_session", cwd: "/proj", gitWorktreeBase: hint } as any, ctx);
    expect(enqueue).not.toHaveBeenCalled();
    const hintLogs = warn.mock.calls.filter((c: unknown[]) => String(c[0]).includes("gitWorktreeBase"));
    expect(hintLogs).toHaveLength(1);
    expect(sent.filter((m) => (m as { type?: string }).type?.includes("error"))).toEqual([]);
  });

  it("stores a valid hint (`main`)", async () => {
    const { ctx, enqueue } = makeCtx();
    await handleSpawnSession({ type: "spawn_session", cwd: "/proj", gitWorktreeBase: "main" } as any, ctx);
    expect(enqueue).toHaveBeenCalledWith("/proj", "main");
    expect(warn.mock.calls.filter((c: unknown[]) => String(c[0]).includes("gitWorktreeBase"))).toHaveLength(0);
  });
});
