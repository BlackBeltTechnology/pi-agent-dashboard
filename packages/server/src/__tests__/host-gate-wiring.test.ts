/**
 * Host-admission gate — REST wiring (issue #637, design D1/D4/D5/D6).
 *
 * Drives the REAL `createHostGate` hook through a minimal Fastify app that
 * mirrors the server wiring (hook registered BEFORE @fastify/cors, probe
 * routes) for the fine-grained matrix, and the REAL server builder
 * (`createTestServer`, the api-origin-gate.test.ts pattern) for everything
 * live-config / auth-parity / raw-socket shaped.
 *
 * Folds test-plan #E13–#E16, #E19–#E25, #X1–#X5, #X7 (REST half).
 * See change: add-host-allowlist-admission.
 */

import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostAdmissionOptions } from "../auth/host-admission.js";
import {
  buildHostGateResponse,
  createHostGate,
  type HostGateContext,
  HostGateState,
} from "../auth/host-gate.js";
import { resetConfigSnapshot } from "../config-snapshot.js";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";

const GATE_ENV = "PI_DASHBOARD_HOST_GATE";

function setGateEnv(value: string | undefined): void {
  if (value === undefined) delete process.env[GATE_ENV];
  else process.env[GATE_ENV] = value;
}

/** Admission sources covering every D1 rule (loopback/IP/.local are built in). */
const ADMISSION: HostAdmissionOptions = {
  publicBaseUrls: ["https://pi.example.com"],
  allowedHosts: ["dash.home.arpa"],
};

const handler = vi.fn(async () => ({ ok: true }));

/** Minimal app mirroring the server wiring: the host-gate hook BEFORE cors. */
async function makeApp(
  admission: HostAdmissionOptions,
  mode: "report" | "enforce",
  port = 8000,
): Promise<{ app: FastifyInstance; state: HostGateState }> {
  const app = Fastify({ logger: false });
  const state = new HostGateState();
  const getCtx = (): HostGateContext => ({ admission, mode, envOverridden: false });
  app.addHook("onRequest", createHostGate(getCtx, state, () => port));
  app.get("/", handler);
  app.get("/api/health", handler);
  app.get("/api/sessions", handler);
  app.post("/api/tunnel-connect", handler);
  app.get("/api/host-gate", async () => buildHostGateResponse(getCtx(), state));
  // Registered AFTER the hook, exactly like server.ts, so a refusal carries
  // no ACAO while an admitted cross-origin request does.
  await app.register(cors, { origin: (origin, cb) => cb(null, true), credentials: true });
  await app.ready();
  return { app, state };
}

/**
 * Hand-write a raw HTTP request and return the status code.
 *
 * `fetch`/`inject` always send a Host header (`inject` defaults it to
 * `localhost:80`; undici DROPS a forged one — `Host` is a spec-forbidden
 * header name), so hostile-Host and Host-less requests are only expressible
 * on a raw socket — the shape that actually arrives from an attacker.
 */
function rawGet(port: number, raw: string): Promise<string> {
  return new Promise((resolve) => {
    const sock = net.connect(port, "127.0.0.1", () => sock.write(raw));
    let buf = "";
    sock.on("data", (c) => {
      buf += c.toString();
      if (buf.includes("\r\n")) {
        sock.destroy();
        resolve(buf.split(" ")[1] ?? "");
      }
    });
    sock.on("error", () => resolve(""));
    sock.on("close", () => resolve(buf.split(" ")[1] ?? ""));
    setTimeout(() => {
      sock.destroy();
      resolve(buf.split(" ")[1] ?? "");
    }, 5000);
  });
}

/**
 * `node:http` request with a FORGED Host header — the faithful rebinding
 * shape (`fetch` cannot express it: `Host` is a forbidden header name).
 */
