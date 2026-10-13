/**
 * `pi-dashboard start`: the exact `launchDashboardServer` call shape (test-plan
 * #E16 of cleanup-stale-fork-specs) and the classify-then-launch-then-confirm
 * protocol (harden-dashboard-start-detection D4; test-plan E3, E4, E8, E11,
 * E12, X15, X16, X17).
 *
 * The CLI hands the shared primitive its cliPath, extra args, log file,
 * readiness deadline, starter and port, and supplies NO `env` (the primitive
 * owns the PATH-augmented env merge).
 */
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EarlyExitError, PortConflictError } from "@blackbelt-technology/pi-dashboard-shared/server-launcher.js";

const { launchDashboardServer } = vi.hoisted(() => ({
  launchDashboardServer: vi.fn(async (_opts: unknown) => ({ childPid: 4242, reportedPid: 4242, healthOk: true as const })),
}));
vi.mock("@blackbelt-technology/pi-dashboard-shared/server-launcher.js", async (orig) => ({
  ...(await orig<typeof import("@blackbelt-technology/pi-dashboard-shared/server-launcher.js")>()),
  launchDashboardServer,
}));

import { cmdStart } from "../cli.js";
import { classifyDashboardPort, type PortClassification } from "../lifecycle/classify-dashboard-port.js";
import type { ServerConfig } from "../server.js";

const P = 18555;
const config = { port: P, piPort: 18556, dev: false, tunnel: false, host: "" } as ServerConfig;

let out: string[];
let err: string[];
beforeEach(() => {
  out = [];
  err = [];
  launchDashboardServer.mockClear();
  launchDashboardServer.mockImplementation(async () => ({ childPid: 4242, reportedPid: 4242, healthOk: true as const }));
  vi.spyOn(console, "log").mockImplementation((...a) => { out.push(a.join(" ")); });
  vi.spyOn(console, "error").mockImplementation((...a) => { err.push(a.join(" ")); });
});
afterEach(() => vi.restoreAllMocks());
const all = () => [...out, ...err].join("\n");

/** classify() that answers from a script, one verdict per call. */
const script = (...v: PortClassification[]) => {
  const q = [...v];
  return vi.fn(async () => q.shift() ?? q[q.length - 1] ?? ({ kind: "free" } as PortClassification));
};
const FREE: PortClassification = { kind: "free" };
const mk = (over: Record<string, unknown> = {}) => ({
  classify: script(FREE),
  killProcess: vi.fn(async () => true),
  isProcessAlive: vi.fn(() => true),
  exit: vi.fn(),
  ...over,
}) as never;

describe("pi-dashboard start → launchDashboardServer call shape (E16)", () => {
  it("passes cliPath, extraArgs, stdio.logFile, healthTimeoutMs, starter, port and no env", async () => {
    const cfg = { port: 8123, piPort: 9999, dev: false, tunnel: false } as ServerConfig;
    await cmdStart(cfg, mk({ classify: script(FREE, { kind: "owned", pid: 4242 }) }));

    expect(launchDashboardServer).toHaveBeenCalledTimes(1);
    const arg = (launchDashboardServer.mock.calls[0] as unknown[])[0] as Record<string, unknown> & {
      stdio: { logFile: string };
    };
    expect(arg.cliPath).toMatch(/cli\.ts$/);
    expect(arg.extraArgs).toEqual(["--port", "8123", "--no-tunnel"]);
    expect(arg.stdio.logFile).toMatch(/server\.log$/);
    expect(arg.healthTimeoutMs).toBe(30_000);
    expect(arg.starter).toBe("Standalone");
    expect(arg.port).toBe(8123);
    expect(arg).not.toHaveProperty("env");
  });
});

