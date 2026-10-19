/**
 * `cmdStop` — ownership-scoped port sweep + `--force`.
 * See change: fix-cli-stop-foreign-home-kill (test-plan E2-E4, E10-E14).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cmdStop } from "../cli.js";
import type { ServerConfig } from "../server.js";

const cfg = (o: Partial<ServerConfig> = {}) => ({ port: 18555, piPort: 18556, ...o }) as ServerConfig;

function deps(o: Record<string, unknown> = {}) {
  return {
    findPortHolders: vi.fn((_p: number): number[] => []),
    killProcess: vi.fn(async () => true),
    readPid: vi.fn((): number | null => null),
    removePid: vi.fn(),
    isProcessAlive: vi.fn(() => true),
    collectOwnedPids: vi.fn(async () => new Set<number>()),
    ...o,
  } as any;
}

let out: string[];
beforeEach(() => {
  out = [];
  vi.spyOn(console, "log").mockImplementation((...a) => { out.push(a.join(" ")); });
  vi.spyOn(console, "warn").mockImplementation((...a) => { out.push(a.join(" ")); });
});
afterEach(() => vi.restoreAllMocks());
const text = () => out.join("\n");

describe("cmdStop", () => {
  it("E3: never inspects port 0", async () => {
    const d = deps();
    await cmdStop(cfg({ port: 0, piPort: 9999 }), {}, d);
    expect(d.findPortHolders.mock.calls.map((c: number[]) => c[0])).toEqual([9999]);
  });

  it("E4: inspects exactly the resolved ports", async () => {
    const d = deps();
    await cmdStop(cfg(), {}, d);
    expect(d.findPortHolders.mock.calls.map((c: number[]) => c[0])).toEqual([18555, 18556]);
  });

  it("E10: PID-file kill ok → no re-sweep; failed → treated as foreign", async () => {
    const ok = deps({ readPid: vi.fn(() => 50), findPortHolders: vi.fn(() => [50]) });
    await cmdStop(cfg(), {}, ok);
    expect(ok.killProcess).toHaveBeenCalledTimes(1);
    expect(text()).not.toContain("not owned");

    out.length = 0;
    const bad = deps({
      readPid: vi.fn(() => 50),
      findPortHolders: vi.fn((p: number) => (p === 18555 ? [50] : [])),
      killProcess: vi.fn(async () => false),
    });
    await cmdStop(cfg(), {}, bad);
    expect(bad.killProcess).toHaveBeenCalledTimes(1); // PID-file step only
    expect(text()).toContain("held by pid 50");
  });

  it("E11: one holder on both ports → one skip line naming both, no kill", async () => {
    const d = deps({ findPortHolders: vi.fn(() => [9]) });
    await cmdStop(cfg(), {}, d);
    expect(d.killProcess).not.toHaveBeenCalled();
    const lines = out.filter((l) => l.includes("held by pid 9"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("18555,18556");
    expect(lines[0]).toContain("--force");
  });

  it.each([false, true])("E12: owned holder killed once, silently (force=%s)", async (force) => {
    const d = deps({
      findPortHolders: vi.fn((p: number) => (p === 18555 ? [9] : [])),
      collectOwnedPids: vi.fn(async () => new Set([9])),
    });
    await cmdStop(cfg(), { force }, d);
    expect(d.killProcess).toHaveBeenCalledTimes(1);
    expect(text()).not.toContain("NOT owned");
  });

  it("E13: --force kills a foreign holder with a warning", async () => {
    const d = deps({ findPortHolders: vi.fn((p: number) => (p === 18555 ? [66] : [])) });
    await cmdStop(cfg(), { force: true }, d);
    expect(d.killProcess).toHaveBeenCalledWith(66, expect.any(String));
    expect(text()).toContain("--force: killing pid 66");
    expect(text()).toMatch(/NOT owned by this HOME \(.+\)/);
  });

  it("E14: base scenarios", async () => {
    const live = deps({ readPid: vi.fn(() => 5) });
    await cmdStop(cfg(), {}, live);
    expect(live.killProcess).toHaveBeenCalledWith(5, "Dashboard server");

    out.length = 0;
    await cmdStop(cfg(), {}, deps());
    expect(text()).toBe("Dashboard server is not running");

    out.length = 0;
    const dead = deps({ readPid: vi.fn(() => 5), isProcessAlive: vi.fn(() => false) });
    await cmdStop(cfg(), {}, dead);
    expect(text()).toContain("Dashboard server is not running (cleaned up stale PID file)");
    expect(dead.removePid).toHaveBeenCalled();
  });

  it("evidence is gathered before the PID-file kill", async () => {
    const order: string[] = [];
    const d = deps({
      readPid: vi.fn(() => 5),
      collectOwnedPids: vi.fn(async () => { order.push("collect"); return new Set(); }),
      killProcess: vi.fn(async () => { order.push("kill"); return true; }),
    });
    await cmdStop(cfg(), {}, d);
    expect(order).toEqual(["collect", "kill"]);
  });

  // See change: harden-dashboard-start-detection (test-plan #E18, #E19).
  it("E18: a failed kill of a still-alive pid keeps the pid file", async () => {
    const d = deps({
      readPid: vi.fn(() => 4242),
      isProcessAlive: vi.fn(() => true),
      killProcess: vi.fn(async () => false),
    });
    await cmdStop(cfg(), {}, d);
    expect(d.killProcess).toHaveBeenCalledTimes(1);
    expect(d.removePid).not.toHaveBeenCalled();
  });

  it("E19: a stale (dead) pid is cleaned up and reported", async () => {
    const d = deps({ readPid: vi.fn(() => 4242), isProcessAlive: vi.fn(() => false) });
    await cmdStop(cfg(), {}, d);
    expect(d.removePid).toHaveBeenCalledTimes(1);
    expect(out.find((l) => l.startsWith("Dashboard server is not running"))).toBeDefined();
  });

  it("a successful kill removes the pid file", async () => {
    let alive = true;
    const d = deps({
      readPid: vi.fn(() => 4242),
      isProcessAlive: vi.fn(() => alive),
      killProcess: vi.fn(async () => { alive = false; return true; }),
    });
    await cmdStop(cfg(), {}, d);
    expect(d.removePid).toHaveBeenCalledTimes(1);
  });
});

// ── Announced shutdown for the health-proven pid ─────────────────────────────
// See change: fix-cli-control-electron-server (test-plan #E5, #E6, #E7, #X1, #X2; design D4).
describe("cmdStop — announced shutdown", () => {
  const facts = { launchSource: "standalone", bootParentAlive: true } as Record<string, unknown>;
  const proven = (pid: number, h: Record<string, unknown> = facts) => ({
    owned: new Set([pid]),
    healthProven: { pid, health: h },
  });
  const announced = (o: Record<string, unknown> = {}) =>
    deps({
      collectOwnership: vi.fn(async () => proven(300)),
      shutdownRequest: vi.fn(async () => ({ ok: true, status: 200 })),
      waitForExit: vi.fn(async () => true),
      ...o,
    });

  it("E6(a): PID-file pid = health pid → request first, no kill when it exits", async () => {
    const d = announced({ readPid: vi.fn(() => 300), findPortHolders: vi.fn(() => [300]) });
    await cmdStop(cfg(), {}, d);
    expect(d.shutdownRequest).toHaveBeenCalledTimes(1);
    expect(d.waitForExit).toHaveBeenCalledWith(300, 5000);
    expect(d.killProcess).not.toHaveBeenCalled();
    expect(text()).toContain("Dashboard server stopped (pid 300)");
  });

  it("E6(b): orphan found by the port sweep → request, then no kill", async () => {
    const d = announced({ findPortHolders: vi.fn((p: number) => (p === 18555 ? [300] : [])) });
    await cmdStop(cfg(), {}, d);
    expect(d.shutdownRequest).toHaveBeenCalledTimes(1);
    expect(d.killProcess).not.toHaveBeenCalled();
  });

  it("E6(c): lock-metadata-only holder → SIGTERM path, no request", async () => {
    const d = deps({
      collectOwnership: vi.fn(async () => ({ owned: new Set([301]), healthProven: null })),
      shutdownRequest: vi.fn(),
      findPortHolders: vi.fn((p: number) => (p === 18555 ? [301] : [])),
    });
    await cmdStop(cfg(), {}, d);
    expect(d.shutdownRequest).not.toHaveBeenCalled();
    expect(d.killProcess).toHaveBeenCalledWith(301, expect.any(String));
  });

  it("E6(d): no health proof → no request, SIGTERM on the PID-file pid", async () => {
    const d = deps({ shutdownRequest: vi.fn(), readPid: vi.fn(() => 300) });
    await cmdStop(cfg(), {}, d);
    expect(d.shutdownRequest).not.toHaveBeenCalled();
    expect(d.killProcess).toHaveBeenCalledWith(300, "Dashboard server");
  });

  it("E6(e): PID file names another pid → it is killed; the request is only for the proven pid", async () => {
    const d = announced({
      readPid: vi.fn(() => 299),
      findPortHolders: vi.fn((p: number) => (p === 18555 ? [300] : [])),
    });
    await cmdStop(cfg(), {}, d);
    expect(d.killProcess).toHaveBeenCalledWith(299, "Dashboard server");
    expect(d.killProcess).not.toHaveBeenCalledWith(300, expect.any(String));
    expect(d.shutdownRequest).toHaveBeenCalledTimes(1);
  });

  it("the request goes out before any kill of the same pid", async () => {
    const order: string[] = [];
    const d = announced({
      readPid: vi.fn(() => 300),
      shutdownRequest: vi.fn(async () => { order.push("request"); return { ok: false, status: 403 }; }),
      killProcess: vi.fn(async () => { order.push("kill"); return true; }),
    });
    await cmdStop(cfg(), {}, d);
    expect(order).toEqual(["request", "kill"]);
  });

  it("X1(a): a rejected request falls back to SIGTERM once and logs the reason", async () => {
    const d = announced({
      readPid: vi.fn(() => 300),
      shutdownRequest: vi.fn(async () => { throw new Error("read ECONNRESET"); }),
    });
    await cmdStop(cfg(), {}, d);
    expect(d.killProcess).toHaveBeenCalledTimes(1);
    expect(d.killProcess).toHaveBeenCalledWith(300, "Dashboard server");
    expect(text()).toContain("ECONNRESET");
  });

  it("X1(b): a refused request (403) falls back to SIGTERM once and logs it", async () => {
    const d = announced({
      readPid: vi.fn(() => 300),
      shutdownRequest: vi.fn(async () => ({ ok: false, status: 403, detail: "local_proof_required" })),
    });
    await cmdStop(cfg(), {}, d);
    expect(d.killProcess).toHaveBeenCalledTimes(1);
    expect(text()).toContain("403");
  });

  it("X2: accepted but the process survives the 5 s wait → SIGTERM once", async () => {
    const d = announced({ readPid: vi.fn(() => 300), waitForExit: vi.fn(async () => false) });
    await cmdStop(cfg(), {}, d);
    expect(d.waitForExit).toHaveBeenCalledWith(300, 5000);
    expect(d.killProcess).toHaveBeenCalledTimes(1);
    expect(d.killProcess).toHaveBeenCalledWith(300, "Dashboard server");
  });

  it("E7: the real request is POST /api/shutdown with a local credential and no body", async () => {
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const d = deps({
        collectOwnership: vi.fn(async () => proven(300)),
        waitForExit: vi.fn(async () => true),
        readPid: vi.fn(() => 300),
      });
      await cmdStop(cfg(), {}, d); // `deps()` leaves shutdownRequest unset → the real one runs
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("http://127.0.0.1:18555/api/shutdown");
      expect(init.method).toBe("POST");
      expect(init.body ?? undefined).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  describe("E5: desktop-app note", () => {
    const run = async (h: Record<string, unknown>, stopOk = true) => {
      const d = announced({
        collectOwnership: vi.fn(async () => proven(300, h)),
        readPid: vi.fn(() => 300),
        waitForExit: vi.fn(async () => stopOk),
        killProcess: vi.fn(async () => stopOk),
      });
      await cmdStop(cfg(), {}, d);
    };

    it("(a) electron + app alive → stopped line plus a note naming the app pid and the reconnect page", async () => {
      await run({ launchSource: "electron", bootParentAlive: true, bootParentPid: 4242 });
      expect(text()).toContain("Dashboard server stopped");
      const note = out.find((l) => /desktop app/i.test(l)) ?? "";
      expect(note).toContain("4242");
      expect(note).toMatch(/reconnect/i);
    });

    it("(b) app gone → no note", async () => {
      await run({ launchSource: "electron", bootParentAlive: false, bootParentPid: 4242 });
      expect(text()).not.toMatch(/desktop app/i);
    });

    it("(c) standalone → no note", async () => {
      await run({ launchSource: "standalone", bootParentAlive: true });
      expect(text()).not.toMatch(/desktop app/i);
    });

    it("(d) stop failed → no note", async () => {
      await run({ launchSource: "electron", bootParentAlive: true, bootParentPid: 4242 }, false);
      expect(text()).not.toMatch(/desktop app/i);
    });
  });
});
