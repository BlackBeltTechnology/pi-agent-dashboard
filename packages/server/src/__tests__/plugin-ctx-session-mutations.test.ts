/**
 * Host ctx session-mutation capabilities: `ctx.renameSession` (D1-#4),
 * `ctx.assignSessionRef` (D1-#5), and `ctx.onShutdown` (D1-#8).
 *
 * The capabilities are closures inside `createServer`, so these scenarios boot
 * the REAL server with FAKE plugins (per-file HOME installed-plugins dir →
 * helpers/plugin-host-harness) and drive `ctx.*` directly. Sessions register
 * over a real bridge WS; broadcasts are observed on a real browser WS.
 *
 * Covers test-plan #E8–#E14, #X3, #X7 (mutations) and #E17, #X4 (shutdown
 * dispatch ordering, exemplar shutdown-terminates-any-strategy.test.ts).
 *
 * See change: relocate-goal-product-to-plugin.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { installFakePlugin, pluginCtx } from "./helpers/plugin-host-harness.js";

// Stop-marker: records when the pi gateway is torn down so the shutdown-sub
// dispatch ORDER can be asserted behaviorally (subs must run BEFORE it).
const g = vi.hoisted(() => ({ markers: [] as string[] }));
vi.mock("../pi/pi-gateway.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../pi/pi-gateway.js")>();
  type Gateway = ReturnType<typeof mod.createPiGateway>;
  return {
    ...mod,
    createPiGateway: (...args: Parameters<typeof mod.createPiGateway>): Gateway => {
      const gw = mod.createPiGateway(...args);
      const writable = gw as { stop: Gateway["stop"] };
      const origStop = writable.stop.bind(gw);
      writable.stop = (...a: Parameters<Gateway["stop"]>) => {
        g.markers.push("pi-stop");
        return origStop(...a);
      };
      return gw;
    },
  };
});

// X3 fault-injection: make the NEXT mergeSessionMeta write throw (EACCES-like).
const m = vi.hoisted(() => ({ failNextMetaWrite: false }));
vi.mock("@blackbelt-technology/pi-dashboard-shared/session-meta.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@blackbelt-technology/pi-dashboard-shared/session-meta.js")>();
  return {
    ...mod,
    mergeSessionMeta: (...args: Parameters<typeof mod.mergeSessionMeta>) => {
      if (m.failNextMetaWrite) {
        m.failNextMetaWrite = false;
        throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
      }
      return mod.mergeSessionMeta(...args);
    },
  };
});

import { createServer, type DashboardServer } from "../server.js";

const TRUSTED_ID = "fake-trusted-mutator";
const UNTRUSTED_ID = "fake-untrusted-mutator";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.on("open", () => resolve());
    ws.on("error", reject);
    setTimeout(() => reject(new Error("open timeout")), 3000);
  });
}

interface CtxHarness {
  server: DashboardServer;
  httpPort: number;
  piPort: number;
  dataDir: string;
  sessionFile: string;
  metaFile: string;
  bridge: WebSocket;
  browser: WebSocket;
  sessionUpdates: Array<{ sessionId: string; updates: Record<string, unknown> }>;
}

/** Boot the server, register session s1 (with a sessionFile), open a browser listener. */
async function setupHarness(): Promise<CtxHarness> {
  const server = await createServer({
    port: 0,
    piPort: 0,
    host: "127.0.0.1",
    dev: true,
    autoShutdown: false,
    shutdownIdleSeconds: 999,
    tunnel: false,
  });
  await server.start();
  const httpPort = server.httpPort()!;
  const piPort = server.piPort()!;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-ctx-mutations-"));
  const sessionFile = path.join(dataDir, "s1.jsonl");
  fs.writeFileSync(sessionFile, "");

  const bridge = new WebSocket(`ws://127.0.0.1:${piPort}`);
  await waitForOpen(bridge);
  bridge.send(
    JSON.stringify({ type: "session_register", sessionId: "s1", cwd: dataDir, source: "cli" }),
  );
  await delay(200);
  // Seed the sidecar path the routes/link paths would have derived from pi.
  (server as unknown as { sessionManager: { update(id: string, u: object): void } }).sessionManager.update("s1", { sessionFile });

  const browser = new WebSocket(`ws://127.0.0.1:${httpPort}/ws`);
  await waitForOpen(browser);
  const sessionUpdates: CtxHarness["sessionUpdates"] = [];
  browser.on("message", (raw) => {
    try {
      const msg = JSON.parse(String(raw)) as { type?: string; sessionId?: string; updates?: Record<string, unknown> };
      if (msg.type === "session_updated" && msg.sessionId && msg.updates) {
        sessionUpdates.push({ sessionId: msg.sessionId, updates: msg.updates });
      }
    } catch { /* non-JSON frame */ }
  });
  await delay(100);

  return { server, httpPort, piPort, dataDir, sessionFile, metaFile: path.join(dataDir, "s1.meta.json"), bridge, browser, sessionUpdates };
}

