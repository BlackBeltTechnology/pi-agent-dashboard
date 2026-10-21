/**
 * REAL Chrome: an ephemeral dedicated instance's cookies are discarded with it (change:
 * add-gmail-auto-setup, test-plan #I1; exemplar `dedicated-real-chrome.integration.test.ts`).
 *
 * A local http server sets a cookie, then reports the `Cookie` header of every later request.
 *   1. ephemeral instance: `/set`, then `/probe` → the cookie IS sent (control: the test can see it);
 *   2. disconnect, connect normally → `/probe` carries no cookie;
 *   3. connect ephemerally again → `/probe` carries no cookie.
 * The client speaks raw CDP through the proxy (as the gmail plugin does), so it also pins that the
 * ephemeral client sees only its own context's targets and the normal one a different context.
 *
 * Skipped WITH A REASON when no Chrome binary resolves, when the host has no display, or when
 * `ps`/`lsof` are missing. Temp config dir only; `afterEach` kills any leftover process on it.
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
import WebSocket, { WebSocketServer } from "ws";
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
if (skipReason) console.warn(`[#I1 skipped] ${skipReason}`);

/** See `dedicated-real-chrome.integration.test.ts`: Chrome's network service needs the real HOME; the profile stays the temp dir. */
const realHome = os.userInfo().homedir;
const spawnWithRealHome = (command: string, args: string[], options: { stdio: unknown; detached: boolean; windowsHide: boolean }): ChromeChildLike =>
  sharedSpawn(command, args, { ...options, env: { ...process.env, HOME: realHome, USERPROFILE: realHome } } as never) as unknown as ChromeChildLike;

/** Minimal raw-CDP client over the proxy socket. */
class Cdp {
  private nextId = 1;
  private readonly waiting = new Map<number, (m: { result?: unknown; error?: { message: string } }) => void>();
  private readonly ws: WebSocket;
  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on("message", (data) => {
      const msg = JSON.parse(String(data)) as { id?: number; result?: unknown; error?: { message: string } };
      if (msg.id !== undefined) this.waiting.get(msg.id)?.(msg);
    });
  }
  static async open(url: string): Promise<Cdp> {
    const ws = new WebSocket(url); // no Origin header: the proxy refuses one
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    return new Cdp(ws);
  }
  call<T = Record<string, unknown>>(method: string, params?: object, sessionId?: string): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 20_000);
      this.waiting.set(id, (m) => {
        clearTimeout(timer);
        if (m.error) reject(new Error(`${method}: ${m.error.message}`));
        else resolve(m.result as T);
      });
      this.ws.send(JSON.stringify({ id, method, ...(params ? { params } : {}), ...(sessionId ? { sessionId } : {}) }));
    });
  }
  close(): void {
    this.ws.close();
  }
}

/** Create a tab and attach to it (the proxy's server session may need a moment to exist). */
async function openTab(cdp: Cdp): Promise<string> {
  const { targetId } = await cdp.call<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
  for (let i = 0; i < 20; i++) {
    try {
      return (await cdp.call<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true })).sessionId;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("could not attach to the created tab");
}

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