function request(
  port: number,
  method: "GET" | "POST",
  path: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<{ status: number; headers: Record<string, string | undefined>; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method, path, headers },
      (res) => {
        let buf = "";
        res.on("data", (c: Buffer) => (buf += c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | undefined>,
            text: buf,
          }),
        );
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// ─── Minimal app: the real hook factory, wiring-shaped ordering ─────────────

describe("REST host gate — minimal app (real hook before real cors)", () => {
  let errors: string[];
  let spy: ReturnType<typeof vi.spyOn>;
  const apps: FastifyInstance[] = [];

  beforeEach(() => {
    handler.mockClear();
    errors = [];
    spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map((a) => String(a)).join(" "));
    });
  });

  afterEach(async () => {
    for (const app of apps) await app.close();
    apps.length = 0;
    spy.mockRestore();
  });

  const build = (admission: HostAdmissionOptions, mode: "report" | "enforce", port?: number) =>
    makeApp(admission, mode, port).then(({ app, state }) => {
      apps.push(app);
      return { app, state };
    });

  const inject = (app: FastifyInstance, headers: Record<string, string>, url = "/api/health") =>
    app.inject({ method: "GET", url, headers });

  it("#E13 refuses the rebinding pair and Origin-less reads in enforce mode, handler never runs", async () => {
    const { app } = await build(ADMISSION, "enforce");

    const read = await inject(app, { host: "rebind.example:8000" }, "/api/sessions");
    expect(read.statusCode).toBe(403);
    const body = read.json();
    expect(body).toMatchObject({ success: false, error: "host_not_allowed" });
    expect(body.hint).toContain("allowedHosts");
    expect(body.hint).toContain("publicBaseUrls");
    expect(read.headers["access-control-allow-origin"]).toBeUndefined();

    const mutate = await app.inject({
      method: "POST",
      url: "/api/tunnel-connect",
      headers: { host: "rebind.example:8000", origin: "http://rebind.example:8000" },
    });
    expect(mutate.statusCode).toBe(403);
    expect(handler).not.toHaveBeenCalled();

    // Control: an admitted Host on the SAME app reaches the handler and cors
    // does add ACAO — proving the plugin is registered, just ordered after.
    const ok = await inject(app, { host: "localhost:8000", origin: "http://localhost:8000" });
    expect(ok.statusCode).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(ok.headers["access-control-allow-origin"]).toBeDefined();
  });

  it("#E14 admits loopback, IP literals, .local, publicBaseUrls and allowedHosts in BOTH modes", async () => {
    for (const mode of ["report", "enforce"] as const) {
      const { app } = await build(ADMISSION, mode);
      for (const host of [
        "localhost:8000",
        "127.0.0.1",
        "192.168.1.50:8000",
        "[fe80::1]:8000",
        "mac.local:8000",
        "pi.example.com",
        "dash.home.arpa",
      ]) {
        handler.mockClear();
        const res = await inject(app, { host });
        expect(res.statusCode, `${mode} ${host}`).toBe(200);
        expect(handler, `${mode} ${host}`).toHaveBeenCalledTimes(1);
      }
    }
  });

  it("#E15 report mode serves the request and logs exactly one would-refuse line", async () => {
    const { app } = await build(ADMISSION, "report");

    const res = await inject(app, { host: "rebind.example" });
    expect(res.statusCode).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);

    const lines = errors.filter((l) => l.includes("[host-gate]"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("would-refuse host=rebind.example");
  });

  it("#E19 negotiates HTML only when the FIRST Accept media type is text/html", async () => {
    const { app } = await build(ADMISSION, "enforce");
    const cases: Array<[string | undefined, string]> = [
      ["text/html,*/*;q=0.8", "text/html"],
      ["application/json", "application/json"],
      ["application/json, text/html;q=0.9", "application/json"],
      ["*/*", "application/json"],
      [undefined, "application/json"],
    ];
    for (const [accept, contentType] of cases) {
      const res = await inject(app, { host: "rebind.example:8000", ...(accept ? { accept } : {}) }, "/");
      expect(res.statusCode, String(accept)).toBe(403);
      expect(res.headers["content-type"], String(accept)).toContain(contentType);
    }
  });

  it("#E20 the HTML page names the received Host, localhost:<port> and both config keys — nothing else", async () => {
    const { app } = await build(
      { ...ADMISSION, getLiveTunnelOrigins: () => ["https://abc.share.zrok.io"] },
      "enforce",
    );

    const res = await inject(app, { host: "rebind.example:8000", accept: "text/html" }, "/");
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain("rebind.example:8000");
    expect(res.body).toContain("localhost:8000");
    expect(res.body).toContain("allowedHosts");
    expect(res.body).toContain("publicBaseUrls");
    // No script, no asset, no enumeration of the admitted set.
    expect(res.body).not.toContain("<script");
    expect(res.body).not.toContain("/assets/");
    expect(res.body).not.toContain("abc.share.zrok.io");
    expect(res.body).not.toContain("dash.home.arpa");
  });

  it("#E21 escapes the attacker-controlled received Host", async () => {
    const { app } = await build(ADMISSION, "enforce");

    const res = await inject(app, { host: "a<img>.example", accept: "text/html" }, "/");
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain("a&lt;img&gt;.example");
    expect(res.body).not.toContain("<img>");
  });

  it("#X4 a throwing tunnel source fails empty: loopback 200, tunnel host 403, never 500", async () => {
    const { app } = await build(
      { ...ADMISSION, getLiveTunnelOrigins: () => { throw new Error("tunnel store down"); } },
      "enforce",
    );

    const loopback = await inject(app, { host: "localhost:8000" });
    expect(loopback.statusCode).toBe(200);

    const tunnel = await inject(app, { host: "abc.share.zrok.io" });
    expect(tunnel.statusCode).toBe(403);
  });

  it("#X1 a hostile Host value cannot forge log lines", async () => {
    const { app, state } = await build(ADMISSION, "report");

    await inject(app, { host: "rebind.example\r\n[host-gate] refused host=forged" });

    const lines = errors.filter((l) => l.includes("[host-gate]"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("\n");
    expect(lines[0]).not.toContain("forged");
    expect(state.recent()[0]?.host).toBe("(malformed)");
  });

  it("#X2 logs at most one line per hostname per minute while the ring counts every refusal", async () => {
    const { app, state } = await build(ADMISSION, "report");

    for (let i = 0; i < 100; i++) await inject(app, { host: "rebind.example" });

    expect(errors.filter((l) => l.includes("host=rebind.example")).length).toBeLessThanOrEqual(1);
    expect(state.recent().find((e) => e.host === "rebind.example")?.count).toBe(100);
  });

  it("#X3 a distinct-host scan is capped: ≤60 refusal lines, ring bounded to 50", async () => {
    // Wiring-scale flood (the 10 000/`suppressed 9940` exact numbers are pinned
    // against the same `HostGateState` in host-gate.test.ts).
    const { app, state } = await build(ADMISSION, "report");

    for (let i = 0; i < 300; i++) await inject(app, { host: `a${i}.rebind.example` });

    expect(errors.filter((l) => l.includes("would-refuse host=")).length).toBeLessThanOrEqual(60);
    expect(state.recent().length).toBe(50);
  });
});

// ─── Real server: the wiring itself, live config, auth parity ───────────────

describe("REST host gate — real server wiring", () => {
  let handle: TestServerHandle | undefined;
  let configFile: string;
  let errors: string[];
  let spy: ReturnType<typeof vi.spyOn> | undefined;
  let prevEnv: string | undefined;

  beforeEach(() => {
    const dir = path.join(process.env.HOME!, ".pi", "dashboard");
    fs.mkdirSync(dir, { recursive: true });
    configFile = path.join(dir, "config.json");
    prevEnv = process.env[GATE_ENV];
    delete process.env[GATE_ENV];
    errors = [];
    resetConfigSnapshot();
  });

  afterEach(async () => {
    if (handle) await handle.stop();
    handle = undefined;
    fs.rmSync(configFile, { force: true });
    if (prevEnv === undefined) delete process.env[GATE_ENV];
    else process.env[GATE_ENV] = prevEnv;
    resetConfigSnapshot();
    spy?.mockRestore();
    spy = undefined;
  });

  const watchLogs = () => {
    spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map((a) => String(a)).join(" "));
    });
  };

  const get = (host: string) => request(handle!.httpPort, "GET", "/api/health", { host });

  it("is wired: enforce refuses a rebinding read with no ACAO through the real cors chain", async () => {
    fs.writeFileSync(configFile, JSON.stringify({}));
    setGateEnv("enforce");
    handle = await createTestServer();

    const res = await request(handle.httpPort, "GET", "/api/sessions", { host: "rebind.example:8000" });
    expect(res.status).toBe(403);
    expect(JSON.parse(res.text)).toMatchObject({ success: false, error: "host_not_allowed" });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  }, 30000);

  it("#E13 a request with NO Host header is refused (raw socket)", async () => {
    fs.writeFileSync(configFile, JSON.stringify({}));
    setGateEnv("enforce");
    handle = await createTestServer();

    // HTTP/1.0: Node's 1.1 parser rejects a Host-less request with 400 before
    // any hook runs; 1.0 is the only wire shape that reaches the gate with
    // `headers.host === undefined` — exactly the fail-closed partition.
    const status = await rawGet(
      handle.httpPort,
      "GET /api/health HTTP/1.0\r\nConnection: close\r\n\r\n",
    );
    expect(status).toBe("403");
  }, 30000);

  it("#E15 report default: served normally, one would-refuse line", async () => {
    fs.writeFileSync(configFile, JSON.stringify({}));
    watchLogs();
    handle = await createTestServer();

    const res = await get("rebind.example");
    expect(res.status).toBe(200);
    expect(errors.filter((l) => l.includes("[host-gate] would-refuse host=rebind.example"))).toHaveLength(1);
  }, 30000);
  it("#E16 mode + allowedHosts + publicBaseUrls apply live, no restart", async () => {
    fs.writeFileSync(configFile, JSON.stringify({ publicBaseUrls: ["https://pi.example.com"] }));
    handle = await createTestServer();

    expect((await get("rebind.example")).status).toBe(200); // report default

    fs.writeFileSync(configFile, JSON.stringify({
      hostGate: { mode: "enforce" },
      publicBaseUrls: ["https://pi.example.com"],
    }));
    expect((await get("rebind.example")).status).toBe(403);

    fs.writeFileSync(configFile, JSON.stringify({
      hostGate: { mode: "enforce" },
      publicBaseUrls: ["https://pi.example.com"],
      allowedHosts: ["rebind.example"],
    }));
    expect((await get("rebind.example")).status).toBe(200);

    // Removing the source URL removes the derived admission.
    fs.writeFileSync(configFile, JSON.stringify({
      hostGate: { mode: "enforce" },
      allowedHosts: ["rebind.example"],
    }));
    expect((await get("pi.example.com")).status).toBe(403);
  }, 30000);

  it("#X5 invalid config.json mid-run: last-good snapshot, never a 500, one parse-error line", async () => {
    fs.writeFileSync(configFile, JSON.stringify({
      hostGate: { mode: "enforce" },
      allowedHosts: ["dash.home.arpa"],
    }));
    setGateEnv("enforce");
    watchLogs();
    handle = await createTestServer();

    expect((await get("dash.home.arpa")).status).toBe(200);

    fs.writeFileSync(configFile, "{oops");
    const res = await get("dash.home.arpa");
    expect(res.status).toBe(200);
    expect(errors.some((l) => /config\.json/.test(l) && /parse|unparseable|invalid/i.test(l))).toBe(true);
  }, 30000);

  it("#E22 GET /api/host-gate: resolved mode, derived admitted rows, empty recent", async () => {
    fs.writeFileSync(configFile, JSON.stringify({
      hostGate: { mode: "enforce" },
      publicBaseUrls: ["https://pi.example.com"],
      allowedHosts: ["dash.home.arpa"],
    }));
    setGateEnv("report"); // env overrides config
    handle = await createTestServer();

    const res = await fetch(`http://127.0.0.1:${handle.httpPort}/api/host-gate`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.mode).toBe("report");
    expect(body.envOverridden).toBe(true);
    expect(body.admitted).toContainEqual({ host: "pi.example.com", source: "public-base-url" });
    expect(body.admitted).toContainEqual({ host: "dash.home.arpa", source: "allowed-host" });
    expect(body.admitted.filter((r: { source: string }) => r.source === "local")).toHaveLength(1);
    expect(body.admitted.filter((r: { source: string }) => r.source === "ip-address")).toHaveLength(1);
    expect(body.recent).toEqual([]);
  }, 30000);

  it("#E23 the ring counts every refusal, port-stripped, and evicts least-recently-seen at 50", async () => {
    fs.writeFileSync(configFile, JSON.stringify({}));
    handle = await createTestServer();
    const recent = async () =>
      (await (await fetch(`http://127.0.0.1:${handle!.httpPort}/api/host-gate`)).json()).recent;

    for (let i = 0; i < 3; i++) await get("rebind.example:8000");
    await get("proxy-int.corp");
    let ring = await recent();
    expect(ring.find((e: { host: string }) => e.host === "rebind.example")).toMatchObject({
      count: 3,
      outcome: "would-refuse",
    });
    expect(ring.find((e: { host: string }) => e.host === "proxy-int.corp")).toMatchObject({
      count: 1,
      outcome: "would-refuse",
    });

    for (let i = 0; i < 50; i++) await get(`s${i}.example`);
    ring = await recent();
    expect(ring).toHaveLength(50);
    // The first burst is the least-recently-seen pair → evicted (spec: LRU by
    // lastSeen; a re-seen host starts a fresh entry, below).
    expect(ring.find((e: { host: string }) => e.host === "rebind.example")).toBeUndefined();
    expect(ring.find((e: { host: string }) => e.host === "proxy-int.corp")).toBeUndefined();

    await get("rebind.example:8000");
    ring = await recent();
    expect(ring[0]).toMatchObject({ host: "rebind.example", count: 1 });
  }, 30000);

  it("#E24 absent Host keys (malformed); admitting a host stops its counter", async () => {
    fs.writeFileSync(configFile, JSON.stringify({}));
    handle = await createTestServer();
    const recent = async () =>
      (await (await fetch(`http://127.0.0.1:${handle!.httpPort}/api/host-gate`)).json()).recent;
    // HTTP/1.0 so the Host-less request reaches the handler at all (see #E13).
    const noHost = "GET /api/health HTTP/1.0\r\nConnection: close\r\n\r\n";

    // Report default: served, but counted under the shared (malformed) key.
    expect(await rawGet(handle.httpPort, noHost)).toBe("200");
    expect(await rawGet(handle.httpPort, noHost)).toBe("200");
    await get("rebind.example");
    let ring = await recent();
    expect(ring.find((e: { host: string }) => e.host === "(malformed)")).toMatchObject({ count: 2 });
    expect(ring.find((e: { host: string }) => e.host === "rebind.example")).toMatchObject({ count: 1 });

    fs.writeFileSync(configFile, JSON.stringify({ allowedHosts: ["rebind.example"] }));
    expect((await get("rebind.example")).status).toBe(200);
    ring = await recent();
    expect(ring.find((e: { host: string }) => e.host === "rebind.example")).toMatchObject({ count: 1 });
  }, 30000);

  it("#E25 is subject to the same auth as GET /api/config", async () => {
    fs.writeFileSync(configFile, JSON.stringify({}));
    handle = await createTestServer({
      authConfig: {
        secret: "test-secret-abc",
        providers: { github: { clientId: "x", clientSecret: "y" } },
      },
    });
    const headers = { "x-forwarded-for": "203.0.113.7" };

    const gate = await fetch(`http://127.0.0.1:${handle.httpPort}/api/host-gate`, { headers });
    const config = await fetch(`http://127.0.0.1:${handle.httpPort}/api/config`, { headers });
    expect(gate.status).toBe(config.status);
    expect([401, 403]).toContain(gate.status);
  }, 30000);

  it("#X7 enforce keeps plain-LAN pairing working (IP-literal Host, no Origin)", async () => {
    fs.writeFileSync(configFile, JSON.stringify({}));
    setGateEnv("enforce");
    handle = await createTestServer();

    const res = await request(
      handle.httpPort,
      "POST",
      "/api/pair/challenge",
      {
        "content-type": "application/json",
        host: "192.168.1.20:8000",
        "x-forwarded-for": "192.168.1.20",
      },
      JSON.stringify({ nonce: "0123456789abcdef" }),
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toMatchObject({ success: true });
  }, 30000);
});
