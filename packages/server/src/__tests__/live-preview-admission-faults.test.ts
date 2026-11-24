/**
 * Preview admission under fault and delay, through the REAL dispatcher on a real socket:
 *   - T.X5  a store accessor / dynamic-host source that throws fails CLOSED (403, never admit); `/api/host-gate` stays 200;
 *   - T.X7  refusal reasons are exact (`unknown` vs `expired` vs `wrong-host` vs `wrong-port`), `expired` only between
 *           expiry and removal (no tombstones, Q25), and the response is identical for every reason (no oracle);
 *   - T.X36 a capability that expires while a request is in flight: the stream ends cleanly, the NEXT request is a 403 with one
 *           redacted `refuse … reason=expired` line, no restart.
 *
 * See change: serve-live-previews-on-capability-origin (D3, D13; test-plan #X5, #X7, #X36).
 */
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { parsePreviewOrigins, type ResolvedPreviewOrigins, resolvePreviewOrigins } from "@blackbelt-technology/pi-dashboard-shared/preview-origins.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HostGateState } from "../auth/host-gate.js";
import { LiveCapabilityStore } from "../live-server/live-capability.js";
import type { LiveServerManager } from "../live-server/live-server-manager.js";
import { createPreviewDispatch, type PreviewDispatch, previewServerFactory } from "../live-server/preview-dispatch.js";
import { createPreviewObserver } from "../live-server/preview-observe.js";
import { previewLogHash } from "../live-server/preview-origin.js";
import { registerHostGateRoutes } from "../routes/host-gate-routes.js";

const A26 = "a".repeat(26);
const MIN = 60_000;
const SHAPE: ResolvedPreviewOrigins = resolvePreviewOrigins(
  parsePreviewOrigins({ enabled: true, wildcard: { suffix: "preview.example.com", forHosts: ["dash.example.com"] } }).value,
  { port: 8000, piPort: 9999, allowedHosts: [], publicBaseUrls: [], corsOrigins: [] },
);
const tier1 = {
  preview: {
    tier: 1 as const,
    ancestors: ["http://localhost:8000"],
    buildOrigin: (l: string) => ({ origin: `http://${l}.localhost:8000`, originHost: `${l}.localhost:8000` }),
  },
};

