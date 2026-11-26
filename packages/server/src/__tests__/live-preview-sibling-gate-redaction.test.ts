/**
 * Redaction in the SIBLING gates (D2, D13): every gate that prints part of a request — host gate, duplicate-cookie gate, CSRF
 * gate, WS gate, universal network guard, tier-3 pool listener — keeps a preview label, a tier-5 pid and a tier-3 `?k=` secret out
 * of its log line (`<redacted>.localhost:8000`, `k=<redacted>`, `/preview/<redacted>`), and the cookie-gate line carries names and
 * a count, never values.
 *
 * See change: serve-live-previews-on-capability-origin (D2, D13; test-plan #E158).
 */
import fs from "node:fs";
import net, { type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDuplicateCookieGate } from "../auth/duplicate-cookie-gate.js";
import { createHostGate, HostGateState } from "../auth/host-gate.js";
import { createNetworkGuardHook } from "../auth/localhost-guard.js";
import { createMutationOriginGate } from "../auth/mutation-origin-gate.js";
import { type CapabilityPrincipal, LiveCapabilityStore, principalKeyOf, sessionKeyOf } from "../live-server/live-capability.js";
import type { LiveServerManager } from "../live-server/live-server-manager.js";
import { createPreviewPool } from "../live-server/preview-pool.js";
import { rawRequest } from "../test-support/raw-http-client.js";

const LABEL = "k7q4zm2x5c6h3v4d5fjqwyabn7";
const PID = "AbCdEfGhIjKlMnOpQrStUv";
const SECRET = "SECRETSECRETSECRET123";
const TOKEN = "TokenTokenTokenTokenToken01";

let captured: string[];
let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lp-e158-"));
  captured = [];
  const sink = (...a: unknown[]) => void captured.push(a.map(String).join(" "));
  vi.spyOn(console, "log").mockImplementation(sink);
  vi.spyOn(console, "warn").mockImplementation(sink);
  vi.spyOn(console, "error").mockImplementation(sink);
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Nothing the request carried that is secret may be in the capture, in any letter case. */
function expectClean(label = LABEL): void {
  const all = captured.join("\n");
  const lower = all.toLowerCase();
  expect(lower).not.toContain(label.toLowerCase());
  expect(all).not.toContain(PID);
  expect(all).not.toContain(SECRET);
  expect(all).not.toContain(TOKEN);
}