describe.skipIf(skipReason !== undefined)("#I1 real Chrome: an ephemeral context's cookies are discarded with the instance", () => {
  it("a cookie set in an ephemeral instance is absent from the normal context and from a new ephemeral one", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "dedicated-eph-"));
    const configDir = path.join(home, ".pi", "dashboard");
    const chrome = new DedicatedChrome({ resolveBinary: () => binary, spawn: spawnWithRealHome, getDashboardConfigDir: () => configDir });
    const dataDir = chrome.dataDir;
    cleanups.push(async () => {
      await chrome.stop().catch(() => {});
      const { stdout } = await exec("ps", ["-axww", "-o", "pid=,args="], { maxBuffer: 32 * 1024 * 1024 });
      for (const line of stdout.split("\n")) {
        const m = /^\s*(\d+)\s+(.*)$/.exec(line);
        if (m?.[2].includes(`--user-data-dir=${dataDir}`)) {
          try {
            process.kill(Number(m[1]), "SIGKILL");
          } catch {
            /* gone */
          }
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

    // the page: `/set` sets the cookie, every request's Cookie header is recorded
    const seen: Array<{ path: string; cookie: string | undefined }> = [];
    const web = http.createServer((req, res) => {
      seen.push({ path: req.url ?? "", cookie: req.headers.cookie });
      if (req.url === "/set") res.setHeader("set-cookie", "eph_sid=secret; Path=/");
      res.setHeader("content-type", "text/html");
      res.end("<!doctype html><title>t</title><p>x</p>");
    });
    await new Promise<void>((r) => web.listen(0, "127.0.0.1", r));
    cleanups.push(() => new Promise<void>((r) => web.close(() => r())));
    const base = `http://127.0.0.1:${(web.address() as AddressInfo).port}`;

    const proxy = http.createServer();
    const wss = new WebSocketServer({ server: proxy });
    wss.on("connection", (ws, req) => manager.attachCdp((req.url ?? "").split("/").pop() as string, ws as never));
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
    cleanups.push(async () => {
      for (const c of wss.clients) c.terminate();
      wss.close();
      await new Promise<void>((r) => proxy.close(() => r()));
    });
    const proxyPort = (proxy.address() as AddressInfo).port;

    const navigate = async (cdp: Cdp, sessionId: string, p: string): Promise<void> => {
      const before = seen.length;
      await cdp.call("Page.navigate", { url: `${base}${p}` }, sessionId);
      const deadline = Date.now() + 10_000;
      while (seen.slice(before).every((s) => s.path !== p) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    };

    /** Connect, open a tab, request `paths` in order; returns the targets the client sees + the cookie header the server saw on `/probe`. */
    async function session(opts: { ephemeral: boolean }, paths: string[]) {
      const conn = await manager.connectDedicated({ client: "i1", ephemeral: opts.ephemeral, private: opts.ephemeral });
      if (!conn.ok) throw new Error(`dedicated connect failed: ${JSON.stringify(conn)}`);
      const cdp = await Cdp.open(`ws://127.0.0.1:${proxyPort}/ws/browser-cdp/${conn.cdpUrl.split("/").pop()}`);
      try {
        const sessionId = await openTab(cdp);
        for (const p of paths) await navigate(cdp, sessionId, p);
        const { targetInfos } = await cdp.call<{ targetInfos: Array<{ targetId: string; browserContextId?: string }> }>("Target.getTargets");
        const probe = seen.filter((s) => s.path === "/probe").at(-1);
        return { instanceId: conn.instanceId, targetInfos, probeCookie: probe?.cookie, probed: probe !== undefined };
      } finally {
        cdp.close();
        manager.disconnect(conn.instanceId);
      }
    }

    // 1. control: inside the ephemeral instance the cookie is live
    const first = await session({ ephemeral: true }, ["/set", "/probe"]);
    expect(first.probed).toBe(true);
    expect(first.probeCookie).toContain("eph_sid=secret");
    expect(first.targetInfos).toHaveLength(1); // only the tab this client created: the default context's pages are not listed
    const ephemeralContext = first.targetInfos[0].browserContextId;
    expect(ephemeralContext).toBeTruthy();

    // 2. normal connect: not signed in, and a different (default) context
    const normal = await session({ ephemeral: false }, ["/probe"]);
    expect(normal.probed).toBe(true);
    expect(normal.probeCookie).toBeUndefined();
    expect(normal.targetInfos.some((t) => t.browserContextId === ephemeralContext)).toBe(false);

    // 3. a new ephemeral instance starts signed out, in a new context
    const second = await session({ ephemeral: true }, ["/probe"]);
    expect(second.probed).toBe(true);
    expect(second.probeCookie).toBeUndefined();
    expect(second.targetInfos[0].browserContextId).not.toBe(ephemeralContext);
  }, 120_000);
});

// A visible reason in the report when the real-Chrome row cannot run (vitest shows skipped tests).
describe.skipIf(skipReason === undefined)("#I1 real Chrome ephemeral discard (skipped)", () => {
  it.skip(`skipped: ${skipReason}`, () => {});
});
