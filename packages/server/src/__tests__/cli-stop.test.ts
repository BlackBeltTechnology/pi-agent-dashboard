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
});
