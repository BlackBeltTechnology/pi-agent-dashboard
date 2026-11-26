/**
 * Reserve-path REST route authz + body classes (D9): `POST /api/live-server/preview-path` under the production hook order
 * (capability hook → fixture principal → tier gate → universal network guard) with a REAL manager (`ownPorts` = dashboard,
 * pi gateway and the tier-3 pool ports) and a REAL `PreviewPathStore`.
 * See change: serve-live-previews-on-capability-origin (D9; test-plan #E91).
 */
import { parsePreviewOrigins, resolvePreviewOrigins } from "@blackbelt-technology/pi-dashboard-shared/preview-origins.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNetworkGuardHook, type GuardDenialLogEntry } from "../auth/localhost-guard.js";
import { createRouteTierGate } from "../auth/route-tier-gate.js";
import { createLiveCapabilityHook, LiveCapabilityStore } from "../live-server/live-capability.js";
import { createLiveServerManager, type LiveServerManager } from "../live-server/live-server-manager.js";
import { PreviewPathStore } from "../live-server/preview-path-store.js";
import { createPreviewPool } from "../live-server/preview-pool.js";
import { registerLiveServerRoutes } from "../routes/live-server-routes.js";

const REMOTE = "203.0.113.5";
const DASH_PORT = 8000;
const PI_PORT = 9999;
const POOL = { from: 8100, to: 8199 };

function fakePrefs() {
  let store: unknown[] = [];
  return { getLiveServers: () => store, setLiveServers: (t: unknown[]) => void (store = t) } as never;
}

interface Ctx {
  app: FastifyInstance;
  paths: PreviewPathStore;
  manager: LiveServerManager;
  staticId: string;
  denials: GuardDenialLogEntry[];
}

async function build(): Promise<Ctx> {
  let pool: ReturnType<typeof createPreviewPool> | undefined;
  const manager = createLiveServerManager(fakePrefs(), { ownPorts: () => [DASH_PORT, PI_PORT, ...(pool?.poolPorts() ?? [])] });
  pool = createPreviewPool({ range: () => POOL, bindHost: () => "127.0.0.1", findByPoolPort: () => null, revokeByPoolPort: () => {}, manager });
  const reg = manager.startStatic({ cwd: "/p", root: "/p/site" });
  if (!reg.ok) throw new Error("static target");
  const devices = new Set(["dev-A", "dev-B"]);
  const caps = new LiveCapabilityStore({ isTargetLive: () => true, isPrincipalLive: (p) => (p.kind === "device" ? devices.has(p.deviceId ?? "") : true) });
  const paths = new PreviewPathStore({
    targetIdForPort: (p) => manager.getByPort(p)?.id,
    isPortAllowed: (p) => manager.portRefusal(p) === null,
    isPrincipalLive: (p) => (p.kind === "device" ? devices.has(p.deviceId ?? "") : true),
  });
  const denials: GuardDenialLogEntry[] = [];
  const app = Fastify({ logger: false });
  app.decorateRequest("isAuthenticated", false);
  app.addHook("onRequest", createLiveCapabilityHook(caps, paths));
  app.addHook("onRequest", async (req) => {
    const tier = req.headers["x-test-principal"];
    if (typeof tier === "string") {
      const r = req as unknown as Record<string, unknown>;
      r.isAuthenticated = true;
      r.authVia = "device";
      r.principalTier = tier;
      r.principalDeviceId = (req.headers["x-test-device"] as string) ?? "dev-A";
    }
  });
  app.addHook("onRequest", createRouteTierGate({ getTrustedNetworks: () => [], logRefusal: () => {} }));
  app.addHook("onRequest", createNetworkGuardHook({ trustedNetworks: () => [], logDenial: (e) => denials.push(e) }));
  registerLiveServerRoutes(app, manager, {
    // The route-level `networkGuard` preHandler: refuses any peer that sends `x-fail-guard` (a peer the guard rejects).
    networkGuard: async (req, reply) => {
      if (req.headers["x-fail-guard"]) return reply.code(403).send({ success: false, error: "forbidden" });
    },
    capabilities: caps,
    previewPaths: paths,
    hasTier5Viewer: () => true,
    previewOrigins: () => resolvePreviewOrigins(parsePreviewOrigins({ enabled: true, portPool: `${POOL.from}-${POOL.to}` }).value, { port: DASH_PORT, piPort: PI_PORT, allowedHosts: [], publicBaseUrls: [], corsOrigins: [] }),
    log: () => {},
  });
  await app.ready();
  return { app, paths, manager, staticId: reg.target.id, denials };
}

