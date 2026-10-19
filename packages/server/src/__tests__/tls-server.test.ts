import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { httpProofHeaders } from "@blackbelt-technology/pi-dashboard-shared/local-credential-proof.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";
import { CA_PEM, FakeSource, fixtureFor } from "../tls/__tests__/helpers.js";
import { registerCertSourceType, unregisterCertSourceType } from "../tls/source-registry.js";

/**
 * Real DashboardServer with the optional TLS listener enabled and a fake
 * certificate source: same routes / guard / WS over TLS, failure isolation,
 * disclosure, host admission, endpoints, shutdown.
 * (test-plan #E1, #E2, #E16, #E22, #E26–#E28, #E45, #E48, #E51, #X1–#X7, #X10).
 * See change: add-tailscale-cert-tls.
 */

const NAME = "host.example.ts.net";
let handle: TestServerHandle | undefined;
let src: FakeSource;
const cfgFile = (): string => path.join(os.homedir(), ".pi", "dashboard", "config.json");

function writeConfig(extra: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(cfgFile()), { recursive: true });
  fs.writeFileSync(cfgFile(), JSON.stringify(extra));
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
    s.on("error", reject);
  });
}

async function waitFor(pred: () => boolean | Promise<boolean>, ms = 8000): Promise<void> {
  const t0 = Date.now();
  while (!(await pred())) {
    if (Date.now() - t0 > ms) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 25));
  }
}

interface Res {
  status: number;
  body: string;
  json: () => any;
}

function get(url: string, opts: { servername?: string; headers?: Record<string, string>; method?: string; host?: string } = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        host: opts.host ?? u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: opts.method ?? "GET",
        headers: opts.headers,
        ...(u.protocol === "https:" ? { servername: opts.servername ?? NAME, ca: CA_PEM, checkServerIdentity: () => undefined } : {}),
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body, json: () => JSON.parse(body) }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function boot(tlsOverrides: Record<string, unknown> = {}, extra: Record<string, unknown> = {}, serverOverrides = {}): Promise<{ main: string; tlsPort: number }> {
  const port = await freePort();
  writeConfig({ tls: { enabled: true, port, host: "127.0.0.1", sources: [{ type: "fake" }], ...tlsOverrides }, ...extra });
  handle = await createTestServer(serverOverrides);
  await waitFor(() => handle?.server.tls.isBound === true);
  return { main: `http://127.0.0.1:${handle.httpPort}`, tlsPort: handle.server.tls.boundTlsPort() ?? port };
}

async function bootWithCert(tlsOverrides: Record<string, unknown> = {}, extra: Record<string, unknown> = {}, serverOverrides = {}): Promise<{ main: string; tlsPort: number; tlsUrl: string }> {
  src.namesValue = [NAME];
  const b = await boot(tlsOverrides, extra, serverOverrides);
  await waitFor(() => handle?.server.tls.manager.status().certs.every((c) => c.held) === true && (handle?.server.tls.manager.status().certs.length ?? 0) > 0);
  return { ...b, tlsUrl: `https://127.0.0.1:${b.tlsPort}` };
}

beforeEach(() => {
  // Certificates persist under HOME between tests of this file: start every test clean.
  fs.rmSync(path.join(os.homedir(), ".pi", "dashboard", "tls"), { recursive: true, force: true });
  src = new FakeSource({ names: [] });
  registerCertSourceType({ type: "fake", defaultId: "fake", validate: () => null, create: () => src });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await handle?.stop();
  handle = undefined;
  unregisterCertSourceType("fake");
});

describe("#E1 disabled by default", () => {
  it("no tls block → nothing bound, health.tls is {enabled:false,bound:false}", async () => {
    writeConfig({});
    handle = await createTestServer();
    const h = (await get(`http://127.0.0.1:${handle.httpPort}/api/health`)).json();
    expect(h.tls).toEqual({ enabled: false, bound: false });
    expect(handle.server.tls.isBound).toBe(false);
  });

  it("tls.enabled:false with an explicit port refuses connections; main bind 0.0.0.0 + tls on reports host 127.0.0.1", async () => {
    const port = await freePort();
    writeConfig({ tls: { enabled: false, port } });
    handle = await createTestServer();
    await expect(
      new Promise((resolve, reject) => {
        const s = net.connect(port, "127.0.0.1", () => resolve("connected"));
        s.on("error", reject);
      }),
    ).rejects.toThrow(/ECONNREFUSED/);
    await handle.stop();
    handle = undefined;

    writeConfig({ tls: { enabled: true, port: await freePort(), sources: [{ type: "fake" }] }, bindHost: "0.0.0.0" });
    handle = await createTestServer({ host: "0.0.0.0" });
    await waitFor(() => handle?.server.tls.isBound === true);
    const detail = (await get(`http://127.0.0.1:${handle.httpPort}/api/health`)).json().tls;
    expect(detail).toMatchObject({ enabled: true, bound: true, host: "127.0.0.1" });
  });
});

