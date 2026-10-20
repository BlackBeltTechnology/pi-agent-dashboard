/**
 * `POST /api/live-server/start` SSRF gate + proxy registration.
 * See change: improve-content-editor (tasks §6.1, §6.2).
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNetworkGuardHook, type GuardDenialLogEntry } from "../auth/localhost-guard.js";
import { createRouteTierGate } from "../auth/route-tier-gate.js";
import {
  CAPABILITY_IDLE_MS,
  CAPABILITY_MAX_MS,
  type CapabilityPrincipal,
  createLiveCapabilityHook,
  LiveCapabilityStore,
  parseCapabilityPath,
  sessionKeyOf,
} from "../live-server/live-capability.js";
import type { LiveServerManager } from "../live-server/live-server-manager.js";
import { createLiveServerManager } from "../live-server/live-server-manager.js";
import { registerLiveServerProxy } from "../live-server/live-server-proxy.js";
import { registerLiveServerRoutes } from "../routes/live-server-routes.js";

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

// ─── live-preview capability path (change: retire-trusted-networks-bypass, D5) ───

const REMOTE = "203.0.113.5"; // not loopback, not trusted: only a credential admits
const TOKEN_RE = /^[A-Za-z0-9_-]{22,}$/;
const T0 = 1_700_000_000_000;
const MIN = 60_000;

/** Registry-backed manager stub: `vite-5173` + `docs-8080` registered. */
function stubManager(ids: string[] = ["vite-5173", "docs-8080"]) {
  const targets = new Map(ids.map((id) => [id, { id, label: id, host: "127.0.0.1", port: Number(id.split("-")[1]) }]));
  const manager = {
    start: () => ({ ok: false as const, error: "unused" }),
    startPreset: () => ({ ok: false as const, error: "unused" }),
    startStatic: () => ({ ok: false as const, error: "unused" }),
    get: (id: string) => targets.get(id),
    getStatic: () => undefined,
    has: (id: string) => targets.has(id),
    list: () => [...targets.values()],
    remove: (id: string) => {
      targets.delete(id);
    },
    use: () => {},
    setEvictionListener: () => {},
  } satisfies LiveServerManager;
  return { manager, targets };
}

interface CapApp {
  app: FastifyInstance;
  store: LiveCapabilityStore;
  clock: { now: number };
  devices: Set<string>;
  sessions: Set<string>;
  denials: GuardDenialLogEntry[];
  targets: Map<string, unknown>;
}

/**
 * Production-ordered hooks: capability hook → (fixture bearer/session) → tier
 * gate → universal guard. `x-test-principal: observe|control` models a device
 * bearer of that tier (`authVia=device`), `x-test-device` names it.
 */
async function makeCapApp(): Promise<CapApp> {
  const clock = { now: T0 };
  const { manager, targets } = stubManager();
  const devices = new Set<string>(["dev-A", "dev-B"]);
  const sessions = new Set<string>();
  const store = new LiveCapabilityStore({
    now: () => clock.now,
    isTargetLive: (id) => manager.get(id) !== undefined,
    isPrincipalLive: (p) => {
      if (p.kind === "device") return devices.has(p.deviceId ?? "");
      if (p.kind === "session") return p.sessionKey !== undefined && sessions.has(p.sessionKey);
      return true;
    },
  });
  const denials: GuardDenialLogEntry[] = [];
  const app = Fastify({ logger: false });
  app.decorateRequest("isAuthenticated", false);
  app.addHook("onRequest", createLiveCapabilityHook(store));
  app.addHook("onRequest", async (req) => {
    const tier = req.headers["x-test-principal"];
    if (typeof tier === "string") {
      (req as any).isAuthenticated = true;
      (req as any).authVia = "device";
      (req as any).principalTier = tier;
      (req as any).principalDeviceId = (req.headers["x-test-device"] as string) ?? "dev-A";
    }
  });
  app.addHook("onRequest", createRouteTierGate({ getTrustedNetworks: () => [], logRefusal: () => {} }));
  app.addHook(
    "onRequest",
    createNetworkGuardHook({ trustedNetworks: () => [], logDenial: (e) => denials.push(e) }),
  );
  registerLiveServerRoutes(app, manager, { networkGuard: async () => undefined, capabilities: store });
  // Stand-ins for the guarded namespaces the capability must (not) open.
  app.get("/api/sessions", async () => ({ ok: true, route: "sessions" }));
  app.all("/live/:id/*", async (req) => ({ ok: true, via: (req as any).authVia ?? null }));
  await app.ready();
  return { app, store, clock, devices, sessions, denials, targets };
}

const mintAs = (c: CapApp, tier: "observe" | "control", id = "vite-5173") =>
  c.app.inject({
    method: "POST",
    url: `/api/live-server/${id}/capability`,
    remoteAddress: REMOTE,
    headers: { "x-test-principal": tier },
  });

