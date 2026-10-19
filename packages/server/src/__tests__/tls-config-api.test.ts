import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";
import { FakeSource } from "../tls/__tests__/helpers.js";
import { registerCertSourceType, unregisterCertSourceType } from "../tls/source-registry.js";
import { validateTlsConfigWrite } from "../tls/tls-config-validation.js";

/**
 * `tls` config writes + the operator issue route over a real server:
 * validation (400s), deep-merge, live reconcile, failure isolation, authorization.
 * (test-plan #E3, #E4, #E5, #E32, #E42, #X2, #X9). See change: add-tailscale-cert-tls.
 */

const NAME = "host.example.ts.net";
let handle: TestServerHandle | undefined;
let src: FakeSource;
let base: string;
const cfgFile = (): string => path.join(os.homedir(), ".pi", "dashboard", "config.json");
const readCfg = (): any => JSON.parse(fs.readFileSync(cfgFile(), "utf8"));
const writeCfg = (v: unknown): void => {
  fs.mkdirSync(path.dirname(cfgFile()), { recursive: true });
  fs.writeFileSync(cfgFile(), JSON.stringify(v));
};

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

async function waitFor(pred: () => boolean, ms = 8000): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function put(body: unknown, url = base): Promise<{ status: number; json: any }> {
  const res = await fetch(`${url}/api/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function issue(body: unknown, url = base): Promise<{ status: number; json: any }> {
  const res = await fetch(`${url}/api/tls/issue`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function boot(tlsBlock: Record<string, unknown> | undefined, extra: Record<string, unknown> = {}, overrides = {}): Promise<void> {
  writeCfg({ ...(tlsBlock ? { tls: tlsBlock } : {}), ...extra });
  handle = await createTestServer(overrides);
  base = `http://127.0.0.1:${handle.httpPort}`;
}

beforeEach(() => {
  fs.rmSync(path.join(os.homedir(), ".pi", "dashboard", "tls"), { recursive: true, force: true });
  src = new FakeSource({ names: [] });
  registerCertSourceType({
    type: "fake",
    defaultId: "fake",
    validate: (e) => (e.x !== undefined ? "x is not supported by fake" : null),
    create: () => src,
  });
});

afterEach(async () => {
  await handle?.stop();
  handle = undefined;
  unregisterCertSourceType("fake");
});

describe("#E3 unknown type / duplicate id rejected", () => {
  it("answers 400 naming the entry and leaves the config bytes unchanged", async () => {
    await boot({ enabled: false, sources: [] });
    const before = fs.readFileSync(cfgFile(), "utf8");
    const unknown = await put({ tls: { sources: [{ type: "foo" }] } });
    expect(unknown.status).toBe(400);
    expect(unknown.json.error).toContain("tls.sources[0].type");
    const dup = await put({ tls: { sources: [{ type: "fake" }, { type: "fake" }] } });
    expect(dup.status).toBe(400);
    expect(dup.json.error).toMatch(/"fake" is a duplicate source id/);
    expect(fs.readFileSync(cfgFile(), "utf8")).toBe(before);
  });
});

describe("#E42 pluggable source types + id rules", () => {
  it("validates through the registered type; ids follow the pattern; tailscale id defaults", async () => {
    await boot({ enabled: false });
    expect((await put({ tls: { sources: [{ type: "fake" }] } })).status).toBe(200);
    const x = await put({ tls: { sources: [{ type: "fake", x: 1 }] } });
    expect(x.status).toBe(400);
    expect(x.json.error).toContain("x is not supported by fake");
    expect((await put({ tls: { sources: [{ type: "foo" }] } })).status).toBe(400);
    expect((await put({ tls: { sources: [{ type: "fake", id: "Bad_Id" }] } })).status).toBe(400);
    expect((await put({ tls: { sources: [{ type: "fake", id: "tailscale" }] } })).status).toBe(400); // reserved
    expect((await put({ tls: { sources: [{ type: "tailscale" }] } })).status).toBe(200); // default id `tailscale`
    expect(readCfg().tls.sources).toEqual([{ type: "tailscale" }]);
    // ...and resolves to the id "tailscale": a second tailscale entry is a duplicate.
    expect((await put({ tls: { sources: [{ type: "tailscale" }, { type: "tailscale" }] } })).json.error).toContain('"tailscale"');
  });
});

describe("#E4 port validation", () => {
  it("bounds, and uniqueness against the effective main / gateway ports", async () => {
    await boot({ enabled: false, sources: [] });
    for (const port of [0, 65536, -1, 1.5, "8443"]) {
      const r = await put({ tls: { port } });
      expect(r.status).toBe(400);
      expect(r.json.error).toContain("tls.port");
    }
    expect((await put({ tls: { port: 8000 } })).status).toBe(400); // default main port
    expect((await put({ tls: { port: 9999 } })).status).toBe(400); // default piPort
    expect((await put({ tls: { port: 1 } })).status).toBe(200);
    expect((await put({ tls: { port: 65535 } })).status).toBe(200);
  });

  it("a later change of the main port cannot collide with a stored tls.port", async () => {
    await boot({ enabled: false, port: 9443, sources: [] });
    const r = await put({ port: 9443 });
    expect(r.status).toBe(400);
    expect(r.json.error).toContain("tls.port 9443");
    expect(readCfg().port).toBeUndefined();
  });

  it("rejects a tls.host that is neither an IP literal nor localhost", async () => {
    await boot({ enabled: false });
    expect((await put({ tls: { host: "dash.example.com" } })).status).toBe(400);
    expect((await put({ tls: { host: "100.83.0.1" } })).status).toBe(200);
    expect((await put({ tls: { host: "localhost" } })).status).toBe(200);
    expect((await put({ tls: { host: "LOCALHOST" } })).status).toBe(200); // case-insensitive, like the loader and isLoopbackHost
  });
});

describe("#E5 partial write preserves sibling keys", () => {
  it("PUT {tls:{enabled:true}} keeps port and sources", async () => {
    const port = await freePort();
    await boot({ enabled: false, port, sources: [{ type: "fake" }] });
    expect((await put({ tls: { enabled: true } })).status).toBe(200);
    expect(readCfg().tls).toEqual({ enabled: true, port, sources: [{ type: "fake" }] });
  });
});

describe("live reconcile after a write", () => {
  it("enabling binds the listener without a restart; disabling closes it", async () => {
    const port = await freePort();
    src.namesValue = [NAME];
    await boot({ enabled: false, port, sources: [{ type: "fake" }] });
    expect(handle?.server.tls.isBound).toBe(false);
    expect((await put({ tls: { enabled: true } })).status).toBe(200);
    expect(handle?.server.tls.isBound).toBe(true);
    expect((await put({ tls: { enabled: false } })).status).toBe(200);
    expect(handle?.server.tls.isBound).toBe(false);
  });
});

describe("#X2 reconcile failure after the write", () => {
  it("PUT still 200, the config holds the new port, status carries the error, main keeps serving", async () => {
    const port = await freePort();
    src.namesValue = [NAME];
    await boot({ enabled: true, port, sources: [{ type: "fake" }] });
    await waitFor(() => handle?.server.tls.isBound === true);
    const blocker = net.createServer();
    await new Promise<void>((r) => blocker.listen(0, "127.0.0.1", () => r()));
    const held = (blocker.address() as net.AddressInfo).port;
    const r = await put({ tls: { port: held } });
    expect(r.status).toBe(200);
    expect(readCfg().tls.port).toBe(held);
    const h = await (await fetch(`${base}/api/health`)).json();
    expect(h.tls).toMatchObject({ enabled: true, bound: false, bindError: expect.stringContaining("EADDRINUSE") });
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
    await new Promise<void>((r2) => blocker.close(() => r2()));
  });
});

describe("#E32 operator-triggered issuance", () => {
  it("202 + immediate obtain for a backoff-pending source; no name → only missing/failed names", async () => {
    src.namesValue = ["a.test", "b.test"];
    const port = await freePort();
    let failA = true;
    src.obtainImpl = async (name) => {
      if (name === "a.test" && failA) throw new Error("boom");
      const { fixtureFor } = await import("../tls/__tests__/helpers.js");
      return { ...fixtureFor(name), advertise: true, kind: "domain" };
    };
    await boot({ enabled: true, port, sources: [{ type: "fake" }] });
    await waitFor(() => handle?.server.tls.manager.status().certs.length === 2 && src.obtainCalls.length >= 2);
    await handle?.server.tls.manager.settle();
    expect(src.obtainCalls.sort()).toEqual(["a.test", "b.test"]);

    failA = false;
    src.obtainCalls = [];
    const r = await issue({ sourceId: "fake" });
    expect(r.status).toBe(202);
    await waitFor(() => src.obtainCalls.length > 0);
    await handle?.server.tls.manager.settle();
    expect(src.obtainCalls).toEqual(["a.test"]); // b.test is valid and current: not re-issued
  });

  it("a named issue joins a running attempt (no second obtain)", async () => {
    src.namesValue = ["a.test"];
    const port = await freePort();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    src.obtainImpl = async (name) => {
      await gate;
      const { fixtureFor } = await import("../tls/__tests__/helpers.js");
      return { ...fixtureFor(name), advertise: true, kind: "domain" };
    };
    await boot({ enabled: true, port, sources: [{ type: "fake" }] });
    await waitFor(() => src.obtainCalls.length === 1);
    expect((await issue({ sourceId: "fake", name: "a.test" })).status).toBe(202);
    await new Promise((r) => setTimeout(r, 100));
    expect(src.obtainCalls).toHaveLength(1);
    release();
    await handle?.server.tls.manager.settle();
  });

  it("404 for an unknown source, 404 for a name the source does not produce, 409 when disabled (409 before 404)", async () => {
    src.namesValue = ["a.test"];
    const port = await freePort();
    await boot({ enabled: true, port, sources: [{ type: "fake" }] });
    await waitFor(() => handle?.server.tls.manager.status().certs.length === 1);
    expect((await issue({ sourceId: "nope" })).status).toBe(404);
    expect((await issue({ sourceId: "fake", name: "z.test" })).status).toBe(404);
    expect((await issue({})).status).toBe(400);
    await put({ tls: { enabled: false } });
    expect((await issue({ sourceId: "nope" })).status).toBe(409);
    expect((await issue({ sourceId: "fake" })).status).toBe(409);
  });
});

describe("#X9 issue route authorization", () => {
  it("a caller PUT /api/config refuses is refused the same way and nothing is issued", async () => {
    const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address;
    if (!lan) return; // no non-loopback address on this host: not observable here
    src.namesValue = ["a.test"];
    const port = await freePort();
    src.obtainImpl = async () => {
      throw new Error("held back");
    };
    await boot({ enabled: true, port, sources: [{ type: "fake" }] }, { trustedNetworks: [] }, { host: "0.0.0.0" });
    await waitFor(() => src.obtainCalls.length >= 1);
    await handle?.server.tls.manager.settle();
    const before = src.obtainCalls.length;
    const remote = `http://${lan}:${handle?.httpPort}`;
    const putRes = await put({ tls: { enabled: true } }, remote);
    const issueRes = await issue({ sourceId: "fake" }, remote);
    expect(putRes.status).toBeGreaterThanOrEqual(400);
    expect(issueRes.status).toBe(putRes.status);
    await new Promise((r) => setTimeout(r, 100));
    expect(src.obtainCalls.length).toBe(before);
  });
});

describe("validateTlsConfigWrite (pure)", () => {
  it("respects PI_DASHBOARD_PORT / PI_DASHBOARD_PI_PORT env overrides for the effective ports", () => {
    expect(validateTlsConfigWrite({ tls: { port: 18000 } }, {}, { PI_DASHBOARD_PORT: "18000" })).toContain("already used by port");
    expect(validateTlsConfigWrite({ tls: { port: 19999 } }, {}, { PI_DASHBOARD_PI_PORT: "19999" })).toContain("already used by piPort");
    expect(validateTlsConfigWrite({ tls: { port: 9443 } }, { modelProxy: { secondPort: 9443 } }, {})).toContain("modelProxy.secondPort");
  });

  it("does not police ports when the write touches none of them", () => {
    expect(validateTlsConfigWrite({ dashboardName: "x" }, { tls: { port: 8000 } }, {})).toBeNull();
  });
});