describe("#E2 enabled without usable sources", () => {
  it("empty sources → not bound, no-sources gate", async () => {
    const port = await freePort();
    writeConfig({ tls: { enabled: true, port, sources: [] } });
    handle = await createTestServer();
    await new Promise((r) => setTimeout(r, 200));
    const tlsStatus = (await get(`http://127.0.0.1:${handle.httpPort}/api/health`)).json().tls;
    expect(tlsStatus.bound).toBe(false);
    expect(tlsStatus.gates).toContainEqual(expect.objectContaining({ id: "no-sources", ok: false }));
  });
});

describe("#E48 invalid stored source", () => {
  it("is skipped with an invalid-source gate while a valid source runs", async () => {
    src.namesValue = [NAME];
    const port = await freePort();
    writeConfig({ tls: { enabled: true, port, sources: [{ type: "foo" }, { type: "fake" }] } });
    handle = await createTestServer();
    await waitFor(() => handle?.server.tls.isBound === true);
    await waitFor(() => (handle?.server.tls.manager.status().certs.length ?? 0) > 0);
    const body = (await get(`http://127.0.0.1:${handle.httpPort}/api/health`)).json();
    expect(body.tls.gates).toContainEqual(expect.objectContaining({ id: "invalid-source", hint: expect.stringContaining("tls.sources[0]") }));
    expect(body.tls.sources.map((s: { id: string }) => s.id)).toEqual(["fake"]);
  });
});

describe("#X1 bind failure isolated", () => {
  it("main listener keeps serving; detail shows EADDRINUSE", async () => {
    const blocker = net.createServer();
    await new Promise<void>((r) => blocker.listen(0, "127.0.0.1", () => r()));
    const busy = (blocker.address() as net.AddressInfo).port;
    writeConfig({ tls: { enabled: true, port: busy, sources: [{ type: "fake" }] } });
    handle = await createTestServer();
    await new Promise((r) => setTimeout(r, 200));
    const res = await get(`http://127.0.0.1:${handle.httpPort}/api/health`);
    expect(res.status).toBe(200);
    expect(res.json().tls).toMatchObject({ enabled: true, bound: false, bindError: expect.stringContaining("EADDRINUSE") });
    await new Promise<void>((r) => blocker.close(() => r()));
  });
});

describe("#X4 same routes over TLS", () => {
  it("serves the same /api/health shape, with the same server timeouts and the same 431", async () => {
    const { main, tlsUrl } = await bootWithCert();
    const a = (await get(`${main}/api/health`)).json();
    const b = (await get(`${tlsUrl}/api/health`, { host: "127.0.0.1" })).json();
    expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());

    const tlsServer = handle?.server.tls.httpsServer as https.Server;
    expect(tlsServer.keepAliveTimeout).toBe(30_000);
    expect(tlsServer.timeout).toBe(10_000);
    expect(tlsServer.requestTimeout).toBe(0);

    const big = "x".repeat(20_000);
    const m431 = await get(`${main}/api/health`, { headers: { "x-big": big } }).catch((e: Error) => e);
    const t431 = await get(`${tlsUrl}/api/health`, { headers: { "x-big": big } }).catch((e: Error) => e);
    const norm = (r: Res | Error): string => (r instanceof Error ? `error:${(r as NodeJS.ErrnoException).code ?? r.message}` : `${r.status}:${r.body}`);
    expect(norm(t431)).toBe(norm(m431));
  });
});

describe("#X5 same guard over TLS", () => {
  it("a guarded route refuses an untrusted non-loopback caller identically on both listeners", async () => {
    const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address;
    if (!lan) return; // no non-loopback address on this host (CI sandbox): not observable here
    src.namesValue = [NAME];
    const { tlsPort } = await bootWithCert({ host: "0.0.0.0" }, { trustedNetworks: [] }, { host: "0.0.0.0" });
    const mainRes = await get(`http://${lan}:${handle?.httpPort}/api/config`);
    const tlsRes = await get(`https://${lan}:${tlsPort}/api/config`, { servername: NAME });
    expect(mainRes.status).toBe(403);
    expect(tlsRes.status).toBe(mainRes.status);
    expect(tlsRes.body).toBe(mainRes.body);
  });
});