describe("E20 — POST /api/live-server/:id/capability (mint)", () => {
  let c: CapApp;
  beforeEach(async () => {
    c = await makeCapApp();
  });
  afterEach(async () => {
    await c.app.close();
  });

  it("observe principal → 403 insufficient_scope, no token created", async () => {
    const res = await mintAs(c, "observe");
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "insufficient_scope", scope: "control" });
    expect(res.headers["www-authenticate"]).toContain("insufficient_scope");
    expect(c.store.size()).toBe(0);
  });

  it("control principal → 200 flat {path, expiresAt = now+12h}, token ≥22 base64url", async () => {
    const res = await mintAs(c, "control");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.expiresAt).toBe(T0 + 12 * 60 * MIN);
    const m = /^\/live\/vite-5173\/~c\/([^/]+)\/$/.exec(body.path);
    expect(m).not.toBeNull();
    const token = m![1];
    expect(token).toMatch(TOKEN_RE);
    // Store keeps only a hash: the plaintext is not a key, but it validates.
    expect(c.store.size()).toBe(1);
    expect(c.store.holdsPlaintext(token)).toBe(false);
    expect(c.store.validate("vite-5173", token)).not.toBeNull();
  });

  it("each mint yields a distinct token", async () => {
    const a = (await mintAs(c, "control")).json().path;
    const b = (await mintAs(c, "control")).json().path;
    expect(a).not.toBe(b);
    expect(c.store.size()).toBe(2);
  });

  it("unknown id `nope` → 404, no token created", async () => {
    const res = await mintAs(c, "control", "nope");
    expect(res.statusCode).toBe(404);
    expect(c.store.size()).toBe(0);
  });

  it("credential-less remote caller is refused by the universal guard, no token", async () => {
    const res = await c.app.inject({
      method: "POST",
      url: "/api/live-server/vite-5173/capability",
      remoteAddress: REMOTE,
    });
    expect(res.statusCode).toBe(403);
    expect(c.store.size()).toBe(0);
  });

  it("minted capability records the minting device for later revocation", async () => {
    const res = await c.app.inject({
      method: "POST",
      url: "/api/live-server/vite-5173/capability",
      remoteAddress: REMOTE,
      headers: { "x-test-principal": "control", "x-test-device": "dev-B" },
    });
    const token = /~c\/([^/]+)\//.exec(res.json().path)![1];
    expect(c.store.validate("vite-5173", token)).toMatchObject({ kind: "device", deviceId: "dev-B", tier: "control" });
  });
});

describe("E21 — capability path matching", () => {
  let c: CapApp;
  let t: string;
  beforeEach(async () => {
    c = await makeCapApp();
    t = c.store.mint("vite-5173", { kind: "local" }).token;
  });
  afterEach(async () => {
    await c.app.close();
  });

  const table = (tok: string): Array<[string, string, boolean]> => [
    ["valid", `/live/vite-5173/~c/${tok}/`, true],
    ["valid with rest + query", `/live/vite-5173/~c/${tok}/src/main.ts?x=1`, true],
    ["other target", `/live/docs-8080/~c/${tok}/`, false],
    ["token + suffix", `/live/vite-5173/~c/${tok}evil/`, false],
    ["encoded ~ (%7E)", `/live/vite-5173/%7Ec/${tok}/`, false],
    ["encoded ~ (%7e)", `/live/vite-5173/%7ec/${tok}/`, false],
    ["encoded slash before token", `/live/vite-5173/~c%2F${tok}/`, false],
    ["dot-segment before capability", `/live/vite-5173/x/../~c/${tok}/`, false],
    ["dot-segment after capability", `/live/vite-5173/~c/${tok}/../../x/`, false],
    ["encoded dot-segment in rest", `/live/vite-5173/~c/${tok}/%2e%2e/api/sessions`, false],
    ["encoded slash in rest", `/live/vite-5173/~c/${tok}/a%2Fb`, false],
    ["no trailing slash", `/live/vite-5173/~c/${tok}`, false],
    ["no trailing slash + query", `/live/vite-5173/~c/${tok}?x=1`, false],
    ["token in query of an API path", `/api/sessions?c=${tok}`, false],
    ["token as API path segment", `/api/sessions/~c/${tok}/`, false],
  ];

  it("parseCapabilityPath + store admit only the exact form", () => {
    for (const [name, url, admitted] of table(t)) {
      const parsed = parseCapabilityPath(url);
      const principal = parsed ? c.store.validate(parsed.targetId, parsed.token) : null;
      expect(principal !== null, name).toBe(admitted);
    }
  });

  it("parse yields upstream rest without the capability segment", () => {
    expect(parseCapabilityPath(`/live/vite-5173/~c/${t}/src/main.ts?x=1`)).toMatchObject({
      targetId: "vite-5173",
      token: t,
      prefix: `/live/vite-5173/~c/${t}`,
      rest: "/src/main.ts?x=1",
    });
    expect(parseCapabilityPath(`/live/vite-5173/~c/${t}/`)?.rest).toBe("/");
  });

  // `inject` normalizes dot-segments (WHATWG URL) before the hooks see them, so
  // the end-to-end leg uses a real socket and a raw request line. The
  // forwarding header makes the loopback peer a relayed (not genuine-local) caller.
  it("end-to-end (raw request line): only the valid path is admitted, the rest get 403 from the guard", async () => {
    await c.app.listen({ port: 0, host: "127.0.0.1" });
    const port = (c.app.server.address() as AddressInfo).port;
    const get = (path: string) =>
      new Promise<number>((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, path, method: "GET", headers: { "x-forwarded-for": REMOTE } }, (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        });
        req.on("error", reject);
        req.end();
      });
    for (const [name, url, admitted] of table(t)) {
      expect(await get(url), name).toBe(admitted ? 200 : 403);
    }
  });

  it("admission is stamped as live-capability and scoped to the prefix route", async () => {
    const res = await c.app.inject({ method: "GET", url: `/live/vite-5173/~c/${t}/x`, remoteAddress: REMOTE });
    expect(res.json()).toEqual({ ok: true, via: "live-capability" });
  });

  it("a valid capability does not open an API route even with the token in its path", async () => {
    const res = await c.app.inject({ method: "GET", url: `/api/sessions?c=${t}`, remoteAddress: REMOTE });
    expect(res.statusCode).toBe(403);
  });
});