describe("T.E91 — reserve-path REST: authz and body classes", () => {
  let c: Ctx;
  beforeEach(async () => {
    c = await build();
  });
  afterEach(async () => {
    await c.app.close();
  });

  const post = (headers: Record<string, string>, payload: unknown) =>
    c.app.inject({ method: "POST", url: "/api/live-server/preview-path", remoteAddress: REMOTE, headers, payload: payload as object });
  const as = (tier: "observe" | "control") => ({ "x-test-principal": tier });
  const start = (port: number) => c.app.inject({ method: "POST", url: "/api/live-server/start", remoteAddress: REMOTE, headers: { "x-test-principal": "operate" }, payload: { host: "127.0.0.1", port } });

  const bodies = (): { label: string; body: unknown }[] => [
    { label: "{}", body: {} },
    { label: '{port:"5299"}', body: { port: "5299" } },
    { label: "{port:0}", body: { port: 0 } },
    { label: "{port:65536}", body: { port: 65536 } },
    { label: "{port:22}", body: { port: 22 } },
    { label: "{port:<dashboard>}", body: { port: DASH_PORT } },
    { label: "{port:<pi gateway>}", body: { port: PI_PORT } },
    { label: "{port:<pool>}", body: { port: 8150 } },
    { label: "{port:5299,targetId:x}", body: { port: 5299, targetId: "x" } },
    { label: "{targetId:missing}", body: { targetId: "missing" } },
    { label: "{targetId:<static id>}", body: { targetId: c.staticId } },
  ];

  it("an observe-tier device is refused 403 insufficient_scope for every body; nothing is reserved", async () => {
    for (const { label, body } of bodies()) {
      const r = await post(as("observe"), body);
      expect(r.statusCode, label).toBe(403);
      expect(r.json(), label).toMatchObject({ error: "insufficient_scope" });
    }
    expect(c.paths.reservationCount()).toBe(0);
  });

  it("a peer the network guard rejects, and an unauthenticated remote caller, are refused for every body; nothing is reserved", async () => {
    for (const { label, body } of bodies()) {
      const guarded = await post({ ...as("control"), "x-fail-guard": "1" }, body);
      expect(guarded.statusCode, `guard: ${label}`).toBe(403);
      const anon = await post({}, body);
      expect(anon.statusCode, `anonymous: ${label}`).toBe(403);
    }
    expect(c.denials.length).toBeGreaterThan(0); // the universal guard really ran for the credential-less peer
    expect(c.paths.reservationCount()).toBe(0);
  });

  it("a control-tier device: malformed → 400; own / pool ports → the SAME refusal as target registration; unknown / static targetId → 400; nothing reserved in any refused row", async () => {
    const refusedStatuses = new Map<string, number>();
    for (const { label, body } of bodies()) {
      const r = await post(as("control"), body);
      refusedStatuses.set(label, r.statusCode);
      if (r.statusCode !== 200) expect(r.json(), label).toMatchObject({ success: false });
    }
    // malformed
    for (const l of ["{}", '{port:"5299"}', "{port:0}", "{port:65536}"]) expect(refusedStatuses.get(l), l).toBe(400);
    // the dashboard's own ports and every pool port: exactly what `POST /api/live-server/start` answers for them
    for (const [label, port] of [["{port:<dashboard>}", DASH_PORT], ["{port:<pi gateway>}", PI_PORT], ["{port:<pool>}", 8150]] as const) {
      const reg = await start(port);
      expect(reg.statusCode, `registration of ${port}`).toBe(400);
      expect(refusedStatuses.get(label), label).toBe(reg.statusCode);
    }
    // port 22 passes the loopback SSRF gate for registration, so reserve follows it (no divergent rule)
    expect(refusedStatuses.get("{port:22}")).toBe((await start(22)).statusCode);
    // unknown and static target ids are refused
    expect(refusedStatuses.get("{targetId:missing}")).toBe(400);
    expect(refusedStatuses.get("{targetId:<static id>}")).toBe(400);
    // `port` wins over a conflicting `targetId`: the reservation is for the port, the stray id is ignored
    expect(refusedStatuses.get("{port:5299,targetId:x}")).toBe(200);
    // only the accepted rows reserved: 5299 and 22 (allowed by the SSRF gate)
    expect(c.paths.reservationCount()).toBe(1 + (refusedStatuses.get("{port:22}") === 200 ? 1 : 0));
  });

  it("a refused row reserves nothing even when it is the only call", async () => {
    for (const body of [{}, { port: DASH_PORT }, { port: 8150 }, { targetId: "missing" }, { targetId: c.staticId }]) {
      const r = await post(as("control"), body);
      expect(r.statusCode, JSON.stringify(body)).toBe(400);
      expect(c.paths.reservationCount(), JSON.stringify(body)).toBe(0);
    }
  });

  it("a control device reserves a valid port, and an observe device cannot release it", async () => {
    const ok = await post(as("control"), { port: 5299 });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ success: true, tier5Viewers: true });
    const pid = String(ok.json().path).split("/")[2];
    const del = await c.app.inject({ method: "DELETE", url: `/api/live-server/preview-path/${pid}`, remoteAddress: REMOTE, headers: as("observe") });
    expect(del.statusCode).toBe(403);
    expect(c.paths.reservationCount()).toBe(1);
  });
});
