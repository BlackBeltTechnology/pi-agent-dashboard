/**
 * evaluateAttachedServer orchestration (restart verification, lifetime flags,
 * silent failures). test-plan: P1, X8–X15.
 * See change: electron-attach-version-skew.
 */
import { describe, expect, it, vi } from "vitest";
import { type AttachEvaluationDeps, createAttachEvaluator } from "../attach-evaluation.js";
import type { MergedZombieSkewChoice, SkewInfoChoice, SkewRestartChoice, ZombieChoice } from "../zombie-adoption-dialog.js";

type Health = Record<string, unknown>;

function mk(over: Partial<AttachEvaluationDeps> & { health?: Health | null | (() => Promise<Health | null>) } = {}) {
  const { health, ...rest } = over;
  const baseHealth: Health = {
    version: "0.9.0",
    pid: 4242,
    ppid: 100,
    bootParentPid: 100, // ppid === bootParentPid → not a zombie
    bootParentAlive: false,
    launchSourceEffective: "electron",
    launchSource: "electron",
  };
  let current: Health | null = health === undefined ? baseHealth : (typeof health === "function" ? null : health);
  const fetchHealth = vi.fn(async () => (typeof health === "function" ? health() : current));
  const dialogs = {
    zombie: vi.fn(async (_p: { pid: number }): Promise<ZombieChoice> => "leave"),
    restart: vi.fn(async (_p: { server: string; expected: string; restartIsDefault: boolean }): Promise<SkewRestartChoice> => "restart"),
    merged: vi.fn(async (_p: { pid: number; server: string; expected: string }): Promise<MergedZombieSkewChoice> => "restart"),
    info: vi.fn(async (_p: { server: string; expected: string; shellVersion: string; launchSource: string | undefined }): Promise<SkewInfoChoice> => "ok"),
    notify: vi.fn(async (_p: { title: string; message: string; error?: boolean }) => {}),
  };
  const deps: AttachEvaluationDeps = {
    shellVersion: "0.10.0",
    isPackaged: true,
    platform: "linux",
    noPrompt: false,
    fetchHealth,
    resolveExpected: vi.fn(async () => ({ version: "0.10.0" })),
    getStoredSpawnedPid: vi.fn(() => null),
    setSpawnedPid: vi.fn(),
    readDismissals: vi.fn(() => []),
    addDismissal: vi.fn(),
    dialogs,
    stopZombie: vi.fn(async () => true),
    respawnAndReload: vi.fn(async () => {}),
    requestServerLaunch: vi.fn(async () => ({ kind: "started" as const, url: "http://localhost:8000" })),
    reloadWindow: vi.fn(),
    showRecovery: vi.fn(),
    log: vi.fn(),
    ...rest,
  };
  return { deps, dialogs, setHealth: (h: Health | null) => { current = h; }, fetchHealth };
}

const logged = (deps: AttachEvaluationDeps) => (deps.log as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));

