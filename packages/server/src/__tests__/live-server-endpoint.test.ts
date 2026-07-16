/**
 * `POST /api/live-server/start` SSRF gate + proxy registration.
 * See change: improve-content-editor (tasks §6.1, §6.2).
 */
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLiveServerManager } from "../live-server-manager.js";
import { registerLiveServerRoutes } from "../routes/live-server-routes.js";
import { registerLiveServerProxy } from "../live-server-proxy.js";

function fakePrefs() {
  let store: any[] = [];
  return {
    getLiveServers: () => store,
    setLiveServers: (t: any[]) => {
      store = t;
    },
  } as any;
}

function makeApp() {
  const app = Fastify({ logger: false });
  const manager = createLiveServerManager(fakePrefs());
  registerLiveServerRoutes(app, manager, { networkGuard: async () => undefined });
  // Do NOT register `@fastify/reply-from` here: `registerLiveServerProxy`
  // self-registers it (Option A). Registering it in the test would mask a
  // regression where the proxy loses its `reply.from` dependency — exactly the
  // failure that shipped when the editor proxy was deleted.
  registerLiveServerProxy(app, manager);
  return { app, manager };
}

describe("POST /api/live-server/start", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = makeApp().app;
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });

  const start = (body: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/api/live-server/start", payload: body });

  it("accepts a loopback target and returns the proxied path", async () => {
    const res = await start({ host: "127.0.0.1", port: 5173, label: "vite" });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.host).toBe("127.0.0.1");
    expect(data.port).toBe(5173);
    expect(data.path).toBe(`/live/${data.id}/`);
  });

  it("rejects the cloud-metadata host with 400 (SSRF)", async () => {
    const res = await start({ host: "169.254.169.254", port: 80 });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a remote host with 400 (SSRF)", async () => {
    const res = await start({ host: "example.com", port: 8080 });
    expect(res.statusCode).toBe(400);
  });

  it("is idempotent by host:port", async () => {
    const a = (await start({ host: "localhost", port: 3000 })).json().data;
    const b = (await start({ host: "localhost", port: 3000 })).json().data;
    expect(a.id).toBe(b.id);
    const list = (await app.inject({ method: "GET", url: "/api/live-server/list" })).json().data.servers;
    expect(list).toHaveLength(1);
  });

  it("proxy returns 404 for an unregistered id", async () => {
    const res = await app.inject({ method: "GET", url: "/live/deadbeef/" });
    expect(res.statusCode).toBe(404);
  });
});

describe("live-server allowlist persistence (§6.4)", () => {
  it("drops persisted non-loopback targets on load (SSRF gate on seed)", () => {
    // Simulate a hand-edited preferences.json with a malicious remote entry.
    let store: any[] = [
      { id: "good", label: "vite", host: "127.0.0.1", port: 5173 },
      { id: "evil", label: "x", host: "169.254.169.254", port: 80 },
      { id: "", label: "noid", host: "localhost", port: 3000 },
      null, // hand-edited garbage — must not crash construction
      "not-an-object",
    ];
    const prefs = {
      getLiveServers: () => store,
      setLiveServers: (t: any[]) => {
        store = t;
      },
    } as any;
    const m = createLiveServerManager(prefs);
    const list = m.list();
    expect(list.map((t) => t.id)).toEqual(["good"]);
    expect(m.get("evil")).toBeUndefined();
    // Store was canonicalized (invalid entries dropped) on load.
    expect(store.map((t) => t.id)).toEqual(["good"]);
  });

  it("bare re-start does not clobber a previously-set custom label", () => {
    let store: any[] = [];
    const prefs = {
      getLiveServers: () => store,
      setLiveServers: (t: any[]) => {
        store = t;
      },
    } as any;
    const m = createLiveServerManager(prefs);
    m.start({ host: "127.0.0.1", port: 5173, label: "My Dev" });
    m.start({ host: "127.0.0.1", port: 5173 }); // no label
    expect(m.list()[0].label).toBe("My Dev");
  });

  it("survives a manager reload from the same preferences store", () => {
    let store: any[] = [];
    const prefs = {
      getLiveServers: () => store,
      setLiveServers: (t: any[]) => {
        store = t;
      },
    } as any;
    const m1 = createLiveServerManager(prefs);
    const started = m1.start({ host: "127.0.0.1", port: 4321, label: "docs" });
    expect(started.ok).toBe(true);
    // New manager built from the same (now-populated) store sees the target.
    const m2 = createLiveServerManager(prefs);
    expect(m2.list()).toHaveLength(1);
    expect(m2.list()[0].port).toBe(4321);
  });
});
