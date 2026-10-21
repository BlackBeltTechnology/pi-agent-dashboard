/**
 * Live-preview capability policy, exposure, start-static / policy / touch routes,
 * the CSP builder and the browser-originated request gate.
 *
 *  E11 start-static   E16 mint policy fail-closed   E17 static lifetimes + touch
 *  E18 mint tiers     E19 CSP builder               E21 exposure matrix
 *  E22 scripts × exposure                           X5 browser gate
 *  X6 local binding   X7 exposure flip revokes      2.11 log lines
 *
 * See change: improve-canvas-html-and-url-ux (test-plan E11, E16–E19, E21, E22, X5–X7).
 */
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { hasRouteTier, routeTier } from "@blackbelt-technology/pi-dashboard-shared/route-tiers.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNetworkGuardHook, isGuardJurisdiction } from "../auth/localhost-guard.js";
import { createRouteTierGate } from "../auth/route-tier-gate.js";
import { isBrowserOriginated } from "../live-server/live-browser-gate.js";
import {
  createLiveCapabilityHook,
  LiveCapabilityStore,
  principalKeyOf,
  STATIC_CAPABILITY_IDLE_MS,
  STATIC_CAPABILITY_MAX_MS,
} from "../live-server/live-capability.js";
import { buildLiveCsp } from "../live-server/live-csp.js";
import {
  computeExposure,
  createPreviewExposure,
  wirePreviewExposure,
} from "../live-server/live-exposure.js";
import { createLiveServerManager } from "../live-server/live-server-manager.js";
import { handleLiveServerUpgrade, registerLiveServerProxy } from "../live-server/live-server-proxy.js";
import { denialBody, gateFilePath } from "../routes/file-routes.js";
import { registerLiveServerRoutes } from "../routes/live-server-routes.js";

const REMOTE = "203.0.113.5";
const T0 = 1_700_000_000_000;
const MIN = 60_000;

const fakePrefs = () => {
  let store: any[] = [];
  return { getLiveServers: () => store, setLiveServers: (t: any[]) => (store = t) } as any;
};
const mkTmp = (prefix: string) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

// ─── E19: CSP builder ──────────────────────────────────────────────────────────