describe("#X6 wss parity", () => {
  async function wsOutcome(url: string, opts: { servername?: string } = {}): Promise<string> {
    return new Promise((resolve) => {
      const ws = new WebSocket(url, { ca: CA_PEM, servername: opts.servername, checkServerIdentity: () => undefined } as unknown as WebSocket.ClientOptions);
      ws.on("open", () => {
        ws.close();
        resolve("open");
      });
      ws.on("unexpected-response", (_req, res) => resolve(`http-${res.statusCode}`));
      ws.on("error", (e) => resolve(`error:${e.message}`));
    });
  }

  it("a minted browser ticket opens over wss; a bogus ticket is refused exactly as on the main listener", async () => {
    const { main, tlsPort } = await bootWithCert();
    const ticket = async (): Promise<string> => {
      const res = await fetch(`${main}/api/ws-ticket`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope: "browser" }) });
      return ((await res.json()) as { data: { ticket: string } }).data.ticket;
    };
    const viaTls = await wsOutcome(`wss://127.0.0.1:${tlsPort}/ws?ticket=${await ticket()}`, { servername: NAME });
    expect(viaTls).toBe("open");
    const bogusTls = await wsOutcome(`wss://127.0.0.1:${tlsPort}/ws?ticket=bogus`, { servername: NAME });
    const bogusMain = await wsOutcome(`ws://127.0.0.1:${handle?.httpPort}/ws?ticket=bogus`);
    expect(bogusTls).toBe(bogusMain);
  });
});

describe("#X7 shutdown closes TLS", () => {
  it("server.stop() closes an idle keep-alive TLS socket and refuses new connections", async () => {
    const { tlsPort } = await bootWithCert();
    const sock = tls.connect({ host: "127.0.0.1", port: tlsPort, servername: NAME, ca: CA_PEM, checkServerIdentity: () => undefined });
    await new Promise<void>((r) => sock.once("secureConnect", () => r()));
    const closed = new Promise<void>((r) => sock.once("close", () => r()));
    const stopping = handle?.stop();
    await Promise.race([closed, new Promise((_, rej) => setTimeout(() => rej(new Error("TLS socket not closed within 2 s")), 2000))]);
    await stopping;
    handle = undefined;
    await expect(
      new Promise((resolve, reject) => {
        const s = net.connect(tlsPort, "127.0.0.1", () => resolve("connected"));
        s.on("error", reject);
      }),
    ).rejects.toThrow(/ECONNREFUSED/);
  });
});

describe("#E26 / #E16 status disclosure and key non-exposure", () => {
  it("local callers get detail (lastError ≤ 500 chars); keys never appear in /api/health or /api/config", async () => {
    src.obtainImpl = async () => {
      throw new Error("e".repeat(501));
    };
    src.namesValue = [NAME];
    const { main } = await boot();
    await waitFor(() => (handle?.server.tls.manager.status().certs[0]?.lastError?.length ?? 0) > 0);
    const health = await get(`${main}/api/health`);
    const detail = health.json().tls;
    expect(detail.certs[0].lastError).toHaveLength(500);
    expect(Object.keys(detail)).toEqual(expect.arrayContaining(["enabled", "bound", "port", "host", "gates", "sources", "certs"]));
    expect(health.body).not.toContain("PRIVATE KEY");
    const cfg = await get(`${main}/api/config`);
    expect(cfg.body).not.toContain("PRIVATE KEY");
  });

  it("a successful issuance never puts key material into health or config (#E16)", async () => {
    const { main } = await bootWithCert();
    const keyPem = fixtureFor(NAME).keyPem;
    const slice = keyPem.replace(/-----[^-]+-----|\s/g, "").slice(20, 60);
    for (const p of ["/api/health", "/api/config"]) {
      const body = (await get(`${main}${p}`)).body;
      expect(body).not.toContain("PRIVATE KEY");
      expect(body).not.toContain(slice);
    }
  });

  it("an unauthenticated non-local caller sees only enabled + bound", async () => {
    const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address;
    if (!lan) return; // no non-loopback address on this host (CI sandbox): not observable here
    await bootWithCert({}, { trustedNetworks: [] }, { host: "0.0.0.0" });
    const res = await get(`http://${lan}:${handle?.httpPort}/api/health`);
    expect(res.json().tls).toEqual({ enabled: true, bound: expect.any(Boolean) });
  });
});