describe("E22 — capability lifetime (fake clock)", () => {
  const principal: CapabilityPrincipal = { kind: "local" };
  let clock = T0;
  const mk = () => new LiveCapabilityStore({ now: () => clock });
  beforeEach(() => {
    clock = T0;
  });

  it("idle 29:59 is admitted and extends the idle window", () => {
    const s = mk();
    const { token } = s.mint("vite-5173", principal);
    clock += 30 * MIN - 1_000;
    expect(s.validate("vite-5173", token)).not.toBeNull();
    // Extended: another 29:59 after the last use is still fine (59:58 since mint).
    clock += 30 * MIN - 1_000;
    expect(s.validate("vite-5173", token)).not.toBeNull();
  });

  it("idle exactly 30:00 is refused (and stays refused)", () => {
    const s = mk();
    const { token } = s.mint("vite-5173", principal);
    clock += CAPABILITY_IDLE_MS;
    expect(s.validate("vite-5173", token)).toBeNull();
    clock -= 1; // time cannot un-expire a dropped token
    expect(s.validate("vite-5173", token)).toBeNull();
  });

  it("continuous use up to 12 h − 1 ms is admitted; at 12 h it is refused", () => {
    const s = mk();
    const { token, expiresAt } = s.mint("vite-5173", principal);
    expect(expiresAt).toBe(T0 + CAPABILITY_MAX_MS);
    while (clock - T0 < CAPABILITY_MAX_MS - 20 * MIN) {
      clock += 20 * MIN;
      expect(s.validate("vite-5173", token)).not.toBeNull();
    }
    clock = T0 + CAPABILITY_MAX_MS - 1;
    expect(s.validate("vite-5173", token)).not.toBeNull();
    clock = T0 + CAPABILITY_MAX_MS; // idle is 1 ms — only the absolute cap refuses
    expect(s.validate("vite-5173", token)).toBeNull();
  });

  it("an expired token is swept and does not count toward size", () => {
    const s = mk();
    s.mint("vite-5173", principal);
    clock += CAPABILITY_MAX_MS;
    s.mint("vite-5173", principal); // mint sweeps
    expect(s.size()).toBe(1);
  });
});

