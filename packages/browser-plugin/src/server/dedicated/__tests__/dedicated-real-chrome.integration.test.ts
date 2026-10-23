/**
 * REAL Chrome behind the dedicated proxy (change: add-dedicated-agent-browser,
 * test-plan #I2): launch the dashboard-owned Chrome, drive it with Playwright
 * `connectOverCDP` THROUGH the proxy, then stop it.
 *
 * Observable: no listening TCP socket anywhere in Chrome's process tree (the pipe
 * is the only control channel), the page navigates, and after stop no process with
 * the dedicated `--user-data-dir` remains.
 *
 * Skipped with a clear reason when no Chrome binary resolves, when the host has no
 * display (`no-display`), or when the process tooling (`ps`/`lsof`) is missing. Uses
 * a temp config dir (never the real `~/.pi/dashboard`), and its `afterEach` kills any
 * leftover process on that directory, so it cannot leave a Chrome behind.
 */
import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { spawn as sharedSpawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { AuditRing } from "../../audit.js";
import { dedicatedAvailability, resolveChromeBinary } from "../../capability.js";
import { RelayManager } from "../../relay/relay-manager.js";
import { type ChromeChildLike, DedicatedChrome } from "../chrome-process.js";
import { HiddenTargets } from "../hidden-targets.js";

const exec = promisify(execFile);
const silent = { info: () => {}, warn: () => {}, error: () => {} };

const binary = resolveChromeBinary();
const availability = dedicatedAvailability();
const hasTools = process.platform !== "win32" && spawnSync("lsof", ["-v"], { stdio: "ignore" }).status !== null && spawnSync("ps", ["-o", "pid=", "-p", String(process.pid)], { stdio: "ignore" }).status === 0;

const skipReason = !binary
  ? "no Google Chrome binary resolves on this host"
  : !availability.available
    ? `dedicated browser unavailable: ${availability.reason}`
    : !hasTools
      ? "ps/lsof not available (win32 or minimal host)"
      : undefined;
if (skipReason) console.warn(`[#I2 skipped] ${skipReason}`);

interface Proc {
  pid: number;
  ppid: number;
  args: string;
}

async function listProcs(): Promise<Proc[]> {
  const { stdout } = await exec("ps", ["-axww", "-o", "pid=,ppid=,args="], { maxBuffer: 32 * 1024 * 1024 });
  const rows: Proc[] = [];
  for (const line of stdout.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), args: m[3] });
  }
  return rows;
}

const onDir = (procs: Proc[], dir: string): Proc[] => procs.filter((p) => p.args.includes(`--user-data-dir=${dir}`));

function descendants(procs: Proc[], root: number): number[] {
  const out = new Set<number>([root]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of procs) if (out.has(p.ppid) && !out.has(p.pid)) (out.add(p.pid), (grew = true));
  }
  return [...out];
}

/** `lsof` TCP listeners of the given pids (empty when none; `lsof` exits 1 on no match). */
async function tcpListeners(pids: number[]): Promise<string> {
  try {
    const { stdout } = await exec("lsof", ["-nP", "-a", "-iTCP", "-sTCP:LISTEN", "-p", pids.join(",")], { maxBuffer: 8 * 1024 * 1024 });
    return stdout.trim();
  } catch (err) {
    const e = err as { code?: number; stdout?: string };
    if (e.code === 1) return (e.stdout ?? "").trim();
    throw err;
  }
}

/**
 * The package's test script runs vitest under a throw-away `HOME`. Chrome's network
 * service misbehaves there on macOS (navigations never commit — verified by launching
 * the same argv with only HOME changed), so the CHILD gets the real home. Its profile
 * is still the temp `--user-data-dir`, so nothing under the real home is written.
 */
const realHome = os.userInfo().homedir;
const spawnWithRealHome = (command: string, args: string[], options: { stdio: unknown; detached: boolean; windowsHide: boolean }): ChromeChildLike =>
  sharedSpawn(command, args, { ...options, env: { ...process.env, HOME: realHome, USERPROFILE: realHome } } as never) as unknown as ChromeChildLike;

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) {
    try {
      await fn();
    } catch {
      /* best effort */
    }
  }
}, 40_000);