describe("#E27 / #E28 / #E45 host admission", () => {
  it("a held certificate name is admitted on the main listener (enforce) and listed with source tls-listener; wildcard is not", async () => {
    src.namesValue = [NAME, "*.example.com"];
    const { main } = await boot({}, { hostGate: { mode: "enforce" } });
    await waitFor(() => (handle?.server.tls.manager.status().certs.filter((c) => c.held).length ?? 0) === 2);
    const admitted = await get(`${main}/api/health`, { headers: { host: `${NAME}:8000` } });
    expect(admitted.status).toBe(200);
    const wild = await get(`${main}/api/health`, { headers: { host: "dash.example.com:8000" } });
    expect(wild.status).toBe(403);
    const gate = (await get(`${main}/api/host-gate`)).json();
    expect(gate.admitted).toContainEqual({ host: NAME, source: "tls-listener" });
    expect(gate.admitted.some((r: { host: string }) => r.host === "*.example.com")).toBe(false);
  });

  it("the name is refused again once it is pruned", async () => {
    src.namesValue = [NAME];
    const { main } = await boot({}, { hostGate: { mode: "enforce" } });
    await waitFor(() => handle?.server.tls.manager.status().certs[0]?.held === true);
    expect((await get(`${main}/api/health`, { headers: { host: `${NAME}:8000` } })).status).toBe(200);
    src.namesValue = [];
    await handle?.server.tls.manager.reconcile([src]);
    expect((await get(`${main}/api/health`, { headers: { host: `${NAME}:8000` } })).status).toBe(403);
  });

  it("a throwing certificate accessor never 5xx's the main listener (fail-empty)", async () => {
    src.namesValue = [NAME];
    const { main } = await boot({}, { hostGate: { mode: "enforce" } });
    await waitFor(() => handle?.server.tls.manager.status().certs[0]?.held === true);
    vi.spyOn(handle!.server.tls, "tlsListenerNames").mockImplementation(() => {
      throw new Error("store fault");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const res = await get(`${main}/api/health`, { headers: { host: `${NAME}:8000` } });
    expect(res.status).toBe(403); // not admitted, but a clean refusal rather than a 500
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("certificate-name lookup failed")).length).toBeLessThanOrEqual(1);
  });
});

describe("#E22 / #E24 endpoints + pairing payload", () => {
  it("a reachable bind advertises https://<name>:<port> in both Accessible-at and the pairing URLs; a loopback bind does not", async () => {
    const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address;
    if (!lan) return;
    const { main, tlsPort } = await bootWithCert({ host: "0.0.0.0" });
    const endpoints = (await get(`${main}/api/tunnel/endpoints`)).json().data.endpoints;
    expect(endpoints).toContainEqual({ kind: "magicdns", url: `https://${NAME}:${tlsPort}`, tls: true });
    const urls = (await get(`${main}/api/pair/reachable-urls`)).json().data as string[];
    expect(urls).toContain(`https://${NAME}:${tlsPort}`);
  });

  it("#E24 loopback bind: no TLS endpoint, no pairing URL, bind-reachable gate unmet", async () => {
    const { main, tlsPort } = await bootWithCert({ host: "127.0.0.1" });
    const endpoints = (await get(`${main}/api/tunnel/endpoints`)).json().data.endpoints as Array<{ url: string }>;
    expect(endpoints.some((e) => e.url.includes(NAME))).toBe(false);
    const urls = (await get(`${main}/api/pair/reachable-urls`)).json().data as string[];
    expect(urls).not.toContain(`https://${NAME}:${tlsPort}`);
    const gates = (await get(`${main}/api/health`)).json().tls.gates;
    expect(gates).toContainEqual(expect.objectContaining({ id: "bind-reachable", ok: false }));
  });
});

describe("#X10 local-credential proof floor per transport", () => {
  async function proofOutcome(tlsPort: number, token: string, mintFor: "main" | "tls" | "before-bind", mainPort: number): Promise<void> {
    const url = `https://127.0.0.1:${tlsPort}/api/health`;
    const bindTime = Date.now();
    const headers =
      mintFor === "main"
        ? httpProofHeaders(token, `http://127.0.0.1:${mainPort}/api/health`, "GET")
        : mintFor === "before-bind"
          ? httpProofHeaders(token, url, "GET", { now: bindTime - 20_000 })
          : httpProofHeaders(token, url, "GET");
    await get(url, { headers });
  }

  it("a proof for the main binding, or minted before the TLS bind, is rejected; a proof for the TLS binding is accepted", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { tlsPort } = await bootWithCert();
    const token = fs.readFileSync(path.join(os.homedir(), ".pi", "dashboard", "local", "token"), "utf8").trim();
    const lines = (): string[] => warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("[local-credential] http proof rejected"));

    await proofOutcome(tlsPort, token, "main", handle?.httpPort ?? 0);
    // A proof for the main-port binding never verifies on the TLS port (bad-mac / binding-mismatch).
    expect(lines().some((l) => /binding-mismatch|bad-mac/.test(l))).toBe(true);

    await proofOutcome(tlsPort, token, "before-bind", handle?.httpPort ?? 0);
    expect(lines().some((l) => l.includes("before-start"))).toBe(true);

    const before = lines().length;
    await proofOutcome(tlsPort, token, "tls", handle?.httpPort ?? 0);
    expect(lines().length).toBe(before);
  });
});