async function teardownHarness(h: CtxHarness | undefined): Promise<void> {
  if (!h) return;
  h.bridge.close();
  h.browser.close();
  await h.server.stop();
  fs.rmSync(h.dataDir, { recursive: true, force: true });
}

function readMeta(metaFile: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(metaFile, "utf-8")) as Record<string, unknown>;
}

describe("ctx.renameSession (D1-#4)", () => {
  let h: CtxHarness | undefined;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    installFakePlugin({ id: TRUSTED_ID, priority: 100 });
    installFakePlugin({ id: UNTRUSTED_ID, priority: 1000 });
  });

  beforeEach(async () => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    h = await setupHarness();
  });
  afterEach(async () => {
    await teardownHarness(h);
    warnSpy.mockRestore();
  });

  it("E8: trusted rename updates memory, broadcasts once, dispatches rename_session to pi once", async () => {
    const ok = pluginCtx(TRUSTED_ID).renameSession("s1", "goal: ship");
    expect(ok).toBe(true);
    await delay(100);
    const viaCtx = pluginCtx(TRUSTED_ID).sessionManager.getSession("s1") as { name?: string } | undefined;
    expect(viaCtx?.name).toBe("goal: ship");
    const updates = h!.sessionUpdates.filter((u) => u.sessionId === "s1" && "name" in u.updates);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.updates.name).toBe("goal: ship");
    // pi side: the bridge socket receives the rename_session dispatch.
    const bridgeFrames: unknown[] = [];
    h!.bridge.on("message", (raw) => bridgeFrames.push(JSON.parse(String(raw))));
    pluginCtx(TRUSTED_ID).renameSession("s1", "goal: ship again");
    await delay(100);
    const renames = bridgeFrames.filter((f) => (f as { type?: string }).type === "rename_session");
    expect(renames).toHaveLength(1);
  });

  it("E9: untrusted / unknown session / empty name all return false with no side effects", async () => {
    const ctx = pluginCtx(TRUSTED_ID);
    const untrusted = pluginCtx(UNTRUSTED_ID);
    expect(untrusted.renameSession("s1", "nope")).toBe(false);
    expect(ctx.renameSession("s-unknown", "nope")).toBe(false);
    expect(ctx.renameSession("s1", "")).toBe(false);
    await delay(100);
    expect(h!.sessionUpdates).toEqual([]);
  });

  it("X7: rename still applies in memory + broadcast when the pi socket is gone", async () => {
    h!.bridge.close();
    await delay(300); // socket closes; session stays registered within the reconnect grace
    const ok = pluginCtx(TRUSTED_ID).renameSession("s1", "after death");
    expect(ok).toBe(true);
    await delay(100);
    const viaCtx = pluginCtx(TRUSTED_ID).sessionManager.getSession("s1") as { name?: string } | undefined;
    expect(viaCtx?.name).toBe("after death");
    expect(h!.sessionUpdates.some((u) => u.updates.name === "after death")).toBe(true);
  });
});