describe("pre-launch classification", () => {
  it.each([
    ["owned", { kind: "owned", pid: 9 } as PortClassification, /already running \(pid 9\)/, 0],
    ["starting", { kind: "starting", pid: 9 } as PortClassification, /starting \(pid 9\)/, 0],
    ["unowned", { kind: "unowned-dashboard", pid: 9 } as PortClassification, /not owned by this HOME/, 1],
    ["unresponsive", { kind: "unresponsive", pid: 9 } as PortClassification, /running but not responding \(pid 9\)/, 1],
  ])("%s → no spawn", async (_n, verdict, line, code) => {
    const exit = vi.fn();
    await cmdStart(config, mk({ classify: script(verdict), exit }));
    expect(launchDashboardServer).not.toHaveBeenCalled();
    expect(all()).toMatch(line);
    if (code === 0) expect(exit).not.toHaveBeenCalled();
    else expect(exit).toHaveBeenCalledWith(1);
  });

  it("unresponsive without a known pid omits it and names `pi-dashboard stop`", async () => {
    await cmdStart(config, mk({ classify: script({ kind: "unresponsive", pid: undefined }) }));
    expect(all()).toMatch(/running but not responding on port/);
    expect(all()).toMatch(/pi-dashboard stop/);
  });

  it("unowned names the port and the pid of the dashboard that answered", async () => {
    await cmdStart(config, mk({ classify: script({ kind: "unowned-dashboard", pid: 31 }) }));
    expect(all()).toContain(`Port ${P}`);
    expect(all()).toContain("pid 31");
  });
});

describe("classifier-backed scenarios (real classifier, real sockets / stubbed fetch)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  async function freePort(): Promise<number> {
    return new Promise((resolve) => {
      const s = net.createServer();
      s.listen(0, "127.0.0.1", () => {
        const { port } = s.address() as net.AddressInfo;
        s.close(() => resolve(port));
      });
    });
  }

  it("E3: a foreign HTTP service on the port is a conflict — message, exit 1, no launch", async () => {
    const srv = http.createServer((_req, res) => { res.setHeader("content-type", "application/json"); res.end('{"foo":1}'); });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const port = (srv.address() as net.AddressInfo).port;
    const exit = vi.fn();
    try {
      await cmdStart({ ...config, port }, {
        classify: (c) => classifyDashboardPort(c, { readLockMeta: () => null, peekInstanceId: () => null }),
        exit,
      });
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
    expect(all()).toMatch(/occupied by another service/);
    expect(exit).toHaveBeenCalledWith(1);
    expect(launchDashboardServer).not.toHaveBeenCalled();
  });

  it("E4: a stale server.pid naming an unrelated live process does not block start, and is not removed by classification", async () => {
    const home = process.env.HOME as string;
    const pidFile = path.join(home, ".pi", "dashboard", "server.pid");
    fs.mkdirSync(path.dirname(pidFile), { recursive: true });
    fs.writeFileSync(pidFile, `${process.pid}\n`); // a live, unrelated pid
    const port = await freePort();
    await cmdStart({ ...config, port }, {
      classify: (c) => classifyDashboardPort(c, { readLockMeta: () => null, peekInstanceId: () => null }),
      isProcessAlive: () => false,
      exit: vi.fn(),
    });
    expect(launchDashboardServer).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(pidFile, "utf-8")).toBe(`${process.pid}\n`);
    fs.rmSync(pidFile, { force: true });
  });

  it("E8: a slow first answer is not 'not running' — already running, exactly 2 probe attempts, no launch", async () => {
    const abort = Object.assign(new Error("t"), { name: "AbortError" });
    const refused = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    let v4 = 0;
    globalThis.fetch = vi.fn(async (url: unknown) => {
      if (String(url).includes("[::1]")) throw refused;
      v4 += 1;
      if (v4 === 1) throw abort;
      return { ok: true, json: async () => ({ ok: true, pid: 88, instanceId: "ID" }) } as Response;
    }) as never;
    const exit = vi.fn();
    await cmdStart(config, {
      classify: (c) => classifyDashboardPort(c, { readLockMeta: () => null, peekInstanceId: () => "ID", sleep: async () => {} }),
      exit,
    });
    expect(all()).toMatch(/already running \(pid 88\)/);
    expect(exit).not.toHaveBeenCalled();
    expect(launchDashboardServer).not.toHaveBeenCalled();
    expect(v4).toBe(2);
  });
});

