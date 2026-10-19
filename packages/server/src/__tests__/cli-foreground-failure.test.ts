/**
 * Bare `pi-dashboard` (foreground): classify the port ONCE, only after a failed
 * start, and exit 1 in every failure case.
 * See change: fix-cli-control-electron-server (test-plan #P1, #X3, #X4, #X5; design D5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cmdForeground } from "../cli.js";
import type { PortClassification } from "../lifecycle/classify-dashboard-port.js";
import type { ServerConfig } from "../server.js";

const cfg = { port: 18555, piPort: 18556 } as ServerConfig;

let out: string[];
let err: string[];
beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(console, "log").mockImplementation((...a) => { out.push(a.join(" ")); });
  vi.spyOn(console, "error").mockImplementation((...a) => { err.push(a.map(String).join(" ")); });
});
afterEach(() => vi.restoreAllMocks());

function run(runForeground: () => Promise<void>, verdict: PortClassification) {
  const classify = vi.fn(async () => verdict);
  const exit = vi.fn();
  return cmdForeground(cfg, { runForeground, classify, exit }).then(() => ({ classify, exit }));
}

describe("cmdForeground", () => {
  it("P1: a successful start never classifies and never exits", async () => {
    const { classify, exit } = await run(async () => {}, { kind: "free" });
    expect(classify).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it("X3: HTTP EADDRINUSE while the desktop app's server answers → already-running verdict, exit 1", async () => {
    const { classify, exit } = await run(
      async () => { throw Object.assign(new Error("listen EADDRINUSE"), { code: "EADDRINUSE" }); },
      { kind: "owned", pid: 77, launchSource: "electron", bootParentAlive: true, bootParentPid: 5 },
    );
    expect(classify).toHaveBeenCalledTimes(1);
    expect(out.join("\n")).toContain("Dashboard server is already running (pid 77)");
    expect(out.join("\n")).toMatch(/desktop app/i);
    expect(err.join("\n")).not.toContain("Failed to start dashboard");
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("X4: gateway wrapper error (EADDRINUSE in cause) on a foreign-held port → port-conflict lines, exit 1", async () => {
    const { exit } = await run(
      async () => { throw new Error("gateway fallback failed", { cause: { code: "EADDRINUSE" } }); },
      { kind: "conflict" },
    );
    expect(err.join("\n")).toContain("is occupied by another service");
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("X5: an unrelated failure on a free port → generic message with the error, exit 1", async () => {
    const { exit } = await run(async () => { throw new Error("boom"); }, { kind: "free" });
    const e = err.join("\n");
    expect(e).toContain("Failed to start dashboard:");
    expect(e).toContain("boom");
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("a classifier that itself throws falls back to the generic message, exit 1", async () => {
    const exit = vi.fn();
    await cmdForeground(cfg, {
      runForeground: async () => { throw new Error("boom"); },
      classify: async () => { throw new Error("probe died"); },
      exit,
    });
    expect(err.join("\n")).toContain("Failed to start dashboard:");
    expect(exit).toHaveBeenCalledWith(1);
  });
});