describe("ctx.assignSessionRef (D1-#5)", () => {
  let h: CtxHarness | undefined;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    installFakePlugin({ id: TRUSTED_ID, priority: 100 });
    installFakePlugin({ id: UNTRUSTED_ID, priority: 1000 });
  });

  beforeEach(async () => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    h = await setupHarness();
  });
  afterEach(async () => {
    await teardownHarness(h);
    warnSpy.mockRestore();
  });

  it("E10: persist (default) writes memory + .meta.json + one broadcast", async () => {
    const ok = pluginCtx(TRUSTED_ID).assignSessionRef("s1", { goalId: "g1" });
    expect(ok).toBe(true);
    await delay(100);
    const viaCtx = pluginCtx(TRUSTED_ID).sessionManager.getSession("s1") as { goalId?: string } | undefined;
    expect(viaCtx?.goalId).toBe("g1");
    expect(readMeta(h!.metaFile).goalId).toBe("g1");
    const updates = h!.sessionUpdates.filter((u) => u.sessionId === "s1" && "goalId" in u.updates);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.updates.goalId).toBe("g1");
  });

  it("E11: undefined clears the key at every persisted layer", async () => {
    expect(pluginCtx(TRUSTED_ID).assignSessionRef("s1", { goalId: "g1" })).toBe(true);
    await delay(50);
    h!.sessionUpdates.length = 0;
    const ok = pluginCtx(TRUSTED_ID).assignSessionRef("s1", { goalId: undefined });
    expect(ok).toBe(true);
    await delay(100);
    const viaCtx = pluginCtx(TRUSTED_ID).sessionManager.getSession("s1") as { goalId?: string } | undefined;
    expect(viaCtx?.goalId).toBeUndefined();
    // JSON drops undefined keys — the sidecar no longer carries the key.
    expect("goalId" in readMeta(h!.metaFile)).toBe(false);
    const updates = h!.sessionUpdates.filter((u) => u.sessionId === "s1" && u.updates.goalId === undefined);
    expect(updates).toHaveLength(1);
  });

  it("E12: persist:false is memory-only — meta keeps the old key, no broadcast", async () => {
    expect(pluginCtx(TRUSTED_ID).assignSessionRef("s1", { goalId: "g1" })).toBe(true);
    await delay(50);
    h!.sessionUpdates.length = 0;
    const ok = pluginCtx(TRUSTED_ID).assignSessionRef("s1", { goalId: undefined }, { persist: false });
    expect(ok).toBe(true);
    await delay(100);
    const viaCtx = pluginCtx(TRUSTED_ID).sessionManager.getSession("s1") as { goalId?: string } | undefined;
    expect(viaCtx?.goalId).toBeUndefined();
    expect(readMeta(h!.metaFile).goalId).toBe("g1"); // C2e: restart rehydrates
    expect(h!.sessionUpdates).toEqual([]);
  });

  it("E13: core-reserved keys are sanitized away with a warn-once; owned keys still merge", async () => {
    const ok = pluginCtx(TRUSTED_ID).assignSessionRef("s1", {
      status: "ended",
      name: "x",
      goalId: "g1",
    });
    expect(ok).toBe(true);
    await delay(100);
    const viaCtx = pluginCtx(TRUSTED_ID).sessionManager.getSession("s1") as { status?: string; name?: string; goalId?: string } | undefined;
    expect(viaCtx?.status).not.toBe("ended");
    expect(viaCtx?.name).toBeUndefined();
    expect(viaCtx?.goalId).toBe("g1");
    expect(readMeta(h!.metaFile).goalId).toBe("g1");
    expect(warnSpy).toHaveBeenCalled();
  });

  it("E14: untrusted caller / unknown session return false with no writes", async () => {
    const untrusted = pluginCtx(UNTRUSTED_ID);
    expect(untrusted.assignSessionRef("s1", { goalId: "g1" })).toBe(false);
    expect(pluginCtx(TRUSTED_ID).assignSessionRef("s-unknown", { goalId: "g1" })).toBe(false);
    await delay(100);
    expect(() => readMeta(h!.metaFile)).toThrow(); // never written
    expect(h!.sessionUpdates).toEqual([]);
  });

  it("X3: a failing meta write degrades to warn-only; memory + broadcast still apply", async () => {
    m.failNextMetaWrite = true;
    const ok = pluginCtx(TRUSTED_ID).assignSessionRef("s1", { goalId: "g1" });
    expect(ok).toBe(true);
    await delay(100);
    const viaCtx = pluginCtx(TRUSTED_ID).sessionManager.getSession("s1") as { goalId?: string } | undefined;
    expect(viaCtx?.goalId).toBe("g1");
    expect(h!.sessionUpdates.some((u) => u.updates.goalId === "g1")).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe("ctx.onShutdown dispatch (D1-#8)", () => {
  let server: DashboardServer;

  beforeAll(() => {
    installFakePlugin({ id: TRUSTED_ID, priority: 100 });
  });

  beforeEach(async () => {
    g.markers.length = 0;
    server = await createServer({
      port: 0,
      piPort: 0,
      host: "127.0.0.1",
      dev: true,
      autoShutdown: false,
      shutdownIdleSeconds: 999,
      tunnel: false,
    });
    await server.start();
  });
  afterEach(async () => {
    g.markers.length = 0;
    // stop() already ran in the tests that drive it explicitly; stop() is
    // guarded server-side against double-stop by the idle timer wiring.
  });

  it("E17: subs run exactly once, before piGateway.stop(); unsubscribe prevents invocation", async () => {
    const ctx = pluginCtx(TRUSTED_ID);
    const ran: string[] = [];
    ctx.onShutdown(() => ran.push("sub-1"));
    const unsub = ctx.onShutdown(() => ran.push("sub-2"));
    unsub();
    await server.stop();
    expect(ran).toEqual(["sub-1"]);
    expect(g.markers).toContain("pi-stop");
    expect(ran.length).toBeGreaterThan(0);
    // Ordering: every sub marker precedes the pi-stop marker.
    const piStopIdx = g.markers.indexOf("pi-stop");
    expect(piStopIdx).toBeGreaterThanOrEqual(0);
  });

  it("E17: dispatch happens BEFORE piGateway.stop() in the stop sequence", async () => {
    const ctx = pluginCtx(TRUSTED_ID);
    ctx.onShutdown(() => g.markers.push("sub"));
    await server.stop();
    expect(g.markers.indexOf("sub")).toBeLessThan(g.markers.indexOf("pi-stop"));
  });

  it("X4: a throwing sub is logged, never blocks the next sub or the shutdown", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = pluginCtx(TRUSTED_ID);
    const ran: string[] = [];
    ctx.onShutdown(() => {
      ran.push("thrower");
      throw new Error("sub exploded");
    });
    ctx.onShutdown(() => ran.push("after-thrower"));
    await expect(server.stop()).resolves.toBeUndefined();
    expect(ran).toEqual(["thrower", "after-thrower"]);
    expect(g.markers).toContain("pi-stop"); // gateway still torn down
    const logged = errSpy.mock.calls.flat().join(" ");
    expect(logged).toContain("[plugin-onShutdown]");
    errSpy.mockRestore();
  });
});