describe.skipIf(skipReason !== undefined)("#I2 real Chrome: no TCP debugging socket, page navigates, nothing left after stop", () => {
  it("launches, serves Playwright through the proxy, and leaves no process behind", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "dedicated-real-"));
    const configDir = path.join(home, ".pi", "dashboard");
    const chrome = new DedicatedChrome({ resolveBinary: () => binary, spawn: spawnWithRealHome, getDashboardConfigDir: () => configDir });
    const dataDir = chrome.dataDir;
    cleanups.push(async () => {
      // Safety net: whatever happened, nothing may keep running on this directory.
      await chrome.stop().catch(() => {});
      for (const p of onDir(await listProcs(), dataDir)) {
        try {
          process.kill(p.pid, "SIGKILL");
        } catch {
          /* gone */
        }
      }
      fs.rmSync(home, { recursive: true, force: true });
    });

    const manager = new RelayManager({
      audit: new AuditRing(),
      logger: silent,
      getConfig: () => ({ enabled: true }),
      getPort: () => 0,
      canOpenChrome: () => true,
      listProfiles: async () => ({ profiles: [] }),
      onStatusChange: () => {},
      dedicated: { chrome, hidden: new HiddenTargets(), availability: () => availability },
    });

    // a local page to navigate to (http: is allowed on the dedicated profile)
    const web = http.createServer((_req, res) => {
      res.setHeader("content-type", "text/html");
      res.end("<!doctype html><title>dedicated-ok</title><p>hello</p>");
    });
    await new Promise<void>((r) => web.listen(0, "127.0.0.1", r));
    cleanups.push(() => new Promise<void>((r) => web.close(() => r())));
    const pageUrl = `http://127.0.0.1:${(web.address() as AddressInfo).port}/`;

    // host the proxy endpoint with `ws` (the production route is the core's upgrade handler)
    const proxy = http.createServer();
    const wss = new WebSocketServer({ server: proxy });
    wss.on("connection", (ws, req) => {
      const guid = new URL(req.url ?? "", "http://x").pathname.split("/").pop() as string;
      manager.attachCdp(guid, ws as never);
    });
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
    cleanups.push(async () => {
      for (const c of wss.clients) c.terminate();
      wss.close();
      await new Promise<void>((r) => proxy.close(() => r()));
    });
    const proxyPort = (proxy.address() as AddressInfo).port;

    const conn = await manager.connectDedicated({ client: "i2" });
    if (!conn.ok) throw new Error(`dedicated connect failed: ${JSON.stringify(conn)}`);
    const url = `ws://127.0.0.1:${proxyPort}/ws/browser-cdp/${new URL(conn.cdpUrl).pathname.split("/").pop()}`;
    expect(chrome.state()).toBe("running");

    const procs = await listProcs();
    const browserProc = onDir(procs, dataDir).find((p) => p.args.includes("--remote-debugging-pipe") && !p.args.includes("--type="));
    expect(browserProc, "the dedicated Chrome browser process (pipe flag + dedicated dir)").toBeDefined();
    expect(browserProc?.args).not.toContain("--remote-debugging-port");
    expect(browserProc?.args).not.toContain("--headless");

    const { chromium } = await import("playwright-core");
    const browser = await chromium.connectOverCDP(url, { timeout: 30_000 });
    try {
      const page = await browser.contexts()[0].newPage();
      await page.goto(pageUrl, { timeout: 20_000 });
      expect(await page.title()).toBe("dedicated-ok");

      // No listening TCP socket in Chrome's whole process tree: the pipe is the only control channel.
      const tree = descendants(await listProcs(), browserProc!.pid);
      expect(tree.length).toBeGreaterThan(1); // browser + helpers
      const listeners = await tcpListeners(tree);
      expect(listeners, `Chrome tree pids ${tree.join(",")} listen on TCP:\n${listeners}`).toBe("");
      expect(fs.existsSync(path.join(dataDir, "DevToolsActivePort"))).toBe(false); // advertises a port only with --remote-debugging-port
    } finally {
      await browser.close().catch(() => {});
    }

    // Stop: Browser.close, then (if needed) the group kill. Nothing may remain on the directory.
    await manager.stopDedicated();
    expect(chrome.state()).toBe("stopped");
    const deadline = Date.now() + 15_000;
    let left = onDir(await listProcs(), dataDir);
    while (left.length > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
      left = onDir(await listProcs(), dataDir);
    }
    expect(left.map((p) => p.pid), "processes still running on the dedicated --user-data-dir").toEqual([]);
  }, 90_000);
});

// A visible reason in the report when the real-Chrome row cannot run (vitest shows skipped tests).
describe.skipIf(skipReason === undefined)("#I2 real Chrome (skipped)", () => {
  it.skip(`skipped: ${skipReason}`, () => {});
});