describe("T.E158 / #E158 — redaction in sibling gates", () => {
  it("host gate, cookie gate, CSRF gate and network guard: label → <redacted>.localhost:8000, k= → k=<redacted>, /preview/<pid> → /preview/<redacted>", async () => {
    const app = Fastify({ logger: false });
    app.decorateRequest("isAuthenticated", false);
    // the server.ts order: host gate → duplicate-cookie gate → … → mutation gate → … → network guard
    app.addHook("onRequest", createHostGate(() => ({ admission: {}, mode: "enforce", envOverridden: false }), new HostGateState(), () => 8000));
    app.addHook("onRequest", createDuplicateCookieGate({ tier2: () => false }));
    app.addHook("onRequest", createMutationOriginGate(() => ({ configuredOrigins: [], trustedNetworks: [] })));
    app.addHook("onRequest", createNetworkGuardHook({ trustedNetworks: () => [] }));
    app.get("/", async () => "ok");
    app.get("/api/x", async () => "ok");
    app.post("/api/x", async () => "ok");
    await app.ready();
    try {
      const previewOrigin = `http://${LABEL}.localhost:8000`;
      // 1. host gate: a rebinding Host with a preview-shaped Origin, tier-3 `?k=` and a tier-5 path
      // (distinct Hosts: the host gate logs one line per Host per window)
      for (const [i, url] of [`/?k=${SECRET}`, `/preview/${PID}/x?k=${SECRET}`].entries()) {
        const r = await app.inject({ method: "GET", url, remoteAddress: "127.0.0.1", headers: { host: `rebind${i}.example`, origin: previewOrigin } });
        expect(r.statusCode, url).toBe(403);
      }
      // 2. duplicate-cookie gate: names and a count, no values; the route is redacted
      const dup = await app.inject({
        method: "GET",
        url: `/preview/${PID}/x?k=${SECRET}`,
        remoteAddress: "127.0.0.1",
        headers: { host: "localhost:8000", cookie: `pi_dash_token=${SECRET}; pi_dash_token=${TOKEN}` },
      });
      expect(dup.statusCode).toBe(400);
      // 3. CSRF gate: a preview Origin on a mutation, with the capability forms in the URL
      const csrf = await app.inject({
        method: "POST",
        url: `/api/x?next=/preview/${PID}/x?k=${SECRET}`,
        remoteAddress: "127.0.0.1",
        headers: { host: "localhost:8000", origin: previewOrigin },
      });
      expect(csrf.statusCode).toBe(403);
      // 4. universal network guard: an untrusted peer on a path carrying the capability forms
      for (const url of [`/api/x/preview/${PID}/y?k=${SECRET}`, `/api/x/~c/${TOKEN}/y`]) {
        const g = await app.inject({ method: "GET", url, remoteAddress: "203.0.113.5", headers: { host: "localhost:8000" } });
        expect(g.statusCode, url).toBe(403);
      }

      const host = captured.filter((l) => l.startsWith("[host-gate]"));
      expect(host.length).toBeGreaterThan(0);
      const hostAll = host.join("\n");
      expect(hostAll).toContain("origin=http://<redacted>.localhost:8000");
      expect(hostAll).toContain("/preview/<redacted>");
      expect(hostAll).toContain("k=<redacted>");

      const cookie = captured.filter((l) => l.startsWith("[cookie-gate]"));
      expect(cookie).toHaveLength(1);
      expect(cookie[0]).toMatch(/^\[cookie-gate\] refused duplicate cookie name=pi_dash_token count=2 route=\/preview\/<redacted>\/x$/);

      const csrfLines = captured.filter((l) => l.startsWith("[csrf-gate]"));
      expect(csrfLines).toHaveLength(1);
      expect(csrfLines[0]).toContain("origin=http://<redacted>.localhost:8000");
      expect(csrfLines[0]).toContain("/preview/<redacted>");
      expect(csrfLines[0]).toContain("k=<redacted>");

      const guard = captured.filter((l) => /network|guard|denied|denial/i.test(l) && !l.startsWith("[host-gate]") && !l.startsWith("[csrf-gate]") && !l.startsWith("[cookie-gate]"));
      expect(guard.length).toBeGreaterThan(0);
      expect(guard.join("\n")).toMatch(/preview\/<redacted>|~c\/<redacted>/);

      expectClean();
    } finally {
      await app.close();
    }
  });

  it("tier-3 pool listener: `GET /?k=SECRET` refused (wrong k, no cookie, wrong host) logs nothing secret", async () => {
    const probe = net.createServer();
    await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
    const poolPort = (probe.address() as AddressInfo).port;
    await new Promise<void>((r) => probe.close(() => r()));
    const manager = {
      get: (id: string) => (id === "t1" ? { id, label: id, host: "127.0.0.1", port: 9 } : undefined),
      getStatic: () => undefined,
      has: () => true,
      use: () => {},
      list: () => [],
    } as unknown as LiveServerManager;
    let pool!: ReturnType<typeof createPreviewPool>;
    const store = new LiveCapabilityStore({ isTargetLive: () => true, onDelete: (e, r) => pool.onDelete(e, r) });
    // default log sink (console.log): the capture is what an operator would see
    pool = createPreviewPool({
      range: () => ({ from: poolPort, to: poolPort }),
      bindHost: () => "127.0.0.1",
      findByPoolPort: (p) => store.findByPoolPort(p),
      revokeByPoolPort: (p, r) => store.revokeByPoolPort(p, r),
      manager,
    });
    try {
      const principal: CapabilityPrincipal = { kind: "session", tier: "control", sessionKey: sessionKeyOf("sess") };
      const a = await pool.allocate(principalKeyOf(principal), "127.0.0.1");
      if (!a.ok) throw new Error("allocate");
      store.mint("t1", principal, { preview: { tier: 3, ancestors: ["http://127.0.0.1:8000"], fixed: { origin: a.origin, originHost: a.originHost, poolPort: a.port } } });
      const statuses: number[] = [];
      for (const [headers, url] of [
        [{ host: `127.0.0.1:${a.port}` }, `/?k=${SECRET}`],
        [{ host: `127.0.0.1:${a.port}`, cookie: "pi_dash_token=sess" }, `/?k=${SECRET}&to=/preview/${PID}/x`],
        [{ host: `evil.example:${a.port}`, cookie: "pi_dash_token=sess" }, `/?k=${SECRET}`],
        [{ host: `127.0.0.1:${a.port}`, cookie: "pi_dash_token=sess", origin: `http://${LABEL}.localhost:8000` }, `/?k=${SECRET}`],
      ] as const) {
        const res = await rawRequest({ port: a.port, path: url, headers: { ...headers } }).done;
        statuses.push(res.status);
      }
      expect(statuses.every((s) => s === 403 || s === 404)).toBe(true);
      expectClean();
      // the only lines the pool wrote are its own redaction-safe lifecycle lines
      for (const l of captured) expect(l).toMatch(/^\[live-preview\] pool (bind|release|exhausted) /);
    } finally {
      store.close();
      await pool.close();
    }
  });

  it("WS gate (REAL server upgrade): a preview Origin (lower / UPPER case) is rejected with the label redacted; no label anywhere", async () => {
    const { createTestServer } = await import("../test-support/test-server.js");
    const { proofHeaders } = await import("../test-support/local-credential-stamp.js");
    const { WebSocket } = await import("ws");
    const handle = await createTestServer();
    try {
      const port = handle.httpPort;
      for (const origin of [`http://${LABEL}.localhost:${port}`, `http://${LABEL.toUpperCase()}.LOCALHOST.:${port}`]) {
        const status = await new Promise<number | string>((resolve) => {
          const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?next=/preview/${PID}/x?k=${SECRET}`, { headers: { ...proofHeaders(`http://127.0.0.1:${port}/ws`), origin } });
          ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
          ws.on("open", () => {
            ws.close();
            resolve("open");
          });
          ws.on("error", () => resolve("error"));
        });
        expect(status, origin).toBe(403);
      }
      const ws = captured.filter((l) => l.startsWith("[ws-gate] rejected upgrade"));
      expect(ws).toHaveLength(2);
      expect(ws[0]).toContain(`origin=http://<redacted>.localhost:${port}`);
      expect(ws[1]).toContain(`origin=http://<redacted>.LOCALHOST.:${port}`);
      expectClean();
    } finally {
      await handle.stop();
    }
  }, 120_000);
});