interface Res {
  status: number;
  body: string;
  headers: http.IncomingHttpHeaders;
}
function get(port: number, host: string, urlPath = "/"): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: urlPath, headers: { host }, setHost: false, agent: false }, (res) => {
      let body = "";
      res.on("data", (c) => {
        body += c;
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}

interface Rig {
  port: number;
  store: LiveCapabilityStore;
  dispatch: PreviewDispatch;
  lines: string[];
  clock: { now: number };
  upstreamHits: string[];
  dashboardHits: string[];
  /** Hold the upstream's response between its first and second chunk until `release()`. */
  gate: { entered: Promise<void>; release: () => void };
  mint: () => string;
  stop: () => Promise<void>;
}

async function rig(opts: { store?: Partial<Pick<LiveCapabilityStore, "lookupByHost">> } = {}): Promise<Rig> {
  const clock = { now: 1_000_000 };
  const lines: string[] = [];
  const upstreamHits: string[] = [];
  const dashboardHits: string[] = [];
  let release!: () => void;
  const released = new Promise<void>((r) => {
    release = r;
  });
  let entered!: () => void;
  const enteredP = new Promise<void>((r) => {
    entered = r;
  });
  const upstream = http.createServer((req, res) => {
    upstreamHits.push(req.url ?? "");
    if (req.url === "/stream") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.write("chunk1;");
      entered();
      released
        .then(() => {
          res.write("chunk2;");
          res.end("done");
        })
        .catch(() => res.destroy());
      return;
    }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("upstream-body");
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const upPort = (upstream.address() as AddressInfo).port;
  const manager = {
    get: (id: string) => (id === "vite-5173" ? { id, label: id, host: "127.0.0.1", port: upPort } : undefined),
    getStatic: () => undefined,
    has: (id: string) => id === "vite-5173",
    use: () => {},
    list: () => [],
  } as unknown as LiveServerManager;
  const store = new LiveCapabilityStore({ now: () => clock.now, isTargetLive: () => true });
  const observer = createPreviewObserver({ sink: (l) => lines.push(l), now: () => clock.now });
  const dispatch = createPreviewDispatch({
    store: opts.store ? ({ lookupByHost: opts.store.lookupByHost } as never) : store,
    manager,
    isPeerLocal: () => true,
    shape: { resolved: SHAPE, classify: () => null },
    onRefused: (r, h) => observer.refused(r, h),
    onAdmitted: (h, tier) => observer.admitted(h, tier),
  });
  const app: FastifyInstance = Fastify({ logger: false, serverFactory: previewServerFactory(() => dispatch) as never });
  app.addHook("onRequest", async (r) => {
    dashboardHits.push(r.url);
  });
  app.get("/", async () => "dashboard-spa");
  await dispatch.ready();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const conns = new Set<Socket>();
  app.server.on("connection", (s) => {
    conns.add(s);
    s.on("close", () => conns.delete(s));
  });
  return {
    port: (app.server.address() as AddressInfo).port,
    store,
    dispatch,
    lines,
    clock,
    upstreamHits,
    dashboardHits,
    gate: { entered: enteredP, release },
    mint: () => store.mint("vite-5173", { kind: "local" }, tier1).token,
    stop: async () => {
      release();
      for (const s of conns) s.destroy();
      await app.close();
      await dispatch.close();
      store.close();
      await new Promise<void>((r) => upstream.close(() => r()));
    },
  };
}

let r: Rig | undefined;
afterEach(async () => {
  await r?.stop();
  r = undefined;
});

describe("T.X5 / #X5 — store accessor failure during admission fails closed", () => {
  it("lookupByHost throws → the label request is a 403 (never forwarded, never the dashboard)", async () => {
    r = await rig({
      store: {
        lookupByHost: () => {
          throw new Error("store exploded: secret-internal-detail");
        },
      },
    });
    for (const urlPath of ["/", "/x?q=1", "/api/health"]) {
      const res = await get(r.port, `${A26}.localhost:8000`, urlPath);
      expect(res.status, urlPath).toBe(403);
      expect(JSON.parse(res.body), urlPath).toEqual({ error: "host_not_allowed" });
      expect(res.body).not.toMatch(/exploded|secret-internal-detail|stack|Error/);
    }
    expect(r.upstreamHits).toEqual([]);
    expect(r.dashboardHits).toEqual([]);
  });

  it("a throwing dynamic-host source leaves `GET /api/host-gate` 200 with the `live-preview` row omitted and no stack in the body", async () => {
    const app = Fastify({ logger: false });
    registerHostGateRoutes(app, {
      networkGuard: async () => undefined,
      state: new HostGateState(),
      getCtx: () => ({
        admission: {
          livePreviewEnabled: () => {
            throw new Error("preview config unreadable\n    at secret (/internal/path.ts:1:1)");
          },
          getLiveTunnelOrigins: () => {
            throw new Error("tunnel source down");
          },
          tlsListenerNames: () => {
            throw new Error("cert store down");
          },
        },
        mode: "enforce",
        envOverridden: false,
      }),
    });
    await app.ready();
    try {
      const res = await app.inject({ method: "GET", url: "/api/host-gate", remoteAddress: "127.0.0.1" });
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain("live-preview");
      expect(res.body).not.toContain("live preview capability hosts");
      expect(res.body).not.toMatch(/unreadable|internal\/path|tunnel source down|cert store down|\bat \w+ \(/);
      expect(res.json().admitted.map((x: { source: string }) => x.source)).toEqual(expect.arrayContaining(["loopback", "ip-address", "local"]));
    } finally {
      await app.close();
    }
  });
});

describe("T.X7 / #X7 — refusal reason accuracy", () => {
  it("wrong-port / wrong-host exact; deleted-entry → unknown; expired only while the entry still exists; identical bodies (no oracle)", async () => {
    r = await rig();
    const { port, store, clock, lines } = r;
    const label = r.mint();
    const refuseLines = () => lines.filter((l) => l.startsWith("[live-preview] refuse "));
    const next = () => {
      clock.now += MIN + 1; // past the observer's 60 s per-host window: every probe logs
    };

    const wrongPort = await get(port, `${label}.localhost:9999`, "/a");
    next();
    const wrongHost = await get(port, `${label}.preview.example.com`, "/a");
    next();
    const never = `${"c".repeat(26)}`;
    const unknownRes = await get(port, `${never}.localhost:8000`, "/a");
    next();
    expect(refuseLines()).toEqual([
      `[live-preview] refuse h=${previewLogHash(label)} reason=wrong-port`,
      `[live-preview] refuse h=${previewLogHash(label)} reason=wrong-host`,
      `[live-preview] refuse h=${previewLogHash(never)} reason=unknown`,
    ]);

    // the live entry is untouched by those probes
    expect((await get(port, `${label}.localhost:8000`, "/a")).status).toBe(200);

    // expired: the entry exists between expiry and removal → `expired` on the FIRST request, then it is gone → `unknown`
    clock.now += 31 * MIN; // idle (30 min) elapsed, no sweep ran
    expect(store.size()).toBe(1);
    const expired = await get(port, `${label}.localhost:8000`, "/a");
    expect(store.size()).toBe(0);
    next();
    const afterRemoval = await get(port, `${label}.localhost:8000`, "/a");
    expect(refuseLines().slice(3)).toEqual([
      `[live-preview] refuse h=${previewLogHash(label)} reason=expired`,
      `[live-preview] refuse h=${previewLogHash(label)} reason=unknown`,
    ]);

    // swept before the request (the store's own sweep ran) → `unknown`, never `expired`
    const swept = r.mint();
    clock.now += 31 * MIN;
    store.mint("vite-5173", { kind: "local" }); // mint sweeps: the expired entry is removed
    next();
    const sweptRes = await get(port, `${swept}.localhost:8000`, "/a");
    expect(refuseLines().at(-1)).toBe(`[live-preview] refuse h=${previewLogHash(swept)} reason=unknown`);
    expect(refuseLines().filter((l) => l.includes("reason=expired"))).toHaveLength(1);

    // no oracle: every refusal answers the same status, body and headers
    const all = [wrongPort, wrongHost, unknownRes, expired, afterRemoval, sweptRes];
    for (const x of all) {
      expect(x.status).toBe(403);
      expect(x.body).toBe('{"error":"host_not_allowed"}');
    }
    const shape = (x: Res) => JSON.stringify(Object.entries(x.headers).filter(([k]) => k !== "date").sort());
    expect(new Set(all.map(shape)).size).toBe(1);
    // none of the probe log lines carries the raw label
    expect(lines.join("\n")).not.toContain(label);
  });
});

describe("T.X36 / #X36 — capability expires between admit and request (delay)", () => {
  it("the in-flight stream ends cleanly; the next request is a 403 with one redacted `refuse … reason=expired` line; no restart", async () => {
    r = await rig();
    const { port, clock, lines, store } = r;
    const label = r.mint();

    // --- request A: admitted, upstream has started streaming
    const inflight = get(port, `${label}.localhost:8000`, "/stream");
    await r.gate.entered;
    expect(lines.filter((l) => l.startsWith("[live-preview] admit "))).toEqual([`[live-preview] admit h=${previewLogHash(label)} tier=1`]);

    // --- the capability's idle lifetime elapses while A is in flight (decision for A was made at ITS request time)
    clock.now += 31 * MIN;
    r.gate.release();
    const a = await inflight;
    expect(a.status).toBe(200);
    expect(a.body).toBe("chunk1;chunk2;done"); // ended cleanly, nothing truncated

    // --- the NEXT request is decided against current state: refused, expired, exactly one redacted line
    const b = await get(port, `${label}.localhost:8000`, "/x");
    expect(b.status).toBe(403);
    expect(JSON.parse(b.body)).toEqual({ error: "host_not_allowed" });
    expect(r.upstreamHits).toEqual(["/stream"]); // B never reached the upstream
    const refuse = lines.filter((l) => l.startsWith("[live-preview] refuse "));
    expect(refuse).toEqual([`[live-preview] refuse h=${previewLogHash(label)} reason=expired`]);
    expect(lines.join("\n")).not.toContain(label);
    expect(store.size()).toBe(0);

    // --- a fresh capability needs no restart
    const fresh = r.mint();
    expect((await get(port, `${fresh}.localhost:8000`, "/y")).status).toBe(200);
  });
});
