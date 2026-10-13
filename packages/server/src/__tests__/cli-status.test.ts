/**
 * `pi-dashboard status` reports the RESOLVED port, with `start`'s ownership
 * rules. See change: harden-dashboard-start-detection (D8; test-plan E13-E15, X2-unit).
 */

import type { DashboardStatus } from "@blackbelt-technology/pi-dashboard-shared/server-identity.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cmdStatus } from "../cli.js";
import { classifyDashboardPort } from "../lifecycle/classify-dashboard-port.js";
import type { LockMetadata } from "../lifecycle/home-lock.js";

const P = 18555;
const cfg = { port: P, piPort: 18556, host: "" };

let out: string[];
beforeEach(() => {
  out = [];
  vi.spyOn(console, "log").mockImplementation((...a) => { out.push(a.join(" ")); });
  vi.spyOn(console, "error").mockImplementation((...a) => { out.push(a.join(" ")); });
});
afterEach(() => vi.restoreAllMocks());
const text = () => out.join("\n");

const record = (port: number, host = "localhost") =>
  ({ host, port, pid: 1, isLocal: true }) as never;

function run(opts: {
  mdns?: unknown[];
  probe?: (host: string) => DashboardStatus;
  localId?: string | null;
  meta?: LockMetadata | null;
  pidFile?: number | null;
  alive?: boolean;
}) {
  const exit = vi.fn();
  const done = cmdStatus(cfg, {
    discover: (async () => opts.mdns ?? []) as never,
    classify: (c) =>
      classifyDashboardPort(c, {
        probe: async (_p, host) => (opts.probe ?? (() => ({ running: false })))(host),
        readLockMeta: () => opts.meta ?? null,
        peekInstanceId: () => opts.localId ?? null,
        isProcessAlive: () => opts.alive ?? true,
      }),
    readPid: () => opts.pidFile ?? null,
    isProcessAlive: () => opts.alive ?? true,
    exit,
  });
  return done.then(() => exit);
}

describe("cmdStatus", () => {
  it("E13: an mDNS record on another port is ignored — 'not running', exit 1, port 8000 not mentioned", async () => {
    const exit = await run({ mdns: [record(8000)] });
    expect(text()).toMatch(/Dashboard server is not running/);
    expect(text()).not.toContain("8000");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("E14: a same-port dashboard with no ownership evidence is 'not owned by this HOME', exit 1", async () => {
    const exit = await run({
      mdns: [record(P)],
      probe: (h) => (h === "127.0.0.1" ? { running: true, pid: 4, instanceId: "X" } : { running: false }),
    });
    expect(text()).toMatch(/not owned by this HOME/);
    expect(text()).toContain("pid 4");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("E15: an owned dashboard found via mDNS → running (pid N) on port P, with the hostname, exit 0", async () => {
    const exit = await run({
      mdns: [record(P, "h.local")],
      localId: "ID",
      probe: (h) => (h === "127.0.0.1" ? { running: true, pid: 4, instanceId: "ID" } : { running: false }),
    });
    expect(text()).toMatch(new RegExp(`Dashboard server is running \\(pid 4\\) on port ${P}`));
    expect(text()).toContain("h.local");
    expect(exit).not.toHaveBeenCalled();
  });

  it("an owned dashboard without any mDNS record is still running", async () => {
    const exit = await run({
      localId: "ID",
      probe: (h) => (h === "::1" ? { running: true, pid: 5, instanceId: "ID" } : { running: false }),
    });
    expect(text()).toMatch(new RegExp(`running \\(pid 5\\) on port ${P}`));
    expect(exit).not.toHaveBeenCalled();
  });

  it("an mDNS record whose health stays silent is 'running but not responding', never 'running' (exit 1)", async () => {
    const exit = await run({
      mdns: [record(P, "h.local")],
      probe: () => ({ running: false, timedOut: true }),
      meta: { pid: 6, ppid: 1, httpPort: P, piPort: 1, startedAt: 1, identity: "i", version: "v", url: "u", hostname: "h" },
    });
    expect(text()).toMatch(/running but not responding \(pid 6\)/);
    expect(text()).not.toMatch(/discovered via mDNS/);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("an unresponsive port with no lock pid falls back to a live server.pid for the message", async () => {
    const exit = await run({ probe: () => ({ running: false, timedOut: true }), pidFile: 77 });
    expect(text()).toMatch(/running but not responding \(pid 77\)/);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("a dashboard still starting reports starting, exit 0", async () => {
    const exit = await run({
      meta: { pid: 8, ppid: 1, httpPort: P, piPort: 1, startedAt: Date.now() - 1000, identity: "i", version: "v", url: "u", hostname: "h" },
    });
    expect(text()).toMatch(/starting \(pid 8\)/);
    expect(exit).not.toHaveBeenCalled();
  });

  it("a failing mDNS discovery does not affect the verdict", async () => {
    const exit = vi.fn();
    await cmdStatus(cfg, {
      discover: (async () => { throw new Error("mdns down"); }) as never,
      classify: async () => ({ kind: "free" }),
      exit,
    });
    expect(text()).toMatch(/not running/);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
