/**
 * `liveServer.previewOrigins.enabled:false` rollback (D12): with live tier-1 and tier-2 entries, flipping the config
 * makes the next mint a legacy `/live/…` path (`reason=disabled`), the old label hosts answer the preview dispatcher's
 * opaque 403 (never the dashboard SPA), every origin-bound entry is revoked (`onDelete reason=disabled`), and
 * `GET /api/host-gate` lists no label (and no `live-preview` pattern row).
 *
 * Wired from the REAL pieces: config snapshot (file under a tmp HOME), store, mint route, dispatcher + serverFactory,
 * host-gate route. Only the upstream and the dashboard SPA route are stand-ins.
 *
 * See change: serve-live-previews-on-capability-origin (D12; test-plan #E40).
 */
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HostGateState } from "../auth/host-gate.js";
import { getResolvedPreviewOrigins, resetConfigSnapshot } from "../config-snapshot.js";
import {
  type CapabilityDeleteReason,
  type LiveCapabilityEntry,
  LiveCapabilityStore,
} from "../live-server/live-capability.js";
import type { LiveServerManager } from "../live-server/live-server-manager.js";
import { createPreviewDispatch, type PreviewDispatch, previewServerFactory } from "../live-server/preview-dispatch.js";
import { registerHostGateRoutes } from "../routes/host-gate-routes.js";
import { registerLiveServerRoutes } from "../routes/live-server-routes.js";

const WILDCARD = { suffix: "preview.example.com", forHosts: ["dash.example.com"] };
const ACCEPT = ["origin", "preview"];

let tmp: string;
let origHome: string | undefined;
let tick = 0;
const cfgFile = () => path.join(tmp, ".pi", "dashboard", "config.json");
/** Write the file and force a distinct mtime so the mtime-gated snapshot sees the change within one millisecond. */
function writeConfig(previewOrigins: object): void {
  fs.mkdirSync(path.dirname(cfgFile()), { recursive: true });
  fs.writeFileSync(cfgFile(), JSON.stringify({ liveServer: { previewOrigins } }), { mode: 0o600 });
  tick += 2;
  const t = new Date(1_700_000_000_000 + tick * 1000);
  fs.utimesSync(cfgFile(), t, t);
}