describe("E23 — capability invalidation", () => {
  let c: CapApp;
  beforeEach(async () => {
    c = await makeCapApp();
  });
  afterEach(async () => {
    await c.app.close();
  });

  const use = (token: string, id = "vite-5173") =>
    c.app.inject({ method: "GET", url: `/live/${id}/~c/${token}/x`, remoteAddress: REMOTE });

  it("removing the target (DELETE route) kills its tokens, not other targets'", async () => {
    const a = c.store.mint("vite-5173", { kind: "local" }).token;
    const b = c.store.mint("docs-8080", { kind: "local" }).token;
    expect((await use(a)).statusCode).toBe(200);
    const del = await c.app.inject({ method: "DELETE", url: "/api/live-server/vite-5173", remoteAddress: REMOTE, headers: { "x-test-principal": "operate" } });
    expect(del.statusCode).toBe(200);
    expect((await use(a)).statusCode).toBe(403);
    expect((await use(b, "docs-8080")).statusCode).toBe(200);
  });

  it("a target dropped without the route (isTargetLive) is refused on next use", async () => {
    const a = c.store.mint("vite-5173", { kind: "local" }).token;
    c.targets.delete("vite-5173");
    expect((await use(a)).statusCode).toBe(403);
  });

  it("revoking device A refuses its tokens next use, device B's stay valid", async () => {
    const a = c.store.mint("vite-5173", { kind: "device", tier: "control", deviceId: "dev-A" }).token;
    const b = c.store.mint("vite-5173", { kind: "device", tier: "control", deviceId: "dev-B" }).token;
    expect((await use(a)).statusCode).toBe(200);
    c.devices.delete("dev-A"); // isPrincipalLive false
    expect((await use(a)).statusCode).toBe(403);
    expect((await use(b)).statusCode).toBe(200);
  });

  it("revokeByDevice drops exactly that device's tokens", () => {
    const a = c.store.mint("vite-5173", { kind: "device", deviceId: "dev-A" }).token;
    const b = c.store.mint("vite-5173", { kind: "device", deviceId: "dev-B" }).token;
    c.store.revokeByDevice("dev-A");
    expect(c.store.validate("vite-5173", a)).toBeNull();
    expect(c.store.validate("vite-5173", b)).not.toBeNull();
  });

  it("logging out session S (revokeBySessionKey) refuses its tokens, session T's stay", async () => {
    const keyS = sessionKeyOf("cookie-S");
    const keyT = sessionKeyOf("cookie-T");
    c.sessions.add(keyS).add(keyT);
    const s = c.store.mint("vite-5173", { kind: "session", tier: "control", sessionKey: keyS }).token;
    const t = c.store.mint("vite-5173", { kind: "session", tier: "control", sessionKey: keyT }).token;
    expect((await use(s)).statusCode).toBe(200);
    c.store.revokeBySessionKey(keyS);
    expect((await use(s)).statusCode).toBe(403);
    expect((await use(t)).statusCode).toBe(200);
  });

  it("a session no longer live (isPrincipalLive) is refused without an explicit revoke", async () => {
    const key = sessionKeyOf("cookie-S");
    c.sessions.add(key);
    const s = c.store.mint("vite-5173", { kind: "session", sessionKey: key }).token;
    c.sessions.delete(key);
    expect((await use(s)).statusCode).toBe(403);
  });

  it("an expired identity (identityExpiresAt) is refused via isPrincipalLive wiring", () => {
    const clock = { now: T0 };
    const store = new LiveCapabilityStore({
      now: () => clock.now,
      isPrincipalLive: (p) => p.identityExpiresAt === undefined || p.identityExpiresAt > clock.now,
    });
    const { token } = store.mint("vite-5173", { kind: "local", identityExpiresAt: T0 + 5 * MIN });
    clock.now += 5 * MIN - 1;
    expect(store.validate("vite-5173", token)).not.toBeNull();
    clock.now += 1;
    expect(store.validate("vite-5173", token)).toBeNull();
  });

  it("a new store instance (restart) holds no tokens: the old one is refused", async () => {
    const token = c.store.mint("vite-5173", { kind: "local" }).token;
    const fresh = new LiveCapabilityStore();
    expect(fresh.validate("vite-5173", token)).toBeNull();
    expect(fresh.size()).toBe(0);
  });
});

describe("LiveCapabilityStore bounds (audit)", () => {
  it("a mint loop evicts only the minting principal's own oldest tokens", async () => {
    const { LiveCapabilityStore } = await import("../live-server/live-capability.js");
    const store = new LiveCapabilityStore();
    const victim = store.mint("vite-5173", { kind: "device", deviceId: "victim", tier: "control" });
    const first = store.mint("vite-5173", { kind: "device", deviceId: "attacker", tier: "control" });
    for (let i = 0; i < 100; i++) store.mint("vite-5173", { kind: "device", deviceId: "attacker", tier: "control" });
    expect(store.validate("vite-5173", victim.token)).not.toBeNull();
    expect(store.validate("vite-5173", first.token)).toBeNull();
  });

  it("a network-trust token dies when the principal is no longer live (pair)", async () => {
    const { LiveCapabilityStore } = await import("../live-server/live-capability.js");
    let legacy = true;
    const store = new LiveCapabilityStore({ isPrincipalLive: (p) => p.kind !== "network" || legacy });
    const t = store.mint("vite-5173", { kind: "network" });
    expect(store.validate("vite-5173", t.token)).not.toBeNull();
    legacy = false;
    expect(store.validate("vite-5173", t.token)).toBeNull();
  });
});
