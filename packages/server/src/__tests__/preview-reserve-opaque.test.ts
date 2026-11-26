/**
 * A reserved-but-unadopted `/preview/<pid>/` is indistinguishable from a never-issued pid (D9): real HTTP against the
 * production hook chain (preflight → capability hook → principal → universal guard) plus the WS-upgrade decision.
 * The comparison is byte-for-byte on status line, raw headers (minus `Date`) and body, for callers holding no credentials,
 * the reserver's credentials and another principal's.
 * See change: serve-live-previews-on-capability-origin (D9; test-plan #E97).
 */
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isWsOriginTrusted } from "../auth/cors-origin.js";
import { createNetworkGuardHook } from "../auth/localhost-guard.js";
import { type CapabilityPrincipal, createLiveCapabilityHook, LiveCapabilityStore, principalKeyOf } from "../live-server/live-capability.js";
import type { LiveServerManager } from "../live-server/live-server-manager.js";
import { registerLiveServerProxy } from "../live-server/live-server-proxy.js";
import { parsePreviewPath } from "../live-server/preview-path.js";
import { PreviewPathStore } from "../live-server/preview-path-store.js";
import { createPreviewPreflight } from "../live-server/preview-preflight.js";
import { registerLiveServerRoutes } from "../routes/live-server-routes.js";

const A: CapabilityPrincipal = { kind: "device", tier: "control", deviceId: "dev-A" };
const pol = { egress: "restricted", scripts: false } as const;
const U = "U".repeat(22); // never issued (a well-formed pid shape)

interface Raw {
  statusLine: string;
  headers: string[];
  body: string;
}