function rawGet(port: number, host: string, urlPath = "/"): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: urlPath, headers: { host }, setHost: false }, (res) => {
      let body = "";
      res.on("data", (c) => {
        body += c;
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("T.E40 / #E40 — enabled:false rollback with live tier-1 and tier-2 entries", () => {
  let upstream: http.Server;
  let app: FastifyInstance;
  let dispatch: PreviewDispatch;
  let store: LiveCapabilityStore;
  let port: number;
  let dashboardHits: string[];
  let upstreamSeen: string[];
  let deleted: { reason: CapabilityDeleteReason; tier: LiveCapabilityEntry["tier"] }[];
  let mintLog: string[];
  const conns = new Set<Socket>();

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lp-e40-"));
    origHome = process.env.HOME;
    process.env.HOME = tmp;
    resetConfigSnapshot();
    writeConfig({ wildcard: WILDCARD });

    upstreamSeen = [];
    upstream = http.createServer((req, res) => {
      upstreamSeen.push(req.url ?? "");
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("upstream-body");
    });
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
    const upstreamPort = (upstream.address() as AddressInfo).port;
    const manager = {
      get: (id: string) => (id === "vite-5173" ? { id, label: id, host: "127.0.0.1", port: upstreamPort } : undefined),
      getStatic: () => undefined,
      has: (id: string) => id === "vite-5173",
      use: () => {},
      list: () => [],
    } as unknown as LiveServerManager;

    deleted = [];
    mintLog = [];
    dashboardHits = [];
    store = new LiveCapabilityStore({
      isTargetLive: () => true,
      onDelete: (e, reason) => deleted.push({ reason, tier: e.tier }),
      getPreviewConfig: () => getResolvedPreviewOrigins(),
    });
    dispatch = createPreviewDispatch({ store, manager, isPeerLocal: () => true });
    app = Fastify({ logger: false, serverFactory: previewServerFactory(() => dispatch) as never });
    app.decorateRequest("isAuthenticated", false);
    app.addHook("onRequest", async (req) => {
      dashboardHits.push(req.url);
    });
    app.get("/", async () => "<html>dashboard-spa</html>");
    registerLiveServerRoutes(app, manager, { networkGuard: async () => undefined, capabilities: store, log: (l) => mintLog.push(l) });
    registerHostGateRoutes(app, {
      networkGuard: async () => undefined,
      state: new HostGateState(),
      getCtx: () => ({
        admission: { livePreviewEnabled: () => getResolvedPreviewOrigins().enabled },
        mode: "enforce",
        envOverridden: false,
      }),
    });
    await dispatch.ready();
    await app.listen({ port: 0, host: "127.0.0.1" });
    port = (app.server.address() as AddressInfo).port;
    app.server.on("connection", (s) => {
      conns.add(s);
      s.on("close", () => conns.delete(s));
    });
  });

  afterEach(async () => {
    for (const c of conns) c.destroy();
    await app.close();
    await dispatch.close();
    store.close();
    await new Promise<void>((r) => upstream.close(() => r()));
    process.env.HOME = origHome;
    resetConfigSnapshot();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const mint = (headers: Record<string, string>, body: object) =>
    app.inject({
      method: "POST",
      url: "/api/live-server/vite-5173/capability",
      remoteAddress: "127.0.0.1",
      headers: { host: "localhost:8000", ...headers },
      payload: body,
    });

  it("legacy mint + opaque 403 on the old label hosts + entries revoked `disabled` + host-gate list without label", async () => {
    // --- live tier-1 and tier-2 entries
    const t1 = (await mint({ origin: "http://localhost:8000" }, { accept: ACCEPT })).json();
    const t2 = (await mint({ host: "dash.example.com", origin: "https://dash.example.com" }, { accept: ACCEPT })).json();
    expect(t1.tier).toBe(1);
    expect(t2.tier).toBe(2);
    const hosts = [new URL(t1.origin).host, new URL(t2.origin).host];
    const labels = hosts.map((h) => h.split(".")[0]);
    for (const h of hosts) expect((await rawGet(port, h, "/x")).status, h).toBe(200); // served while enabled
    expect(store.size()).toBe(2);

    const before = (await app.inject({ method: "GET", url: "/api/host-gate", remoteAddress: "127.0.0.1" })).json();
    expect(JSON.stringify(before)).toContain("live-preview");

    // --- config flips to enabled:false (no restart)
    writeConfig({ enabled: false, wildcard: WILDCARD });
    dashboardHits.length = 0;
    upstreamSeen.length = 0;

    // old label hosts: the preview dispatcher's opaque 403 (checked BEFORE any sweep, so the dispatcher alone decides)
    for (const h of hosts) {
      for (const p of ["/", "/x", "/api/health"]) {
        const r = await rawGet(port, h, p);
        expect(r.status, `${h}${p}`).toBe(403);
        expect(JSON.parse(r.body), `${h}${p}`).toEqual({ error: "host_not_allowed" });
        expect(r.body).not.toContain("dashboard-spa");
      }
    }
    expect(dashboardHits).toEqual([]); // never the dashboard app
    expect(upstreamSeen).toEqual([]); // never the upstream

    // mint with accept → legacy shape, reason=disabled; the mint's sweep revokes every origin-bound entry
    const legacy = (await mint({ origin: "http://localhost:8000" }, { accept: ACCEPT })).json();
    expect(legacy).toMatchObject({ success: true, tier: "legacy" });
    expect(legacy.origin).toBeUndefined();
    expect(legacy.path).toMatch(/^\/live\/vite-5173\/~c\/[A-Za-z0-9_-]{22,}\/$/);
    const line = mintLog.at(-1) ?? "";
    expect(line).toMatch(/^\[live-preview\] mint tier=legacy /);
    expect(line).toContain("reason=disabled");
    expect(line).not.toMatch(/[a-z2-7]{26}\./);

    expect(deleted.map((d) => d.reason)).toEqual(["disabled", "disabled"]);
    expect(deleted.map((d) => d.tier).sort()).toEqual([1, 2]);
    expect(store.size()).toBe(1); // only the legacy entry survives
    expect(store.admittedHostCount()).toBe(0);
    for (const h of hosts) expect(store.isAdmittedHost(h)).toBe(false);

    // old label hosts stay 403 after the revocation too
    for (const h of hosts) expect((await rawGet(port, h, "/")).status).toBe(403);

    // host-gate list: no label, no origin, and no `live-preview` pattern row while disabled (Q23)
    const gate = await app.inject({ method: "GET", url: "/api/host-gate", remoteAddress: "127.0.0.1" });
    expect(gate.statusCode).toBe(200);
    const text = JSON.stringify(gate.json());
    for (const l of labels) expect(text).not.toContain(l);
    expect(text).not.toContain("live-preview");
    expect(text).not.toContain("live preview capability hosts");
  });
});