describe("post-launch confirmation", () => {
  it("E11: started only when the classifier sees the spawned pid", async () => {
    launchDashboardServer.mockResolvedValue({ childPid: 111, reportedPid: 111, healthOk: true });
    const killProcess = vi.fn(async () => true);
    const exit = vi.fn();
    await cmdStart(config, mk({ classify: script(FREE, { kind: "owned", pid: 111 }), killProcess, exit }));
    expect(out.join("\n")).toMatch(/Dashboard server started \(pid 111\)/);
    expect(killProcess).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it("E12: a launch that loses to an existing dashboard is not 'started'; the spawned child is killed", async () => {
    launchDashboardServer.mockResolvedValue({ childPid: 111, reportedPid: 222, healthOk: true });
    const killProcess = vi.fn(async () => true);
    const exit = vi.fn();
    await cmdStart(config, mk({ classify: script(FREE, { kind: "owned", pid: 222 }), killProcess, isProcessAlive: () => true, exit }));
    expect(all()).not.toMatch(/started/);
    expect(out.join("\n")).toMatch(/already running \(pid 222\)/);
    expect(killProcess).toHaveBeenCalledWith(111, expect.any(String));
    expect(exit).not.toHaveBeenCalled();
  });

  it("an already-exited child is not killed", async () => {
    launchDashboardServer.mockResolvedValue({ childPid: 111, reportedPid: 222, healthOk: true });
    const killProcess = vi.fn(async () => true);
    await cmdStart(config, mk({ classify: script(FREE, { kind: "owned", pid: 222 }), killProcess, isProcessAlive: () => false }));
    expect(killProcess).not.toHaveBeenCalled();
  });

  it("X17: an unconfirmed child is terminated BEFORE the verdict is printed", async () => {
    launchDashboardServer.mockResolvedValue({ childPid: 111, reportedPid: 111, healthOk: true });
    const order: string[] = [];
    const killProcess = vi.fn(async () => { order.push("kill"); return true; });
    vi.spyOn(console, "error").mockImplementation((...a) => { order.push("print"); err.push(a.join(" ")); });
    const exit = vi.fn();
    await cmdStart(config, mk({ classify: script(FREE, { kind: "unresponsive", pid: undefined }), killProcess, exit }));
    expect(killProcess).toHaveBeenCalledWith(111, expect.any(String));
    expect(order[0]).toBe("kill");
    expect(all()).toMatch(/running but not responding/);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("a child that vanished without ever being served is a failure with a log pointer", async () => {
    launchDashboardServer.mockResolvedValue({ childPid: 111, reportedPid: 111, healthOk: true });
    const exit = vi.fn();
    await cmdStart(config, mk({ classify: script(FREE, FREE), isProcessAlive: () => false, exit }));
    expect(err.join("\n")).toMatch(/Check logs at/);
    expect(all()).not.toMatch(/started|already running/);
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe("early exit of the spawned child", () => {
  it("X15: a crashing launch is a failure — log pointer, exit 1, no started / already running", async () => {
    launchDashboardServer.mockRejectedValue(new EarlyExitError(1, null));
    const exit = vi.fn();
    await cmdStart(config, mk({ classify: script(FREE, FREE), exit }));
    expect(err.join("\n")).toMatch(/Check logs at/);
    expect(all()).not.toMatch(/Dashboard server started|already running/);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("X16: losing the bind race to this HOME's dashboard reports it (exit 0)", async () => {
    launchDashboardServer.mockRejectedValue(new EarlyExitError(1, null));
    const exit = vi.fn();
    await cmdStart(config, mk({ classify: script(FREE, { kind: "owned", pid: 333 }), exit }));
    expect(out.join("\n")).toMatch(/already running \(pid 333\)/);
    expect(exit).not.toHaveBeenCalled();
  });

  it("an `EADDRINUSE` early exit onto a still-starting dashboard reports starting (exit 0)", async () => {
    launchDashboardServer.mockRejectedValue(new EarlyExitError(1, null));
    const exit = vi.fn();
    await cmdStart(config, mk({ classify: script(FREE, { kind: "starting", pid: 5 }), exit }));
    expect(out.join("\n")).toMatch(/starting \(pid 5\)/);
    expect(exit).not.toHaveBeenCalled();
  });

  it("a port-conflict exit onto a foreign service keeps the port-conflict message (exit 1)", async () => {
    launchDashboardServer.mockRejectedValue(new PortConflictError(P));
    const exit = vi.fn();
    await cmdStart(config, mk({ classify: script(FREE, { kind: "conflict" }), exit }));
    expect(err.join("\n")).toMatch(/occupied by another service/);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("a non-exit launch error (e.g. readiness timeout) is a failure with a log pointer", async () => {
    launchDashboardServer.mockRejectedValue(new Error("timed out"));
    const exit = vi.fn();
    await cmdStart(config, mk({ exit }));
    expect(err.join("\n")).toMatch(/timed out/);
    expect(err.join("\n")).toMatch(/Check logs at/);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