describe("T.E97 — a reserved pid looks unknown", () => {
  let app: FastifyInstance;
  let upstream: http.Server;
  let upstreamPort = 0;
  let upstreamHits: string[];
  let paths: PreviewPathStore;
  let reservationReads: number;
  let R: string;

  beforeEach(async () => {
    upstreamHits = [];
    upstream = http.createServer((req, res) => {
      upstreamHits.push(req.url ?? "");
      res.end("upstream-ok");
    });
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
    upstreamPort = (upstream.address() as AddressInfo).port;
    const manager = {
      get: (id: string) => (id === "t1" ? { id, label: "t", host: "127.0.0.1", port: upstreamPort } : undefined),
      getByPort: (p: number) => (p === upstreamPort ? { id: "t1", label: "t", host: "127.0.0.1", port: upstreamPort } : undefined),
      portRefusal: () => null,
      getStatic: () => undefined,
      has: (id: string) => id === "t1",
      use: () => {},
      list: () => [],
    } as unknown as LiveServerManager;
    paths = new PreviewPathStore({ targetIdForPort: (p) => (p === upstreamPort ? "t1" : undefined) });
    // Count every read of the reservation map: `validate()` must never consult it (the structural reason both answers are O(1) and equal).
    reservationReads = 0;
    const real = (paths as unknown as { reservations: Map<string, unknown> }).reservations;
    for (const m of ["get", "has", "entries", "values", "keys", Symbol.iterator] as const) {
      const orig = (real as never as Record<string | symbol, (...a: unknown[]) => unknown>)[m].bind(real);
      (real as never as Record<string | symbol, unknown>)[m] = (...a: unknown[]) => {
        reservationReads++;
        return orig(...a);
      };
    }
    const caps = new LiveCapabilityStore({ isTargetLive: () => true });
    app = Fastify({ logger: false });
    app.decorateRequest("isAuthenticated", false);
    app.addHook("onRequest", createPreviewPreflight(() => paths));
    app.addHook("onRequest", createLiveCapabilityHook(caps, paths));
    app.addHook("onRequest", async (req) => {
      const dev = req.headers["x-test-device"];
      if (typeof dev === "string") {
        const r = req as unknown as Record<string, unknown>;
        r.isAuthenticated = true;
        r.authVia = "device";
        r.principalTier = "control";
        r.principalDeviceId = dev;
      }
    });
    app.addHook("onRequest", createNetworkGuardHook({ trustedNetworks: () => [], logDenial: () => {} }));
    registerLiveServerRoutes(app, manager, { networkGuard: async () => undefined, capabilities: caps, previewPaths: paths, previewOrigins: () => ({ enabled: true, tiers: [1, 5], issues: [] }), log: () => {} });
    registerLiveServerProxy(app, manager);
    await app.listen({ port: 0, host: "127.0.0.1" });
    const reserved = paths.reserve(upstreamPort, { key: principalKeyOf(A), principal: A });
    if (!reserved.ok || !reserved.reserved) throw new Error("reserve");
    R = reserved.pid;
    expect(paths.reservationCount()).toBe(1);
  });
  afterEach(async () => {
    await app.close();
    upstream.closeAllConnections?.();
    await new Promise<void>((r) => upstream.close(() => r()));
  });
  const port = () => (app.server.address() as AddressInfo).port;

  /** One request, captured raw (status line, header list in wire order without `Date`, body). */
  const raw = (path: string, headers: Record<string, string> = {}, method = "GET"): Promise<Raw> =>
    new Promise((resolve, reject) => {
      const r = http.request({ host: "127.0.0.1", port: port(), path, method, headers, agent: false }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          const hs: string[] = [];
          for (let i = 0; i < res.rawHeaders.length; i += 2) if (res.rawHeaders[i].toLowerCase() !== "date") hs.push(`${res.rawHeaders[i]}: ${res.rawHeaders[i + 1]}`);
          resolve({ statusLine: `HTTP/${res.httpVersion} ${res.statusCode} ${res.statusMessage}`, headers: hs, body });
        });
      });
      r.on("error", reject);
      r.end();
    });

  /** Mirror of the `server.ts` live-scope upgrade decision, built from the same production functions. */
  const upgrade = (pid: string, origin?: string): Promise<string> =>
    new Promise((resolve) => {
      const s = net.connect(port(), "127.0.0.1", () =>
        s.write(`GET /preview/${pid}/ws HTTP/1.1\r\nHost: 127.0.0.1:${port()}\r\n${origin ? `Origin: ${origin}\r\n` : ""}Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: x\r\nSec-WebSocket-Version: 13\r\n\r\n`),
      );
      let buf = "";
      s.on("data", (c) => (buf += c.toString()));
      s.on("close", () => resolve(buf));
      s.on("error", () => resolve(buf));
    });
  const installUpgradeGate = () =>
    app.server.on("upgrade", (req, socket) => {
      const p = parsePreviewPath(req.url);
      const grant = p ? paths.validate(p.pid, { genuinelyLocal: true }) : null;
      if (!isWsOriginTrusted(req.headers.origin, req.headers.host, "live", { configuredOrigins: [], trustedNetworks: [] }, grant !== null)) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
      socket.destroy(); // no admitted capability for this pid: nothing is piped (same end for any unknown pid)
    });

  const creds: { name: string; headers: Record<string, string> }[] = [
    { name: "no credentials", headers: {} },
    { name: "the reserver's credentials", headers: { "x-test-device": "dev-A", cookie: "pi_dash_token=reserver" } },
    { name: "another principal's credentials", headers: { "x-test-device": "dev-B", cookie: "pi_dash_token=other" } },
  ];

  it("HTTP GET: status, raw headers and body equal a never-issued pid's (404), whoever asks; the upstream is never reached", async () => {
    for (const path of ["/app.js", "/", "/deep/a/b?x=1"]) {
      for (const c of creds) {
        const reserved = await raw(`/preview/${R}${path}`, c.headers);
        const unknown = await raw(`/preview/${U}${path}`, c.headers);
        expect(reserved.statusLine, `${c.name} ${path}`).toBe("HTTP/1.1 404 Not Found");
        expect(reserved, `${c.name} ${path}`).toEqual(unknown);
      }
    }
    // the bare form without a trailing segment too
    expect(await raw(`/preview/${R}`)).toEqual(await raw(`/preview/${U}`));
    expect(upstreamHits).toEqual([]);
    expect(paths.reservationCount()).toBe(1); // asking never consumes or reveals the reservation
  });

  it("the reserver's own credential does not change the answer", async () => {
    const withCreds = await raw(`/preview/${R}/x`, creds[1].headers);
    const without = await raw(`/preview/${R}/x`, creds[0].headers);
    expect(withCreds).toEqual(without);
  });

  it("CORS: `Origin: null` gets no `Access-Control-Allow-Origin`, on a plain request or a preflight, for R exactly as for U", async () => {
    const nullOrigin = { origin: "null" };
    for (const c of creds) {
      const rGet = await raw(`/preview/${R}/app.js`, { ...c.headers, ...nullOrigin });
      const uGet = await raw(`/preview/${U}/app.js`, { ...c.headers, ...nullOrigin });
      expect(rGet).toEqual(uGet);
      expect(rGet.headers.join("\n").toLowerCase()).not.toContain("access-control-allow-origin");
      const pre = { ...c.headers, ...nullOrigin, "access-control-request-method": "POST", "access-control-request-headers": "content-type" };
      const rPre = await raw(`/preview/${R}/api`, pre, "OPTIONS");
      const uPre = await raw(`/preview/${U}/api`, pre, "OPTIONS");
      expect(rPre, c.name).toEqual(uPre);
      expect(rPre.statusLine).not.toContain("204"); // a preflight is only answered for a LIVE pid
      expect(rPre.headers.join("\n").toLowerCase()).not.toContain("access-control-allow-origin");
    }
    expect(upstreamHits).toEqual([]);
  });

  it("WS upgrade: the response bytes (`HTTP/1.1 403` for an opaque origin; a bare close otherwise) are identical to a never-issued pid's", async () => {
    installUpgradeGate();
    const withNull = [await upgrade(R, "null"), await upgrade(U, "null")];
    expect(withNull[0]).toBe("HTTP/1.1 403 Forbidden\r\n\r\n");
    expect(withNull[0]).toBe(withNull[1]);
    const noOrigin = [await upgrade(R), await upgrade(U)];
    expect(noOrigin[0]).toBe(noOrigin[1]);
    expect(noOrigin[0]).not.toContain("101");
    expect(upstreamHits).toEqual([]);
  });

  it("no timing branch: validating R and U both resolve through the live-entry map only; the reservation map is never read", () => {
    const before = reservationReads;
    expect(paths.validate(R, { genuinelyLocal: true })).toBeNull();
    expect(paths.validate(U, { genuinelyLocal: true })).toBeNull();
    expect(reservationReads).toBe(before); // the same O(1) lookup for both; R's presence is invisible to the request path
  });

  it("control: once adopted (a mint for the target), the SAME pid stops looking unknown and is forwarded", async () => {
    const minted = paths.mint("t1", A, { policy: pol, port: upstreamPort });
    expect(minted.ok && minted.pid).toBe(R); // the reservation was adopted
    const live = await raw(`/preview/${R}/app.js`, {});
    expect(live.statusLine).toBe("HTTP/1.1 200 OK");
    expect(live.body).toBe("upstream-ok");
    expect(upstreamHits).toEqual([`/preview/${R}/app.js`]);
    expect((await raw(`/preview/${U}/app.js`, {})).statusLine).toBe("HTTP/1.1 404 Not Found");
  });
});