describe("evaluateAttachedServer", () => {
  it("P1: evaluation is fire-and-forget — the caller continues before the health fetch resolves", async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    const m = mk({ health: () => new Promise((r) => setTimeout(() => { order.push("health"); r(null); }, 3000)) });
    const ev = createAttachEvaluator({ ...m.deps, resolveExpected: async () => { await new Promise((r) => setTimeout(r, 1000)); return { version: "0.10.0" }; } });
    const pending = ev.evaluate();
    order.push("createMainWindow");
    await vi.advanceTimersByTimeAsync(3000);
    await pending;
    expect(order).toEqual(["createMainWindow", "health"]);
    vi.useRealTimers();
  });

  it("X9: a changed server identity aborts the restart without shutdown or signal", async () => {
    const m = mk();
    const ev = createAttachEvaluator(m.deps);
    // The modal is open → the server is replaced by PID 5151 before the user answers.
    m.dialogs.restart.mockImplementation(async () => {
      m.setHealth({ ...(await m.fetchHealth())!, pid: 5151 });
      return "restart";
    });
    await ev.evaluate();
    expect(m.deps.requestServerLaunch).not.toHaveBeenCalled();
    expect(m.dialogs.notify).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("did not complete") }));
  });

  it("X9: a changed boot parent also aborts", async () => {
    const m = mk();
    m.dialogs.restart.mockImplementation(async () => {
      m.setHealth({ ...(await m.fetchHealth())!, bootParentPid: 999 });
      return "restart";
    });
    await createAttachEvaluator(m.deps).evaluate();
    expect(m.deps.requestServerLaunch).not.toHaveBeenCalled();
  });

  it("X10: server already at the expected version is not restarted", async () => {
    const m = mk();
    m.dialogs.restart.mockImplementation(async () => {
      m.setHealth({ ...(await m.fetchHealth())!, version: "0.10.0" });
      return "restart";
    });
    await createAttachEvaluator(m.deps).evaluate();
    expect(m.deps.requestServerLaunch).not.toHaveBeenCalled();
    expect(m.dialogs.notify).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("already up to date") }));
  });

  it("restart happy path: verified server, reload, no notice", async () => {
    const m = mk();
    (m.deps.requestServerLaunch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      m.setHealth({ version: "0.10.0", pid: 7777, launchSourceEffective: "electron" });
      return { kind: "started", url: "u" };
    });
    (m.deps.getStoredSpawnedPid as ReturnType<typeof vi.fn>).mockReturnValueOnce(null).mockReturnValue(7777);
    await createAttachEvaluator(m.deps).evaluate();
    expect(m.deps.requestServerLaunch).toHaveBeenCalledWith({ force: true });
    expect(m.deps.reloadWindow).toHaveBeenCalled();
    expect(m.dialogs.notify).not.toHaveBeenCalled();
    expect(m.deps.showRecovery).not.toHaveBeenCalled();
  });

  it("X11: a foreign server after restart → recovery, no success", async () => {
    for (const after of [
      { version: "0.10.0", pid: 1111, launchSourceEffective: "electron" }, // pid ≠ stored
      { version: "0.10.0", pid: 7777, launchSourceEffective: "standalone" },
    ]) {
      const m = mk();
      (m.deps.requestServerLaunch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        m.setHealth(after);
        return { kind: "started", url: "u" };
      });
      (m.deps.getStoredSpawnedPid as ReturnType<typeof vi.fn>).mockReturnValueOnce(null).mockReturnValue(7777);
      await createAttachEvaluator(m.deps).evaluate();
      expect(m.deps.showRecovery).toHaveBeenCalledTimes(1);
      expect(m.deps.reloadWindow).not.toHaveBeenCalled();
    }
  });

  it("X12: runtime fallback is reported honestly", async () => {
    const m = mk({ resolveExpected: async () => ({ version: "0.10.1" }) });
    (m.deps.requestServerLaunch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      m.setHealth({ version: "0.10.0", pid: 7777, launchSourceEffective: "electron" });
      return { kind: "started", url: "u" };
    });
    (m.deps.getStoredSpawnedPid as ReturnType<typeof vi.fn>).mockReturnValueOnce(null).mockReturnValue(7777);
    await createAttachEvaluator(m.deps).evaluate();
    const msg = m.dialogs.notify.mock.calls[0][0].message as string;
    expect(msg).toContain("v0.10.0");
    expect(msg).toContain("instead of v0.10.1");
  });

  it("X13: launch failure after the old server is gone → notice + recovery once", async () => {
    const m = mk();
    (m.deps.requestServerLaunch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      m.setHealth(null);
      return { kind: "failed", reason: "boom", logTail: "" };
    });
    await createAttachEvaluator(m.deps).evaluate();
    expect(m.dialogs.notify).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("boom") }));
    expect(m.deps.showRecovery).toHaveBeenCalledTimes(1);
  });

  it("X13: failure with the old server still running keeps the current page", async () => {
    const m = mk();
    (m.deps.requestServerLaunch as ReturnType<typeof vi.fn>).mockResolvedValue({ kind: "failed", reason: "alive", logTail: "" });
    await createAttachEvaluator(m.deps).evaluate();
    expect(m.deps.showRecovery).not.toHaveBeenCalled();
  });

  it("X14: Leave running / OK are lifetime-scoped", async () => {
    const m = mk();
    m.dialogs.restart.mockResolvedValue("leave");
    const ev = createAttachEvaluator(m.deps);
    await ev.evaluate();
    await ev.evaluate();
    expect(m.dialogs.restart).toHaveBeenCalledTimes(1);
    await createAttachEvaluator(m.deps).evaluate();
    expect(m.dialogs.restart).toHaveBeenCalledTimes(2);

    const i = mk({ health: { version: "0.9.0", pid: 1, launchSourceEffective: "standalone", launchSource: "standalone" } });
    const ev2 = createAttachEvaluator(i.deps);
    await ev2.evaluate();
    await ev2.evaluate();
    expect(i.dialogs.info).toHaveBeenCalledTimes(1);
    await createAttachEvaluator(i.deps).evaluate();
    expect(i.dialogs.info).toHaveBeenCalledTimes(2);
  });

  it("info modal 'Don't show again' persists the pair keyed by launch source", async () => {
    const i = mk({ health: { version: "0.9.0", pid: 1, launchSourceEffective: "standalone", launchSource: "standalone" } });
    i.dialogs.info.mockResolvedValue("dismiss");
    await createAttachEvaluator(i.deps).evaluate();
    expect(i.deps.addDismissal).toHaveBeenCalledWith({ server: "0.9.0", expected: "0.10.0", launchSource: "standalone" });
  });

  it("X15: unreachable health is silent and logged", async () => {
    const m = mk({ health: null });
    await createAttachEvaluator(m.deps).evaluate();
    expect(m.dialogs.restart).not.toHaveBeenCalled();
    expect(logged(m.deps).some((l) => l.includes("[attach-check]") && l.includes("health-unreachable"))).toBe(true);
  });

  it("X8: zombie Stop now that fails to kill → notice, no respawn", async () => {
    const m = mk({
      health: { version: "0.10.0", pid: 4242, ppid: 1, bootParentPid: 100, bootParentAlive: false, launchSourceEffective: "electron", launchSource: "electron" },
      stopZombie: vi.fn(async () => false),
    });
    m.dialogs.zombie.mockResolvedValue("stop");
    await createAttachEvaluator(m.deps).evaluate();
    expect(m.deps.respawnAndReload).not.toHaveBeenCalled();
    expect(m.dialogs.notify).toHaveBeenCalledTimes(1);
  });

  it("zombie Stop now that succeeds respawns", async () => {
    const m = mk({
      health: { version: "0.10.0", pid: 4242, ppid: 1, bootParentPid: 100, bootParentAlive: false, launchSourceEffective: "electron" },
    });
    m.dialogs.zombie.mockResolvedValue("stop");
    await createAttachEvaluator(m.deps).evaluate();
    expect(m.deps.respawnAndReload).toHaveBeenCalledTimes(1);
  });

  it("--no-zombie-prompt: logs the decision, shows nothing", async () => {
    const m = mk({ noPrompt: true });
    await createAttachEvaluator(m.deps).evaluate();
    expect(m.dialogs.restart).not.toHaveBeenCalled();
    expect(logged(m.deps).some((l) => l.includes("[attach-check]") && l.includes("0.9.0") && l.includes("0.10.0"))).toBe(true);
  });
});
