/**
 * Egress routes of a restricted live preview, end to end through the real route-tier gate,
 * capability hook, static proxy, egress service, grant coordinator and plane:
 *
 *  E24 egress / allow-once (minting principal only)   X8 csp-report sink
 *  E25 route tiers + guard jurisdiction               E27 egress-grant-request
 *  2.11 log lines (allow-once, refused allows)        E28 CSP picks up a grant / revoke with no restart
 *
 * See change: improve-canvas-html-and-url-ux (tasks 2.7–2.11, 3.3, 3.5–3.7).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { routeTier } from "@blackbelt-technology/pi-dashboard-shared/route-tiers.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccessPlaneRegistry } from "../access/access-plane.js";
import { GrantCoordinator } from "../access/grant-coordinator.js";
import { createPreviewEgressPlane } from "../access/planes.js";
import {
  addPreviewEgressGrant,
  projectEgressGrants,
  resetPreviewEgressCache,
  revokePreviewEgressGrant,
} from "../access/preview-egress-store.js";
import { isGuardJurisdiction } from "../auth/localhost-guard.js";
import { createRouteTierGate } from "../auth/route-tier-gate.js";
import { createLiveCapabilityHook, LiveCapabilityStore } from "../live-server/live-capability.js";
import { createReservedHandler } from "../live-server/live-csp-report.js";
import {
  CSP_REPORT_MAX_BYTES,
  createEgressGrantRequester,
  createPreviewEgress,
  MAX_BLOCKED_ORIGINS,
  type PreviewEgress,
} from "../live-server/live-egress.js";
import { createLiveServerManager } from "../live-server/live-server-manager.js";
import { registerLiveServerProxy } from "../live-server/live-server-proxy.js";
import { registerLiveServerRoutes } from "../routes/live-server-routes.js";

const REMOTE = "203.0.113.5";
const T0 = 1_700_000_000_000;
const CDN = "https://cdn.tailwindcss.com";
const V1 = "viewer-one-1";
const V2 = "viewer-two-2";

const fakePrefs = () => {
  let store: unknown[] = [];
  return { getLiveServers: () => store, setLiveServers: (t: unknown[]) => (store = t) } as never;
};
const mkTmp = (prefix: string) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

interface Harness {
  app: FastifyInstance;
  clock: { now: number };
  cwd: string;
  staticId: string;
  logs: string[];
  broadcasts: ServerToBrowserMessage[];
  egress: PreviewEgress;
  store: LiveCapabilityStore;
  coordinator: GrantCoordinator;
  setPrompting(on: boolean): void;
}

async function makeHarness(): Promise<Harness> {
  const clock = { now: T0 };
  const cwd = mkTmp("live-egress-cwd-");
  fs.writeFileSync(
    path.join(cwd, "index.html"),
    `<script src="${CDN}"></script><link rel="stylesheet" href="https://unpkg.com/x.css"><img src="http://192.168.1.10/a.png">`,
  );
  const manager = createLiveServerManager(fakePrefs());
  const reg = manager.startStatic({ cwd, root: cwd });
  if (!reg.ok) throw new Error("startStatic failed");
  const staticId = reg.target.id;
  const devices = new Set(["dev-A", "dev-B"]);
  const store = new LiveCapabilityStore({
    now: () => clock.now,
    isTargetLive: (id) => manager.has(id),
    isPrincipalLive: (p) => (p.kind === "device" ? devices.has(p.deviceId ?? "") : true),
  });
  const egress = createPreviewEgress({
    getStatic: (id) => manager.getStatic(id),
    projectKeyOf: (c) => c,
    projectGrants: projectEgressGrants,
    allowOnce: (v) => store.getAllowOnce(v),
    now: () => clock.now,
  });

  let prompting = true;
  const broadcasts: ServerToBrowserMessage[] = [];
  const planes = new AccessPlaneRegistry();
  planes.register(createPreviewEgressPlane({ resolve: async () => ["93.184.216.34"] }));
  const coordinator = new GrantCoordinator({
    planes,
    broadcast: (m) => broadcasts.push(m),
    hostGateMode: () => "enforce",
    promptEnabled: () => prompting,
    killSwitch: () => false,
    operatorChannels: () => 1,
    now: () => clock.now,
  });

  const logs: string[] = [];
  const app = Fastify({ logger: false });
  app.decorateRequest("isAuthenticated", false);
  app.addHook("onRequest", createLiveCapabilityHook(store));
  app.addHook("onRequest", async (req) => {
    const tier = req.headers["x-test-principal"];
    if (typeof tier === "string") {
      (req as never as { isAuthenticated: boolean }).isAuthenticated = true;
      Object.assign(req, {
        authVia: "device",
        principalTier: tier,
        principalDeviceId: (req.headers["x-test-device"] as string) ?? "dev-A",
      });
    }
  });
  app.addHook("onRequest", createRouteTierGate({ getTrustedNetworks: () => [], logRefusal: () => {} }));
  registerLiveServerRoutes(app, manager, {
    networkGuard: async () => undefined,
    capabilities: store,
    promptingEnabled: () => prompting,
    egress,
    requestEgressGrant: createEgressGrantRequester(coordinator),
    channelOf: (r) => `source:${r.ip}`,
    log: (l) => logs.push(l),
  });
  registerLiveServerProxy(app, manager, {
    staticGate: async (_c, abs) => abs.startsWith(`${cwd}${path.sep}`),
    grantedOrigins: (g) => egress.grantedFor(g),
    onStaticHtmlServed: (g, real) => egress.noteServed(g, real),
    reservedHandler: createReservedHandler({ egress, log: (l) => logs.push(l) }),
  });
  await app.ready();
  return { app, clock, cwd, staticId, logs, broadcasts, egress, store, coordinator, setPrompting: (on) => (prompting = on) };
}

type Tier = "observe" | "control";
const as = (tier: Tier, device = "dev-A") => ({ "x-test-principal": tier, "x-test-device": device });

describe("egress routes", () => {
  let h: Harness;
  let storeDir: string;
  beforeEach(async () => {
    storeDir = mkTmp("live-egress-store-");
    process.env.PI_PREVIEW_EGRESS_STORE = path.join(storeDir, "preview-egress.json");
    resetPreviewEgressCache();
    h = await makeHarness();
  });
  afterEach(async () => {
    await h.app.close();
    delete process.env.PI_PREVIEW_EGRESS_STORE;
    resetPreviewEgressCache();
    fs.rmSync(h.cwd, { recursive: true, force: true });
    fs.rmSync(storeDir, { recursive: true, force: true });
  });

  const mint = async (viewerId: string | undefined, tier: Tier = "control", device = "dev-A") => {
    const res = await h.app.inject({
      method: "POST",
      url: `/api/live-server/${h.staticId}/capability`,
      remoteAddress: REMOTE,
      headers: as(tier, device),
      payload: { egress: "restricted", scripts: false, ...(viewerId ? { viewerId } : {}) },
    });
    expect(res.statusCode).toBe(200);
    const b = res.json() as { path: string; tokenId: string };
    return { path: b.path, tokenId: b.tokenId };
  };
  const load = (p: string, file = "index.html") =>
    h.app.inject({ method: "GET", url: `${p}${file}`, remoteAddress: REMOTE });
  const egressOf = (tokenId: string, tier: Tier = "control", device = "dev-A") =>
    h.app.inject({
      method: "GET",
      url: `/api/live-server/${h.staticId}/egress?token=${tokenId}`,
      remoteAddress: REMOTE,
      headers: as(tier, device),
    });
  const allowOnce = (body: Record<string, unknown>, device = "dev-A", tier: Tier = "control") =>
    h.app.inject({
      method: "POST",
      url: `/api/live-server/${h.staticId}/allow-once`,
      remoteAddress: REMOTE,
      headers: as(tier, device),
      payload: body,
    });
  const csp = (res: { headers: Record<string, unknown> }) => String(res.headers["content-security-policy"]);

  describe("E24 — egress view and allow-once belong to the minting principal", () => {
    it("lists markup origins once the page was served, with ungrantable / state flags", async () => {
      const t = await mint(V1);
      expect((await egressOf(t.tokenId)).json().origins).toEqual([]); // nothing served yet
      expect((await load(t.path)).statusCode).toBe(200);
      const body = (await egressOf(t.tokenId)).json();
      expect(body).toMatchObject({ success: true, ok: true, scanIncomplete: false, rootAbsolute: false, runtimeChannel: false, promptingEnabled: true });
      expect(body.origins).toEqual([
        { origin: CDN, source: "markup", state: "blocked" },
        { origin: "https://unpkg.com", source: "markup", state: "blocked" },
        { origin: "http://192.168.1.10", source: "markup", state: "blocked", ungrantable: true },
      ]);
    });

    it("another device — even with control tier — is refused (403) on both routes; the owner is served", async () => {
      const a = await mint(V1);
      expect((await egressOf(a.tokenId, "control", "dev-B")).statusCode).toBe(403);
      expect((await allowOnce({ tokenId: a.tokenId, viewerId: V1, origin: CDN }, "dev-B")).statusCode).toBe(403);
      expect((await egressOf(a.tokenId)).statusCode).toBe(200);
      expect((await egressOf("no-such-token")).statusCode).toBe(404);
    });

    it("an observe-tier caller is refused by the route-tier gate (control tier)", async () => {
      const a = await mint(V1, "observe");
      const res = await egressOf(a.tokenId, "observe");
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: "insufficient_scope" });
    });

    it("allow-once applies to one viewer only, survives a re-mint, and persists nothing", async () => {
      const t1 = await mint(V1);
      const t2 = await mint(V2);
      expect((await allowOnce({ tokenId: t1.tokenId, viewerId: V1, origin: CDN })).json()).toEqual({ success: true, ok: true });
      expect(csp(await load(t1.path))).toContain(CDN);
      expect(csp(await load(t2.path))).not.toContain(CDN);
      // The viewer re-mints (new token, same viewer id): still allowed.
      const re = await mint(V1);
      expect(csp(await load(re.path))).toContain(CDN);
      const view = (await egressOf(re.tokenId)).json();
      expect(view.origins.find((o: { origin: string }) => o.origin === CDN)).toMatchObject({ state: "allowed-once" });
      expect(fs.existsSync(process.env.PI_PREVIEW_EGRESS_STORE as string)).toBe(false);
    });

    it("refuses ungrantable / invalid origins and a viewer that does not own the token (400), and logs the refusal", async () => {
      const t = await mint(V1);
      for (const origin of ["https://localhost:8000", "https://app.localhost", "https://[::ffff:127.0.0.1]", "https://127-0-0-1.example.io", "http://cdn.example.com", "nonsense"]) {
        const res = await allowOnce({ tokenId: t.tokenId, viewerId: V1, origin });
        expect(res.statusCode, origin).toBe(400);
        expect(res.json()).toMatchObject({ success: false, ok: false });
      }
      expect((await allowOnce({ tokenId: t.tokenId, viewerId: V2, origin: CDN })).statusCode).toBe(400);
      expect((await allowOnce({ tokenId: t.tokenId, viewerId: "x", origin: CDN })).statusCode).toBe(400);
      expect(csp(await load(t.path))).not.toContain("localhost:8000");
      expect(csp(await load(t.path))).not.toContain("127-0-0-1");
      expect(h.logs.filter((l) => l.includes("allow refused")).length).toBeGreaterThanOrEqual(8);
    });

    it("logs an allow-once with the origin and no capability", async () => {
      const t = await mint(V1);
      await allowOnce({ tokenId: t.tokenId, viewerId: V1, origin: `${CDN}/path` });
      const line = h.logs.find((l) => l.includes("allow-once"));
      expect(line).toContain(CDN);
      expect(line).not.toContain(t.path.split("/~c/")[1].replace(/\/$/, ""));
    });
  });

  describe("X8 — csp-report sink", () => {
    const report = (p: string, body: unknown, headers: Record<string, string> = {}, type = "application/csp-report") =>
      h.app.inject({
        method: "POST",
        url: `${p}__pi/csp-report`,
        remoteAddress: REMOTE,
        headers: { "content-type": type, ...headers },
        payload: typeof body === "string" ? body : JSON.stringify(body),
      });
    const legacy = (uri: string, documentUri = "https://dash/live/x/~c/SECRET/index.html") => ({
      "csp-report": { "blocked-uri": uri, "document-uri": documentUri },
    });

    it("accepts both media types and adds a runtime origin (never project-grantable)", async () => {
      const t = await mint(V1);
      expect((await report(t.path, legacy("https://img.example.com/a.png"))).statusCode).toBe(204);
      const r2 = await report(
        t.path,
        [{ type: "csp-violation", body: { blockedURL: "https://stats.example-cdn.net/x.js" } }],
        {},
        "application/reports+json",
      );
      expect(r2.statusCode).toBe(204);
      const view = (await egressOf(t.tokenId)).json();
      expect(view.runtimeChannel).toBe(true);
      expect(view.origins).toEqual([
        { origin: "https://img.example.com", source: "runtime", state: "blocked" },
        { origin: "https://stats.example-cdn.net", source: "runtime", state: "blocked" },
      ]);
      // A runtime-only origin cannot be asked for as a project grant.
      const ask = await h.app.inject({
        method: "POST",
        url: `/api/live-server/${h.staticId}/egress-grant-request`,
        remoteAddress: REMOTE,
        headers: as("control"),
        payload: { tokenId: t.tokenId, origin: "https://img.example.com" },
      });
      expect(ask.statusCode).toBe(400);
    });

    it("ignores inline / eval / data / the dashboard's own origin; reads only blocked-uri", async () => {
      const t = await mint(V1);
      for (const uri of ["inline", "eval", "data", "blob:https://x/1", "ws://other.example.com/"]) {
        expect((await report(t.path, legacy(uri))).statusCode).toBe(204);
      }
      expect((await egressOf(t.tokenId)).json().origins).toEqual([]);
    });

    it("65 KiB → 413; a wrong token → 404; an unparseable body is accepted and changes nothing", async () => {
      const t = await mint(V1);
      const big = JSON.stringify(legacy("https://a.example.com/x")) + " ".repeat(CSP_REPORT_MAX_BYTES + 1024);
      expect((await report(t.path, big)).statusCode).toBe(413);
      const wrong = t.path.replace(/\/~c\/[^/]+\//, "/~c/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/");
      expect((await report(wrong, legacy("https://a.example.com/x"))).statusCode).toBe(404);
      expect((await report(t.path, "{ not json")).statusCode).toBe(204);
      expect((await egressOf(t.tokenId)).json().origins).toEqual([]);
    });

    it("only POST is served; the rest of /__pi/ is 404", async () => {
      const t = await mint(V1);
      expect((await h.app.inject({ method: "GET", url: `${t.path}__pi/csp-report`, remoteAddress: REMOTE })).statusCode).toBe(405);
      expect((await h.app.inject({ method: "GET", url: `${t.path}__pi/other`, remoteAddress: REMOTE })).statusCode).toBe(404);
    });

    it("21 reports in one second → the 21st is 429 and adds nothing", async () => {
      const t = await mint(V1);
      for (let i = 1; i <= 20; i++) expect((await report(t.path, legacy(`https://r${i}.example.com/x`))).statusCode).toBe(204);
      expect((await report(t.path, legacy("https://r21.example.com/x"))).statusCode).toBe(429);
      const origins = (await egressOf(t.tokenId)).json().origins.map((o: { origin: string }) => o.origin);
      expect(origins).toHaveLength(20);
      expect(origins).not.toContain("https://r21.example.com");
      h.clock.now += 1100; // the window slides
      expect((await report(t.path, legacy("https://r22.example.com/x"))).statusCode).toBe(204);
    });

    it("601 reports within an hour → the 601st is 429; the next hour resets", async () => {
      const t = await mint(V1);
      for (let i = 1; i <= 600; i++) {
        h.clock.now += 1500;
        expect((await report(t.path, legacy(`https://r${i % 5}.example.com/x`))).statusCode, `#${i}`).toBe(204);
      }
      h.clock.now += 1500;
      expect((await report(t.path, legacy("https://r1.example.com/x"))).statusCode).toBe(429);
      for (let i = 0; i < 12; i++) {
        h.clock.now += 5 * 60_000;
        expect(h.store.touch(t.tokenId, "device:dev-A")).toBe(true); // keep the token alive across the hour
      }
      expect((await report(t.path, legacy("https://r1.example.com/x"))).statusCode).toBe(204);
    });

    it("the blocked set is bounded at 64: oldest runtime evicted first; markup and allowed ones never", async () => {
      const t = await mint(V1);
      await load(t.path); // markup: 3 origins
      await allowOnce({ tokenId: t.tokenId, viewerId: V1, origin: "https://allowed.example.com" });
      await report(t.path, legacy("https://allowed.example.com/a.js"));
      for (let batch = 0; batch < 8; batch++) {
        h.clock.now += 2000;
        for (let i = 0; i < 10; i++) await report(t.path, legacy(`https://rt-${batch}-${i}.example.com/x`));
      }
      const origins = (await egressOf(t.tokenId)).json().origins as Array<{ origin: string; source: string; state: string }>;
      expect(origins.length).toBeLessThanOrEqual(MAX_BLOCKED_ORIGINS + 1);
      expect(origins.filter((o) => o.source === "markup")).toHaveLength(3);
      expect(origins.find((o) => o.origin === "https://allowed.example.com")).toMatchObject({ state: "allowed-once" });
      const runtime = origins.filter((o) => o.source === "runtime" && o.state === "blocked").map((o) => o.origin);
      expect(runtime).not.toContain("https://rt-0-0.example.com"); // oldest gone
      expect(runtime).toContain("https://rt-7-9.example.com"); // newest kept
    });

    it("no log line carries the capability token", async () => {
      const t = await mint(V1);
      const secret = t.path.split("/~c/")[1].replace(/\/$/, "");
      const big = JSON.stringify(legacy("https://a.example.com/x", `https://dash${t.path}index.html`)) + " ".repeat(CSP_REPORT_MAX_BYTES);
      await report(t.path, big);
      for (let i = 0; i < 22; i++) await report(t.path, legacy("https://a.example.com/x", `https://dash${t.path}index.html`));
      expect(h.logs.some((l) => l.includes("csp-report"))).toBe(true);
      expect(h.logs.join("\n")).not.toContain(secret);
    });
  });

  describe("E27 — egress-grant-request (the operator's click)", () => {
    const ask = (tokenId: string, origin: string, ip = REMOTE) =>
      h.app.inject({
        method: "POST",
        url: `/api/live-server/${h.staticId}/egress-grant-request`,
        remoteAddress: ip,
        headers: as("control"),
        payload: { tokenId, origin },
      });

    it("markup origin + prompting on → a deferred registry entry and a dialog event", async () => {
      const t = await mint(V1);
      await load(t.path);
      const res = await ask(t.tokenId, CDN);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ success: true, ok: true });
      const pending = h.coordinator.registry.list(h.clock.now);
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({ plane: "preview-egress", subject: CDN, mode: "deferred", prompted: true });
      expect(h.broadcasts.find((m) => m.type === "grant_request")).toMatchObject({ plane: "preview-egress", subject: CDN });
    });

    it("runtime-only, ungrantable, unknown-token and bad-origin requests are 400/404 and raise nothing", async () => {
      const t = await mint(V1);
      await load(t.path);
      await h.app.inject({
        method: "POST",
        url: `${t.path}__pi/csp-report`,
        remoteAddress: REMOTE,
        headers: { "content-type": "application/csp-report" },
        payload: JSON.stringify({ "csp-report": { "blocked-uri": "https://runtime.example.com/x" } }),
      });
      expect((await ask(t.tokenId, "https://runtime.example.com")).statusCode).toBe(400);
      expect((await ask(t.tokenId, "http://192.168.1.10")).statusCode).toBe(400);
      expect((await ask(t.tokenId, "https://localhost:8000")).statusCode).toBe(400);
      expect((await ask(t.tokenId, "https://never-seen.example.com")).statusCode).toBe(400);
      expect((await ask("nope", CDN)).statusCode).toBe(404);
      expect(h.coordinator.registry.list(h.clock.now)).toHaveLength(0);
    });

    it("prompting disabled → {reason:'prompting-disabled'} and no entry", async () => {
      const t = await mint(V1);
      await load(t.path);
      h.setPrompting(false);
      const res = await ask(t.tokenId, CDN);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: false, reason: "prompting-disabled" });
      expect(h.coordinator.registry.list(h.clock.now)).toHaveLength(0);
      expect((await egressOf(t.tokenId)).json().promptingEnabled).toBe(false);
    });

    it("a rapid second request from the same requester is rate limited by the registry (429)", async () => {
      const t = await mint(V1);
      await load(t.path);
      expect((await ask(t.tokenId, CDN)).statusCode).toBe(200);
      const second = await ask(t.tokenId, "https://unpkg.com");
      expect(second.statusCode).toBe(429);
      expect(second.json()).toMatchObject({ ok: false, reason: "rate-limited" });
    });

    it("another device cannot ask for the owner's preview", async () => {
      const t = await mint(V1);
      await load(t.path);
      const res = await h.app.inject({
        method: "POST",
        url: `/api/live-server/${h.staticId}/egress-grant-request`,
        remoteAddress: REMOTE,
        headers: as("control", "dev-B"),
        payload: { tokenId: t.tokenId, origin: CDN },
      });
      expect(res.statusCode).toBe(403);
    });

    it("allow-always writes the project grant; the NEXT CSP build includes it, revoke drops it — no restart (E28)", async () => {
      const t = await mint(V1);
      await load(t.path);
      await ask(t.tokenId, CDN);
      const promptId = h.coordinator.registry.list(h.clock.now)[0].promptId;
      const settled = await h.coordinator.settle({ promptId, plane: "preview-egress", subject: CDN, verdict: "allow-always" });
      expect(settled).toMatchObject({ ok: true });
      expect(projectEgressGrants(h.cwd)).toEqual([CDN]);

      // Any later preview under the project, another viewer: no allow-once, still granted.
      const other = await mint(V2);
      expect(csp(await load(other.path))).toContain(CDN);
      const view = (await egressOf(other.tokenId)).json();
      expect(view.origins.find((o: { origin: string }) => o.origin === CDN)).toMatchObject({ state: "allowed-project" });

      await revokePreviewEgressGrant(h.cwd, CDN);
      expect(csp(await load(other.path))).not.toContain(CDN);
      expect(
        (await egressOf(other.tokenId)).json().origins.find((o: { origin: string }) => o.origin === CDN),
      ).toMatchObject({ state: "blocked" });
    });

    it("a grant for project /p does not apply to a preview of project /q", async () => {
      await addPreviewEgressGrant("/some/other/project", CDN);
      const t = await mint(V1);
      expect(csp(await load(t.path))).not.toContain(CDN);
    });
  });

  describe("E25 — route tiers and guard jurisdiction", () => {
    it("every new namespace is inside the guard's jurisdiction with the specified tier", () => {
      const id = "st-abcd1234";
      const rows: Array<[string, string, string]> = [
        ["POST", "/api/live-server/start-static", "observe"], // raw-read tier
        ["GET", "/api/live-server/policy", "observe"],
        ["GET", `/api/live-server/${id}/egress`, "control"],
        ["POST", `/api/live-server/${id}/allow-once`, "control"],
        ["POST", `/api/live-server/${id}/touch`, "observe"], // handler: minting principal only
        ["POST", `/api/live-server/${id}/egress-grant-request`, "control"],
        ["DELETE", "/api/access/preview-egress", "operate"],
      ];
      for (const [method, url, tier] of rows) {
        expect(isGuardJurisdiction(url), url).toBe(true);
        expect(routeTier(method, url.replace(id, ":id")), `${method} ${url}`).toBe(tier);
      }
      // The report sink is a capability path, not an /api route: in jurisdiction, authenticated by the token.
      expect(isGuardJurisdiction(`/live/${id}/~c/${"A".repeat(43)}/__pi/csp-report`)).toBe(true);
    });
  });
});