describe("E19 — CSP builder (design D3/D4)", () => {
  const base = {
    host: "dash.example:8000",
    scheme: "https" as const,
    prefix: "/live/abc12345/~c/TOKEN_TOKEN_TOKEN_TOKEN_1",
    granted: ["https://cdn.tailwindcss.com"],
  };
  const P = "https://dash.example:8000/live/abc12345/~c/TOKEN_TOKEN_TOKEN_TOKEN_1/";
  const directive = (csp: string, name: string) =>
    csp
      .split("; ")
      .find((d) => d === name || d.startsWith(`${name} `)) ?? "";

  it("restricted + scripts: exact directive set, no 'self' in any fetch directive", () => {
    const r = buildLiveCsp({ ...base, policy: { egress: "restricted", scripts: true } });
    expect(r).not.toBeNull();
    const csp = r!.csp;
    expect(directive(csp, "sandbox")).toBe("sandbox allow-scripts allow-forms");
    expect(directive(csp, "default-src")).toBe("default-src 'none'");
    expect(directive(csp, "script-src")).toBe(`script-src ${P} 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com`);
    expect(directive(csp, "style-src")).toBe(`style-src ${P} 'unsafe-inline' https://cdn.tailwindcss.com`);
    expect(directive(csp, "img-src")).toBe(`img-src ${P} data: blob: https://cdn.tailwindcss.com`);
    expect(directive(csp, "font-src")).toBe(`font-src ${P} data: https://cdn.tailwindcss.com`);
    expect(directive(csp, "media-src")).toBe(`media-src ${P} blob: https://cdn.tailwindcss.com`);
    expect(directive(csp, "connect-src")).toBe(
      `connect-src ${P} wss://dash.example:8000/live/abc12345/~c/TOKEN_TOKEN_TOKEN_TOKEN_1/ https://cdn.tailwindcss.com`,
    );
    expect(directive(csp, "worker-src")).toBe(`worker-src ${P} blob:`);
    for (const d of ["form-action", "base-uri", "frame-src", "object-src", "manifest-src"]) {
      expect(directive(csp, d)).toBe(`${d} 'none'`);
    }
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'self'");
    expect(directive(csp, "report-uri")).toBe("report-uri /live/abc12345/~c/TOKEN_TOKEN_TOKEN_TOKEN_1/__pi/csp-report");
    expect(r!.reportingEndpoints).toBe('csp="/live/abc12345/~c/TOKEN_TOKEN_TOKEN_TOKEN_1/__pi/csp-report"');
    // No dashboard-origin source anywhere: every `'self'` is the frame-ancestors one.
    expect(csp.match(/'self'/g)).toHaveLength(1);
    expect(csp).not.toContain("https://dash.example:8000 ");
  });

  it("restricted, scripts off: empty sandbox and no 'unsafe-eval'", () => {
    const csp = buildLiveCsp({ ...base, policy: { egress: "restricted", scripts: false } })!.csp;
    expect(directive(csp, "sandbox")).toBe("sandbox");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("an http dashboard yields http + ws prefix sources", () => {
    const csp = buildLiveCsp({ ...base, scheme: "http", policy: { egress: "restricted", scripts: true } })!.csp;
    expect(csp).toContain("script-src http://dash.example:8000/live/");
    expect(csp).toContain("ws://dash.example:8000/live/");
  });

  it("open: only sandbox + object-src + frame-ancestors (sandbox tokens by scripts)", () => {
    const on = buildLiveCsp({ ...base, policy: { egress: "open", scripts: true } })!;
    expect(on.csp).toBe(
      "sandbox allow-scripts allow-forms allow-popups allow-downloads; object-src 'none'; frame-ancestors 'self'",
    );
    expect(on.reportingEndpoints).toBeUndefined();
    const off = buildLiveCsp({ ...base, policy: { egress: "open", scripts: false } })!;
    expect(off.csp).toBe("sandbox; object-src 'none'; frame-ancestors 'self'");
  });

  it("refuses a Host that is not a plain host[:port], and drops a non-canonical granted origin", () => {
    expect(buildLiveCsp({ ...base, host: "evil.example; script-src *", policy: { egress: "restricted", scripts: true } })).toBeNull();
    expect(buildLiveCsp({ ...base, host: "a b", policy: { egress: "restricted", scripts: true } })).toBeNull();
    const csp = buildLiveCsp({
      ...base,
      granted: ["https://ok.example", "https://x.example; script-src *", "http://plain.example", "https://a.example/path"],
      policy: { egress: "restricted", scripts: true },
    })!.csp;
    expect(csp).toContain("https://ok.example");
    expect(csp).not.toContain("script-src *");
    expect(csp).not.toContain("plain.example");
    expect(csp).not.toContain("/path");
  });
});

// ─── E21: exposure predicate matrix ────────────────────────────────────────────

describe("E21 — exposure predicate", () => {
  const binds = ["127.0.0.1", "::1", "0.0.0.0", "192.168.1.5", "weird"];
  const endpointSets: Record<string, string[]> = {
    none: [],
    tunnel: ["https://x.share.zrok.io"],
    publicBaseUrls: ["https://dash.example"],
    tls: ["https://host.tail.ts.net:8443"],
  };
  const rows = binds.flatMap((bindHost) =>
    Object.entries(endpointSets).flatMap(([label, endpoints]) =>
      [false, true].flatMap((forwardedSeen) =>
        [undefined, "exposed"].map((configOverride) => ({ bindHost, label, endpoints, forwardedSeen, configOverride })),
      ),
    ),
  );
  it.each(rows)("bind=$bindHost endpoints=$label forwarded=$forwardedSeen override=$configOverride", (row) => {
    const { bindHost, label, endpoints, forwardedSeen, configOverride } = row;
    const local =
      (bindHost === "127.0.0.1" || bindHost === "::1") && label === "none" && !forwardedSeen && configOverride === undefined;
    // local-only only for loopback bind + no endpoints + not forwarded + auto; everything else exposed.
    expect(computeExposure({ bindHost, endpoints, forwardedSeen, configOverride })).toBe(local ? "local-only" : "exposed");
  });

  it("`localhost` and 127.x.x.x are loopback; an unparseable value is exposed", () => {
    const e = (bindHost: string) => computeExposure({ bindHost, endpoints: [], forwardedSeen: false });
    expect(e("localhost")).toBe("local-only");
    expect(e("127.0.0.2")).toBe("local-only");
    expect(e("[::1]")).toBe("local-only");
    expect(e("")).toBe("exposed");
    expect(e("::")).toBe("exposed");
  });

  it("epoch bumps on every change of the computed value, and a forwarded header is sticky", () => {
    let endpoints: string[] = [];
    const ex = createPreviewExposure({ getBindHost: () => "127.0.0.1", getEndpoints: () => endpoints });
    expect(ex.current()).toEqual({ exposure: "local-only", epoch: 1 });
    expect(ex.current().epoch).toBe(1);
    endpoints = ["https://t.example"];
    expect(ex.current()).toEqual({ exposure: "exposed", epoch: 2 });
    endpoints = [];
    expect(ex.current()).toEqual({ exposure: "local-only", epoch: 3 });
    ex.noteRequest({ host: "localhost" });
    expect(ex.current().exposure).toBe("local-only");
    ex.noteRequest({ "x-forwarded-for": "203.0.113.9" });
    expect(ex.current()).toEqual({ exposure: "exposed", epoch: 4 });
    ex.noteRequest({});
    expect(ex.current().exposure).toBe("exposed"); // sticky until restart
  });

  it("an input that throws fails closed", () => {
    const ex = createPreviewExposure({
      getBindHost: () => "127.0.0.1",
      getEndpoints: () => {
        throw new Error("boom");
      },
    });
    expect(ex.current().exposure).toBe("exposed");
  });
});

// ─── route harness ─────────────────────────────────────────────────────────────

interface Harness {
  app: FastifyInstance;
  clock: { now: number };
  store: LiveCapabilityStore;
  manager: ReturnType<typeof createLiveServerManager>;
  exposure: ReturnType<typeof createPreviewExposure>;
  setEndpoints(e: string[]): void;
  logs: string[];
  portId: string;
  staticId: string;
  cwd: string;
  devices: Set<string>;
  broadcasts: number[];
}

async function makeHarness(opts: { endpoints?: string[]; prompting?: boolean } = {}): Promise<Harness> {
  const clock = { now: T0 };
  const cwd = mkTmp("live-policy-cwd-");
  fs.mkdirSync(path.join(cwd, "mockups", "a"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "mockups", "a", "index.html"), "<h1>a</h1>");
  fs.writeFileSync(path.join(cwd, "mockups", "a", "style.css"), "body{}");
  const manager = createLiveServerManager(fakePrefs(), { ownPorts: () => [8000] });
  const port = manager.start({ host: "127.0.0.1", port: 5173, label: "vite" });
  if (!port.ok) throw new Error("start failed");
  const stat = manager.startStatic({ cwd, root: path.join(cwd, "mockups", "a") });
  if (!stat.ok) throw new Error("startStatic failed");
  const devices = new Set(["dev-A", "dev-B"]);
  const store = new LiveCapabilityStore({
    now: () => clock.now,
    isTargetLive: (id) => manager.has(id),
    isPrincipalLive: (p) => (p.kind === "device" ? devices.has(p.deviceId ?? "") : true),
  });
  let endpoints = opts.endpoints ?? [];
  const exposure = createPreviewExposure({ getBindHost: () => "127.0.0.1", getEndpoints: () => endpoints });
  const logs: string[] = [];
  const broadcasts: number[] = [];
  wirePreviewExposure({ exposure, capabilities: store, broadcast: (e) => broadcasts.push(e), log: (l) => logs.push(l) });

  const sessionManager = { listAll: () => [{ cwd }] } as any;
  const app = Fastify({ logger: false });
  app.decorateRequest("isAuthenticated", false);
  app.addHook("onRequest", async (req) => exposure.noteRequest(req.headers as Record<string, unknown>));
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
  app.addHook("onRequest", createNetworkGuardHook({ trustedNetworks: () => [], logDenial: () => {} }));
  registerLiveServerRoutes(app, manager, {
    networkGuard: async () => undefined,
    capabilities: store,
    exposure,
    promptingEnabled: () => opts.prompting === true,
    log: (l) => logs.push(l),
    staticGate: async (c, rel, o) => {
      const gate = await gateFilePath(c, rel, sessionManager, { allowGrant: true, disclosure: o.disclosure });
      if ("code" in gate) return { ok: false, status: gate.code, body: denialBody(gate) };
      return { ok: true, resolved: gate.resolved };
    },
  });
  app.all("/live/:id/*", async (req) => ({ ok: true, via: (req as any).authVia ?? null }));
  await app.ready();
  return {
    app,
    clock,
    store,
    manager,
    exposure,
    setEndpoints: (e) => {
      endpoints = e;
    },
    logs,
    portId: port.target.id,
    staticId: stat.target.id,
    cwd,
    devices,
    broadcasts,
  };
}

const mint = (h: Harness, id: string, body: Record<string, unknown> | undefined, tier: "observe" | "control" = "control", device = "dev-A") =>
  h.app.inject({
    method: "POST",
    url: `/api/live-server/${id}/capability`,
    remoteAddress: REMOTE,
    headers: { "x-test-principal": tier, "x-test-device": device },
    ...(body === undefined ? {} : { payload: body }),
  });

describe("live-server routes", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await makeHarness();
  });
  afterEach(async () => {
    await h.app.close();
    fs.rmSync(h.cwd, { recursive: true, force: true });
  });

  describe("E11 — POST /api/live-server/start-static", () => {
    const post = (payload: Record<string, unknown>) =>
      h.app.inject({ method: "POST", url: "/api/live-server/start-static", payload });

    it("an admitted in-cwd file registers: {id, entry, root}; the allowlist is untouched", async () => {
      const before = h.manager.list();
      const res = await post({ cwd: h.cwd, path: "mockups/a/index.html" });
      expect(res.statusCode).toBe(200);
      const b = res.json();
      expect(b).toMatchObject({ ok: true, success: true, id: h.staticId, entry: "index.html", root: path.join(h.cwd, "mockups", "a") });
      expect(h.manager.list()).toEqual(before);
      expect(h.manager.getStatic(b.id)).toBeDefined();
    });

    it("the entry is the root-relative path, encoded per segment", async () => {
      fs.mkdirSync(path.join(h.cwd, "mockups", "a", "my screens"), { recursive: true });
      fs.writeFileSync(path.join(h.cwd, "mockups", "a", "my screens", "b #1.html"), "<p/>");
      const res = await post({ cwd: h.cwd, path: "mockups/a/my screens/b #1.html" });
      expect(res.json().entry).toBe("my%20screens/b%20%231.html");
    });

    it("a file with no marker up to the cwd serves its own directory (no whole-cwd root)", async () => {
      fs.mkdirSync(path.join(h.cwd, "loose"), { recursive: true });
      fs.writeFileSync(path.join(h.cwd, "loose", "page.html"), "<p/>");
      const res = await post({ cwd: h.cwd, path: "loose/page.html" });
      expect(res.statusCode).toBe(200);
      expect(res.json().root).toBe(path.join(h.cwd, "loose"));
      expect(res.json().entry).toBe("page.html");
    });

    it("an outside file is refused with the raw-read gate's status and body; nothing registers", async () => {
      const res = await post({ cwd: h.cwd, path: "/etc/hosts" });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ success: false, error: "path outside working directory" });
      const unknown = await post({ cwd: "/not/a/session", path: "x.html" });
      expect(unknown.statusCode).toBe(403);
      expect(unknown.json()).toMatchObject({ success: false, error: "unknown session path" });
      const noArgs = await post({});
      expect(noArgs.statusCode).toBe(400);
    });

    it("a missing file is 404 and a non-web file is 400", async () => {
      expect((await post({ cwd: h.cwd, path: "mockups/a/missing.html" })).statusCode).toBe(404);
      fs.writeFileSync(path.join(h.cwd, "mockups", "a", "notes.txt"), "x");
      expect((await post({ cwd: h.cwd, path: "mockups/a/notes.txt" })).statusCode).toBe(400);
      fs.writeFileSync(path.join(h.cwd, "mockups", "a", "secret.html"), "x");
      expect((await post({ cwd: h.cwd, path: "mockups/a/secret.html" })).statusCode).toBe(400);
    });

    it("2.11 — registration is logged with the cwd, and no capability text", async () => {
      await post({ cwd: h.cwd, path: "mockups/a/index.html" });
      expect(h.logs.some((l) => l.startsWith("[live-preview] static target registered"))).toBe(true);
    });
  });

  describe("start: addedBy / preset", () => {
    it("a preset start is in-memory, listed with addedBy, logged; own port refused", async () => {
      const res = await h.app.inject({
        method: "POST",
        url: "/api/live-server/start",
        payload: { host: "127.0.0.1", port: 6060, addedBy: "preset", sessionId: "s1" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.addedBy).toBe("preset");
      expect(h.logs.some((l) => l.includes("preset target registered"))).toBe(true);
      const list = await h.app.inject({ method: "GET", url: "/api/live-server/list" });
      const servers = list.json().data.servers as Array<{ port: number; addedBy: string }>;
      expect(servers.find((s) => s.port === 6060)?.addedBy).toBe("preset");
      expect(servers.find((s) => s.port === 5173)?.addedBy).toBe("user");
      expect(servers.every((s) => typeof s.addedBy === "string")).toBe(true);
      const own = await h.app.inject({
        method: "POST",
        url: "/api/live-server/start",
        payload: { host: "localhost", port: 8000 },
      });
      expect(own.statusCode).toBe(400);
    });
  });

  describe("E16 — mint policy is fail-closed", () => {
    it("`{}`, no body and `{egress:'bogus'}` → restricted, scripts off; `{egress:'open'}` → open", async () => {
      for (const body of [{}, undefined, { egress: "bogus" }, { egress: 7 }, { scripts: "yes" }]) {
        const res = await mint(h, h.staticId, body);
        expect(res.statusCode).toBe(200);
        expect(res.json().policy).toEqual({ egress: "restricted", scripts: false });
      }
      const open = await mint(h, h.staticId, { egress: "open" });
      expect(open.json().policy).toEqual({ egress: "open", scripts: false });
    });

    it("the response carries ok, path, expiresAt (now + 2h for static), a non-secret tokenId and the policy", async () => {
      const res = await mint(h, h.staticId, { egress: "restricted", scripts: true, viewerId: "viewer-1234" });
      const b = res.json();
      expect(b.ok).toBe(true);
      expect(b.success).toBe(true);
      expect(b.expiresAt).toBe(T0 + STATIC_CAPABILITY_MAX_MS);
      const m = /^\/live\/(st-[0-9a-f]{8})\/~c\/([^/]+)\/$/.exec(b.path);
      expect(m).not.toBeNull();
      expect(b.tokenId).toMatch(/^[A-Za-z0-9_-]{16,}$/);
      expect(b.tokenId).not.toBe(m![2]);
      expect(b.policy).toEqual({ egress: "restricted", scripts: true });
      const grant = h.store.findByTokenId(b.tokenId);
      expect(grant).toMatchObject({ kind: "static", targetId: h.staticId, viewerId: "viewer-1234" });
      expect(JSON.stringify(grant)).not.toContain(m![2]);
    });

    it("a malformed viewerId is ignored; an unknown target is 404 and mints nothing", async () => {
      const res = await mint(h, h.staticId, { viewerId: "bad id!" });
      expect(h.store.findByTokenId(res.json().tokenId)?.viewerId).toBeUndefined();
      const before = h.store.size();
      expect((await mint(h, "nope", {})).statusCode).toBe(404);
      expect(h.store.size()).toBe(before);
    });
  });

  describe("E18 — mint tiers: static = raw-read tier, port = control", () => {
    it("observe → static 200; observe → port 403 insufficient_scope; control → both 200", async () => {
      expect((await mint(h, h.staticId, {}, "observe")).statusCode).toBe(200);
      const refused = await mint(h, h.portId, {}, "observe");
      expect(refused.statusCode).toBe(403);
      expect(refused.json()).toMatchObject({ error: "insufficient_scope", scope: "control" });
      expect(refused.headers["www-authenticate"]).toContain("insufficient_scope");
      expect((await mint(h, h.staticId, {}, "control")).statusCode).toBe(200);
      expect((await mint(h, h.portId, {}, "control")).statusCode).toBe(200);
    });
  });

  describe("E17 — static lifetimes and touch (fake clock)", () => {
    const touch = (id: string, tokenId: unknown, device = "dev-A") =>
      h.app.inject({
        method: "POST",
        url: `/api/live-server/${id}/touch`,
        remoteAddress: REMOTE,
        headers: { "x-test-principal": "control", "x-test-device": device },
        payload: { tokenId },
      });

    it("idle 10 min → refused; 9m59 admitted; a touched token survives to 1 h; every token dies at 2 h", async () => {
      const a = (await mint(h, h.staticId, {})).json();
      const b = (await mint(h, h.staticId, {})).json();
      const tok = (p: string) => /~c\/([^/]+)\//.exec(p)![1];
      h.clock.now = T0 + 10 * MIN - 1;
      expect(h.store.validate(h.staticId, tok(a.path))).not.toBeNull(); // 9m59.999 → admitted, idle restarts
      h.clock.now = T0 + 20 * MIN;
      expect(h.store.validate(h.staticId, tok(a.path))).toBeNull(); // 10m idle since last use
      // b: touched every 5 minutes.
      for (let t = 5; t <= 60; t += 5) {
        h.clock.now = T0 + t * MIN;
        expect((await touch(h.staticId, b.tokenId)).statusCode).toBe(200);
      }
      expect(h.store.validate(h.staticId, tok(b.path))).not.toBeNull(); // t0+1h
      for (let t = 65; t < 120; t += 5) {
        h.clock.now = T0 + t * MIN;
        expect((await touch(h.staticId, b.tokenId)).statusCode).toBe(200);
      }
      h.clock.now = T0 + STATIC_CAPABILITY_MAX_MS;
      expect(h.store.validate(h.staticId, tok(b.path))).toBeNull(); // absolute 2h
      expect((await touch(h.staticId, b.tokenId)).statusCode).toBe(404);
      expect(STATIC_CAPABILITY_IDLE_MS).toBe(10 * MIN);
    });

    it("only the minting principal may touch; a wrong tokenId / target is 404", async () => {
      const a = (await mint(h, h.staticId, {}, "control", "dev-A")).json();
      expect((await touch(h.staticId, a.tokenId, "dev-B")).statusCode).toBe(404);
      expect((await touch(h.portId, a.tokenId, "dev-A")).statusCode).toBe(404);
      expect((await touch(h.staticId, "nope", "dev-A")).statusCode).toBe(404);
      expect((await touch(h.staticId, undefined, "dev-A")).statusCode).toBe(404);
      expect((await touch(h.staticId, a.tokenId, "dev-A")).statusCode).toBe(200);
    });

    it("touch never lets an idle-expired token live again", async () => {
      const a = (await mint(h, h.staticId, {})).json();
      h.clock.now = T0 + 11 * MIN;
      expect((await touch(h.staticId, a.tokenId)).statusCode).toBe(404);
    });

    it("an observe-tier viewer may touch its own static token", async () => {
      const a = (await mint(h, h.staticId, {}, "observe", "dev-A")).json();
      const res = await h.app.inject({
        method: "POST",
        url: `/api/live-server/${h.staticId}/touch`,
        remoteAddress: REMOTE,
        headers: { "x-test-principal": "observe", "x-test-device": "dev-A" },
        payload: { tokenId: a.tokenId },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("GET /api/live-server/policy", () => {
    it("reports exposure, epoch and prompting", async () => {
      const res = await h.app.inject({ method: "GET", url: "/api/live-server/policy" });
      expect(res.json()).toMatchObject({ ok: true, exposure: "local-only", epoch: 1, promptingEnabled: false });
      h.setEndpoints(["https://t.example"]);
      const after = (await h.app.inject({ method: "GET", url: "/api/live-server/policy" })).json();
      expect(after).toMatchObject({ exposure: "exposed", epoch: 2 });
    });

    it("is readable by an observe-tier device", async () => {
      const res = await h.app.inject({
        method: "GET",
        url: "/api/live-server/policy",
        remoteAddress: REMOTE,
        headers: { "x-test-principal": "observe" },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("E22 — scripts on a restricted mint depend on exposure", () => {
    it("local-only → scripts allowed; exposed → refused unless runScripts; egress stays restricted", async () => {
      expect((await mint(h, h.staticId, { scripts: true })).json().policy).toEqual({ egress: "restricted", scripts: true });
      h.setEndpoints(["https://tunnel.example"]);
      const refused = await mint(h, h.staticId, { scripts: true });
      expect(refused.json().policy).toEqual({ egress: "restricted", scripts: false });
      const run = await mint(h, h.staticId, { scripts: true, runScripts: true });
      expect(run.json().policy).toEqual({ egress: "restricted", scripts: true });
      // `runScripts` alone grants nothing without `scripts`.
      expect((await mint(h, h.staticId, { runScripts: true })).json().policy.scripts).toBe(false);
    });
  });

  describe("X7 — the flip to exposed revokes restricted scripted local-only tokens", () => {
    it("revokes 2 restricted scripted tokens, keeps the open one, broadcasts once, logs the count without tokens", async () => {
      const r1 = (await mint(h, h.staticId, { scripts: true })).json();
      const r2 = (await mint(h, h.portId, { scripts: true })).json();
      const open = (await mint(h, h.staticId, { egress: "open", scripts: true })).json();
      const off = (await mint(h, h.staticId, { scripts: false })).json(); // restricted, scripts off: unaffected
      const tok = (p: string) => /~c\/([^/]+)\//.exec(p)![1];
      expect(h.broadcasts).toEqual([]);
      h.setEndpoints(["https://tunnel.example"]);
      h.exposure.current(); // the server polls; any read notices
      h.exposure.current();
      expect(h.broadcasts).toEqual([2]);
      expect(h.store.validate(h.staticId, tok(r1.path))).toBeNull();
      expect(h.store.validate(h.portId, tok(r2.path))).toBeNull();
      expect(h.store.validate(h.staticId, tok(open.path))).not.toBeNull();
      expect(h.store.validate(h.staticId, tok(off.path))).not.toBeNull();
      const line = h.logs.find((l) => l.includes("exposure changed"));
      expect(line).toContain('revoked=2');
      expect(line).toContain('exposure="exposed"');
      expect(h.logs.join("\n")).not.toContain(tok(r1.path));
      // Tokens minted AFTER the flip under runScripts are exposed-minted and survive a later flip.
      const later = (await mint(h, h.staticId, { scripts: true, runScripts: true })).json();
      h.setEndpoints([]);
      h.exposure.current();
      expect(h.broadcasts).toEqual([2, 3]);
      expect(h.store.validate(h.staticId, tok(later.path))).not.toBeNull();
    });
  });

  describe("X6 — a locally minted token is accepted only from genuinely local requests", () => {
    it("a credential-less local mint works locally and is refused with forwarding headers", async () => {
      const res = await h.app.inject({ method: "POST", url: `/api/live-server/${h.staticId}/capability`, payload: {} });
      expect(res.statusCode).toBe(200);
      const p = res.json().path as string;
      const local = await h.app.inject({ method: "GET", url: `${p}index.html` });
      expect(local.json()).toMatchObject({ via: "live-capability" });
      const forwarded = await h.app.inject({
        method: "GET",
        url: `${p}index.html`,
        headers: { "x-forwarded-for": "203.0.113.9" },
      });
      expect(forwarded.statusCode).toBe(403); // not admitted by the capability, nor by the guard
      const remote = await h.app.inject({ method: "GET", url: `${p}index.html`, remoteAddress: REMOTE });
      expect(remote.statusCode).toBe(403);
      // The genuine local holder keeps a working token afterwards.
      expect((await h.app.inject({ method: "GET", url: `${p}index.html` })).json()).toMatchObject({ via: "live-capability" });
    });

    it("a device-minted token is NOT bound to local", async () => {
      const res = await mint(h, h.staticId, {});
      const p = res.json().path as string;
      const remote = await h.app.inject({ method: "GET", url: `${p}index.html`, remoteAddress: REMOTE });
      expect(remote.json()).toMatchObject({ via: "live-capability" });
    });
  });

  describe("allow-once store (hook point for the egress routes)", () => {
    it("is bounded to 32 origins per viewer, most recent kept, keyed by viewer", () => {
      for (let i = 0; i < 40; i++) h.store.addAllowOnce("viewer-aaaa", `https://o${i}.example`);
      const got = h.store.getAllowOnce("viewer-aaaa");
      expect(got).toHaveLength(32);
      expect(got).toContain("https://o39.example");
      expect(got).not.toContain("https://o0.example");
      expect(h.store.getAllowOnce("viewer-bbbb")).toEqual([]);
      expect(h.store.getAllowOnce(undefined)).toEqual([]);
      h.store.addAllowOnce("bad id", "https://x.example"); // malformed viewer ids store nothing
      expect(h.store.getAllowOnce("bad id")).toEqual([]);
    });

    it("principalKeyOf is the minter identity egress/touch compare", async () => {
      const a = (await mint(h, h.staticId, {}, "control", "dev-A")).json();
      expect(h.store.findByTokenId(a.tokenId)?.minterKey).toBe(principalKeyOf({ kind: "device", deviceId: "dev-A" }));
    });
  });
});

// ─── X5: browser-originated requests ───────────────────────────────────────────

describe("X5 — browser-originated /live/ requests need a capability", () => {
  const sockets = new Set<Socket>();
  let upstream: http.Server;
  let app: FastifyInstance;
  let store: LiveCapabilityStore;
  let upstreamHits = 0;

  beforeEach(async () => {
    upstreamHits = 0;
    upstream = http.createServer((_req, res) => {
      upstreamHits++;
      res.end("ok");
    });
    upstream.on("connection", (s) => {
      sockets.add(s);
      s.on("close", () => sockets.delete(s));
    });
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
    const upstreamPort = (upstream.address() as AddressInfo).port;
    const manager = createLiveServerManager(fakePrefs());
    const started = manager.start({ host: "127.0.0.1", port: upstreamPort });
    if (!started.ok) throw new Error("start failed");
    store = new LiveCapabilityStore({ isTargetLive: (id) => manager.has(id) });
    app = Fastify({ logger: false });
    app.decorateRequest("isAuthenticated", false);
    app.addHook("onRequest", createLiveCapabilityHook(store));
    app.addHook("onRequest", createNetworkGuardHook({ trustedNetworks: () => [], logDenial: () => {} }));
    registerLiveServerProxy(app, manager);
    await app.ready();
    (app as any).__id = started.target.id;
  });
  afterEach(async () => {
    await app.close();
    for (const s of sockets) s.destroy();
    await new Promise<void>((r) => upstream.close(() => r()));
  });

  const id = () => (app as any).__id as string;

  it("Origin: null and any Sec-Fetch-* → 404 without a capability; no markers → admitted; the upstream is never hit by the refused ones", async () => {
    const get = (headers: Record<string, string>) => app.inject({ method: "GET", url: `/live/${id()}/`, headers });
    expect((await get({ origin: "null" })).statusCode).toBe(404);
    expect((await get({ "sec-fetch-site": "same-origin" })).statusCode).toBe(404);
    expect((await get({ "sec-fetch-mode": "navigate" })).statusCode).toBe(404);
    expect(upstreamHits).toBe(0);
    expect((await get({})).statusCode).toBe(200);
    expect(upstreamHits).toBe(1);
  });

  it("with a valid capability the same markers are admitted", async () => {
    const { token } = store.mint(id(), { kind: "local" }, { kind: "port", policy: { egress: "open", scripts: true } });
    const res = await app.inject({
      method: "GET",
      url: `/live/${id()}/~c/${token}/`,
      headers: { origin: "null", "sec-fetch-site": "same-origin" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("an invalid capability does not lift the marker rule", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/live/${id()}/~c/${"A".repeat(43)}/`,
      headers: { origin: "null" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("a WS upgrade with browser markers and no capability prefix is destroyed before any connect", () => {
    const manager = createLiveServerManager(fakePrefs());
    const destroyed = vi.fn();
    const socket = { destroy: destroyed, on: vi.fn(), once: vi.fn(), pipe: vi.fn(), write: vi.fn() } as any;
    const request = { url: `/live/${id()}/`, method: "GET", headers: { origin: "null" }, socket: { remoteAddress: "127.0.0.1" } } as any;
    handleLiveServerUpgrade(manager, request, socket, Buffer.alloc(0), {});
    expect(destroyed).toHaveBeenCalled();
  });

  it("isBrowserOriginated: Origin null or any sec-fetch-*, nothing else", () => {
    expect(isBrowserOriginated({ origin: "null" })).toBe(true);
    expect(isBrowserOriginated({ "sec-fetch-dest": "iframe" })).toBe(true);
    expect(isBrowserOriginated({ origin: "http://localhost:8000" })).toBe(false);
    expect(isBrowserOriginated({ host: "x", "user-agent": "curl" })).toBe(false);
  });
});

// ─── E25 (server core part): route jurisdiction + tiers ────────────────────────

describe("E25 — live-preview routes sit inside the guard's jurisdiction with explicit tiers", () => {
  it("start-static / policy / touch / mint are mapped (raw-read, observe, observe, observe)", () => {
    expect(hasRouteTier("POST", "/api/live-server/start-static")).toBe(true);
    expect(routeTier("POST", "/api/live-server/start-static")).toBe("observe");
    expect(routeTier("GET", "/api/live-server/policy")).toBe("observe");
    expect(routeTier("POST", "/api/live-server/:id/touch")).toBe("observe");
    // Static mints are raw-read tier; the port-target `control` rule is enforced in the handler.
    expect(routeTier("POST", "/api/live-server/:id/capability")).toBe("observe");
    expect(routeTier("POST", "/api/live-server/start")).toBe("operate");
  });

  it("every live-preview path is inside GUARD_JURISDICTION_PREFIXES, including the reserved csp-report path", () => {
    for (const u of [
      "/api/live-server/start-static",
      "/api/live-server/policy",
      "/api/live-server/abc/touch",
      "/api/live-server/abc/egress",
      "/api/live-server/abc/allow-once",
      "/api/live-server/abc/egress-grant-request",
      `/live/abc/~c/${"A".repeat(43)}/__pi/csp-report`,
    ]) {
      expect(isGuardJurisdiction(u), u).toBe(true);
    }
  });
});
