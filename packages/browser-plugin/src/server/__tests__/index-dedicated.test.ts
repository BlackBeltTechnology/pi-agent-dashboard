/**
 * Server-entry wiring of the dedicated agent browser (change:
 * add-dedicated-agent-browser, tasks 6.1–6.3 wiring). Behaviour of each piece is
 * tested in its own file; this pins that the composition root registers the
 * `browser/connect` and `browser/await-state` handlers, surfaces `dedicated` +
 * `settings` on `GET /status`, and runs/stops the idle sweeper. It never lets the
 * policy reach a real Chrome (only `@headless` / an uninstalled profile are asked for).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ServerPluginContext, WsRouteRegistration } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import registerPlugin from "../index.js";

type Handler = (payload: unknown, meta: { sessionId: string }) => unknown;

let app: ReturnType<typeof Fastify>;
let requestHandlers: Map<string, Handler>;
let shutdown: Array<() => void>;
let provided: Map<string, unknown>;
let config: Record<string, unknown>;
let tmpHome: string;
const priorHome = process.env.HOME;
const priorUserProfile = process.env.USERPROFILE;

async function activate(initial: Record<string, unknown> = { enabled: true, browsers: {} }) {
  config = initial;
  requestHandlers = new Map();
  shutdown = [];
  provided = new Map();
  app = Fastify();
  const ctx = {
    fastify: app,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    getPluginConfig: () => config,
    updatePluginConfig: async (partial: Record<string, unknown>) => {
      Object.assign(config, partial);
    },
    broadcastToSubscribers: () => {},
    onShutdown: (fn: () => void) => shutdown.push(fn),
    registerWsRoute: (_scope: string, _opts: WsRouteRegistration) => {},
    registerBrowserHandler: () => {},
    registerPiRequestHandler: (type: string, handler: Handler) => requestHandlers.set(type, handler),
    openEditorTab: () => {},
    provide: (name: string, value: unknown) => provided.set(name, value),
  } as unknown as ServerPluginContext;
  await registerPlugin(ctx);
  await app.ready();
}

beforeEach(() => {
  // The dedicated data dir lives under the dashboard config dir: keep it in a temp HOME.
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "browser-index-"));
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
});
afterEach(async () => {
  vi.useRealTimers();
  for (const fn of shutdown) fn();
  await app?.close();
  process.env.HOME = priorHome;
  if (priorUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = priorUserProfile;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("dedicated wiring in the server entry", () => {
  it("registers browser/open, browser/connect and browser/await-state on the request lane", async () => {
    await activate();
    expect([...requestHandlers.keys()].sort()).toEqual(["browser/await-state", "browser/connect", "browser/open"]);
  });

  it("GET /status carries the dedicated block (state, dirs under the config dir) and the effective settings", async () => {
    await activate({ enabled: true, browsers: {}, idleDisconnectMinutes: 5 });
    const body = JSON.parse((await app.inject({ method: "GET", url: "/api/browser/status" })).body);
    expect(body.enabled).toBe(true);
    expect(typeof body.dedicated.available).toBe("boolean");
    expect(body.dedicated.state).toBe("not-created");
    expect(body.dedicated.dataDir).toBe(path.join(tmpHome, ".pi", "dashboard", "agent-chrome"));
    expect(body.dedicated.downloadsDir).toBe(path.join(tmpHome, ".pi", "dashboard", "agent-chrome-downloads"));
    expect(body.settings).toMatchObject({ defaultBrowser: "@dedicated", idleDisconnectMinutes: 5, onUnavailable: "ask" });
  });

  it("browser/connect runs the policy over the real manager: @headless yields a no-cdpUrl result", async () => {
    await activate();
    const result = (await requestHandlers.get("browser/connect")?.({ target: "@headless" }, { sessionId: "S" })) as Record<string, unknown>;
    expect(result).toMatchObject({ browser: "headless" });
    expect(result.cdpUrl).toBeUndefined();
  });

  it("browser/connect for an uninstalled profile answers `unavailable` (ask) and never launches a browser", async () => {
    await activate();
    const result = (await requestHandlers.get("browser/connect")?.({ target: "Profile 99" }, { sessionId: "S" })) as {
      unavailable: { target: string; reason: string };
      options: Array<{ target: string }>;
    };
    expect(result.unavailable).toEqual({ target: "Profile 99", reason: "not-installed" });
    expect(result.options.map((o) => o.target)).toContain("@dedicated");
    expect(fs.existsSync(path.join(tmpHome, ".pi", "dashboard", "agent-chrome"))).toBe(false); // nothing was launched
  });

  it("browser/await-state takes the session from the lane and validates the payload", async () => {
    await activate();
    const h = requestHandlers.get("browser/await-state") as Handler;
    expect(h({ instanceId: "inst-1", pending: true }, { sessionId: "S" })).toEqual({ ok: true });
    expect(h({ instanceId: "inst-1", pending: false }, { sessionId: "S" })).toEqual({ ok: true });
    expect(() => h({ pending: true }, { sessionId: "S" })).toThrow();
  });

  it("starts the idle sweeper at activation and stops it in onShutdown", async () => {
    vi.useFakeTimers();
    const before = vi.getTimerCount();
    await activate();
    const running = vi.getTimerCount();
    expect(running).toBeGreaterThan(before);
    for (const fn of shutdown) fn();
    expect(vi.getTimerCount()).toBeLessThan(running);
    shutdown = [];
  });
});

describe("browser.dedicated service wiring (change: add-gmail-auto-setup)", () => {
  type Service = {
    status(): Promise<{ enabled: boolean; available: boolean; downloadsDir: string }>;
    connect(opts: { client: string }): Promise<Record<string, unknown>>;
    open(opts: { url: string }): Promise<Record<string, unknown>>;
    focus(tabId: string): Promise<Record<string, unknown>>;
    tabOrigin(tabId: string): Promise<string | null>;
    disconnect(instanceId: string): Promise<void>;
  };
  const service = () => provided.get("browser.dedicated") as Service;

  it("provides browser.dedicated once, with every method of the contract", async () => {
    await activate();
    expect([...provided.keys()]).toEqual(["browser.dedicated"]);
    for (const m of ["status", "connect", "open", "focus", "tabOrigin", "disconnect"]) expect(typeof (service() as never)[m]).toBe("function");
  });

  it("status() reports the plugin enabled with the dedicated downloads dir; the kill switch turns enabled off", async () => {
    await activate();
    expect(await service().status()).toMatchObject({
      enabled: true,
      downloadsDir: path.join(tmpHome, ".pi", "dashboard", "agent-chrome-downloads"),
    });
    config.enabled = false;
    expect(await service().status()).toMatchObject({ enabled: false });
  });

  it("kill switch off → connect is {403, disabled} and nothing is launched", async () => {
    await activate({ enabled: false, browsers: {} });
    expect(await service().connect({ client: "gmail-setup" })).toMatchObject({ ok: false, status: 403, reason: "disabled" });
    expect(fs.existsSync(path.join(tmpHome, ".pi", "dashboard", "agent-chrome"))).toBe(false);
  });

  it("server shutdown unloads it: every method refuses {503, unloaded} afterwards", async () => {
    await activate();
    const s = service();
    for (const fn of shutdown) fn();
    shutdown = [];
    const unloaded = { ok: false, status: 503, reason: "unloaded" };
    expect(await s.connect({ client: "gmail-setup" })).toEqual(unloaded);
    expect(await s.open({ url: "https://accounts.google.com/" })).toEqual(unloaded);
    expect(await s.focus("T1")).toEqual(unloaded);
    expect(await s.tabOrigin("T1")).toBeNull();
    expect(await s.status()).toMatchObject({ enabled: false, available: false });
  });
});
