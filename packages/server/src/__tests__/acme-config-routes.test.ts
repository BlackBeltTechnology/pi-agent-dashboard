/**
 * ACME per-entry config routes + `PUT /api/config` validation + redaction.
 * test-plan E1-E4, E13, E22-E24 (tasks 6.1-6.4, 6.13, 6.22-6.24).
 * See change: add-acme-dns01-certs.
 */
import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as configApi from "../config-api.js";
import { runOnConfigSaveChain } from "../routes/system-routes.js";
import { registerCertSourceType, unregisterCertSourceType } from "../tls/source-registry.js";
import {
  ACME_TOKEN,
  type AcmeEnv,
  acmeDnsEntry,
  buildAcmeApp,
  cfgBytes,
  cfgFile,
  deferred,
  type FakeListener,
  homeEntry,
  makeFakeListener,
  putJson,
  readCfg,
  resetAcmeEnv,
  setupAcmeEnv,
  writeCfg,
  writeCfgRaw,
} from "./helpers/acme-test-kit.js";

vi.mock("../config-api.js", async (orig) => {
  const m = await orig<typeof import("../config-api.js")>();
  return { ...m, writeConfigPartial: vi.fn(m.writeConfigPartial) };
});
const writeSpy = vi.mocked(configApi.writeConfigPartial);

let env: AcmeEnv;
let fake: FakeListener;
let app: FastifyInstance;

beforeEach(async () => {
  env = setupAcmeEnv();
  fake = makeFakeListener();
  ({ app } = await buildAcmeApp({ listener: fake.asListener() }));
  writeSpy.mockClear();
});
afterEach(async () => {
  await app.close();
  resetAcmeEnv();
  unregisterCertSourceType("fake");
});

const putEntry = (e: Record<string, any>, id: string = e.id) => putJson(app, `/api/tls/acme/${id}`, e);
const putConfig = (sources: unknown[]) => putJson(app, "/api/config", { tls: { sources } });
const del = (id: string) => app.inject({ method: "DELETE", url: `/api/tls/acme/${id}` });
const seed = (sources: unknown[] = []) => writeCfg({ tls: { enabled: false, sources } });

describe("E1 domain validation", () => {
  const valid = ["dash.example.com", "*.lab.example.com", "xn--bcher-kva.example"];
  const invalid = [
    "https://dash.example.com:8443",
    "10.0.0.5",
    "[::1]",
    "a.*.example.com",
    "*",
    ".",
    "a..example.com",
    "-x.example.com",
    "a_b.example.com",
    "bücher.example",
  ];

  it.each(valid)("E1 valid %s → 200 on both routes", async (domain) => {
    seed();
    expect((await putEntry(homeEntry({ domains: [domain] }))).statusCode).toBe(200);
    expect(readCfg().tls.sources[0].domains).toEqual([domain]);
    expect((await putConfig([homeEntry({ domains: [domain] })])).statusCode).toBe(200);
  });

  it.each(invalid)("E1 invalid %s → 400 naming the entry, config bytes unchanged", async (domain) => {
    seed();
    const before = cfgBytes();
    const viaRoute = await putEntry(homeEntry({ domains: [domain] }));
    expect(viaRoute.statusCode).toBe(400);
    expect(viaRoute.json().error).toContain('acme source "home"');
    expect(viaRoute.json().error).toContain("domains[0]");
    const viaConfig = await putConfig([homeEntry({ domains: [domain] })]);
    expect(viaConfig.statusCode).toBe(400);
    expect(viaConfig.json().error).toContain('acme source "home"');
    expect(cfgBytes()).toBe(before);
  });
});

describe("E2 normalization + count", () => {
  it("E2 stores a lowercased, dot-stripped, deduplicated list", async () => {
    seed();
    expect((await putEntry(homeEntry({ domains: ["Dash.Example.COM.", "dash.example.com"] }))).statusCode).toBe(200);
    expect(readCfg().tls.sources[0].domains).toEqual(["dash.example.com"]);
  });

  it.each([
    [0, 400],
    [1, 200],
    [20, 200],
    [21, 400],
  ])("E2 %i domains → %i", async (n, status) => {
    seed();
    const domains = Array.from({ length: n }, (_v, i) => `h${i}.example.com`);
    const res = await putEntry(homeEntry({ domains }));
    expect(res.statusCode, res.body).toBe(status);
    if (status === 400) expect(res.json().error).toContain("domains must hold 1 to 20 names");
  });

  it("E2 the count is taken after deduplication", async () => {
    seed();
    const domains = Array.from({ length: 21 }, (_v, i) => `H${i % 20}.Example.com.`);
    expect((await putEntry(homeEntry({ domains }))).statusCode).toBe(200);
    expect(readCfg().tls.sources[0].domains).toHaveLength(20);
  });
});

describe("E3 required fields + solver shape", () => {
  const cases: Array<[string, Record<string, any>, string]> = [
    ["agreeTos missing", homeEntry({ agreeTos: undefined }), "agreeTos"],
    ["agreeTos false", homeEntry({ agreeTos: false }), "agreeTos"],
    ["reserved id tailscale", homeEntry({ id: "tailscale" }), "reserved"],
    ["http directory", homeEntry({ directory: "http://ca.internal/dir" }), "directory"],
    ["userinfo directory", homeEntry({ directory: "https://u:p@ca.internal/dir" }), "directory"],
    ["acme-dns http server", acmeDnsEntry("home", { solver: { type: "acme-dns", server: "http://auth.example.net", subdomain: "s", fulldomain: "s.auth.example.net" } }), "solver.server"],
    ["acme-dns without fulldomain", acmeDnsEntry("home", { solver: { type: "acme-dns", server: "https://auth.example.net", subdomain: "s" } }), "solver.fulldomain"],
    ["cloudflare bad zoneId", homeEntry({ solver: { type: "cloudflare", zoneId: "xyz" } }), "zoneId"],
    ["cloudflare solver carrying a token", homeEntry({ solver: { type: "cloudflare", token: ACME_TOKEN } }), "solver.token"],
  ];

  it.each(cases)("E3 %s → 400 naming the field, config unchanged, no secret stored", async (_label, entry, field) => {
    seed();
    const before = cfgBytes();
    const res = await putEntry(entry);
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().error).toContain(field);
    expect(cfgBytes()).toBe(before);
    expect(cfgBytes() ?? "").not.toContain(ACME_TOKEN);
    expect(res.body).not.toContain(ACME_TOKEN);
  });

  it("E3 duplicate id (another source type already owns it) → 400", async () => {
    registerCertSourceType({ type: "fake", validate: () => null, create: () => ({}) as never });
    seed([{ type: "fake", id: "home" }]);
    const res = await putEntry(homeEntry());
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('"home" is a duplicate source id');
    expect(readCfg().tls.sources).toEqual([{ type: "fake", id: "home" }]);
  });

  it("E3 body id differing from the path id → 400", async () => {
    seed();
    const res = await putJson(app, "/api/tls/acme/home", homeEntry({ id: "lab" }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("body id must equal the path id");
    expect(readCfg().tls.sources).toEqual([]);
  });

  it("E3 a non-acme type or a non-object body is refused", async () => {
    seed();
    expect((await putEntry({ ...homeEntry(), type: "tailscale" })).statusCode).toBe(400);
    expect((await putJson(app, "/api/tls/acme/home", [1] as never)).statusCode).toBe(400);
  });

  it("E3 a second acme-dns source on home's (server, subdomain) → 400, a different subdomain → 200", async () => {
    seed();
    expect((await putEntry(acmeDnsEntry("home"))).statusCode).toBe(200);
    const clash = await putEntry(acmeDnsEntry("lab", { domains: ["lab.example.com"] }));
    expect(clash.statusCode).toBe(400);
    expect(clash.json().error).toContain('acme source "home" already uses this acme-dns registration');
    expect(readCfg().tls.sources.map((s: any) => s.id)).toEqual(["home"]);
    // Normalized equivalence: trailing slash + upper-case host is the same registration.
    const same = acmeDnsEntry("lab", {
      domains: ["lab.example.com"],
      solver: { type: "acme-dns", server: "https://AUTH.example.net/", subdomain: "sub-1", fulldomain: "sub-1.auth.example.net" },
    });
    expect((await putEntry(same)).statusCode).toBe(400);
    const other = acmeDnsEntry("lab", {
      domains: ["lab.example.com"],
      solver: { type: "acme-dns", server: "https://auth.example.net", subdomain: "sub-2", fulldomain: "sub-2.auth.example.net" },
    });
    expect((await putEntry(other)).statusCode).toBe(200);
    expect(readCfg().tls.sources.map((s: any) => s.id)).toEqual(["home", "lab"]);
    // Re-saving home itself is never a clash with itself.
    expect((await putEntry(acmeDnsEntry("home", { domains: ["dash.example.com", "b.example.com"] }))).statusCode).toBe(200);
  });
});

describe("E4 `configured` is ignored", () => {
  it("E4 PUT /api/tls/acme/:id stores no `configured` key", async () => {
    seed();
    const entry = homeEntry({ solver: { type: "cloudflare", configured: true } });
    expect((await putEntry(entry)).statusCode).toBe(200);
    expect(readCfg().tls.sources[0].solver).toEqual({ type: "cloudflare" });
  });

  it("E4 PUT /api/config accepts the projected shape, and a stored `configured` never counts as truth", async () => {
    seed();
    const entry = homeEntry({ solver: { type: "cloudflare", configured: true } });
    expect((await putConfig([entry])).statusCode).toBe(200);
    // Design D5: a whole-array write is stored as sent; the projection overrides it from the vault listing.
    const got = (await app.inject({ method: "GET", url: "/api/config" })).json();
    expect(got.data.tls.sources[0].solver.configured).toBe(false);
  });
});

describe("E22 per-entry write keeps other sources", () => {
  it("E22 PUT home keeps tailscale, calls writeConfigPartial once", async () => {
    seed([{ type: "tailscale" }, homeEntry()]);
    writeSpy.mockClear();
    const res = await putEntry(homeEntry({ domains: ["dash.example.com", "b.example.com"] }));
    expect(res.statusCode, res.body).toBe(200);
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(readCfg().tls.sources).toEqual([
      { type: "tailscale" },
      homeEntry({ domains: ["dash.example.com", "b.example.com"] }),
    ]);
    expect(readCfg().tls.enabled).toBe(false);
    expect(fake.calls.reconcile).toBe(1);
  });

  it("E22 DELETE removes only its entry; an unknown id is a 404 with no write", async () => {
    seed([{ type: "tailscale" }, homeEntry(), acmeDnsEntry("lab", { domains: ["lab.example.com"] })]);
    writeSpy.mockClear();
    expect((await del("nope")).statusCode).toBe(404);
    expect(writeSpy).not.toHaveBeenCalled();
    expect((await del("home")).statusCode).toBe(200);
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(readCfg().tls.sources.map((s: any) => s.id ?? s.type)).toEqual(["tailscale", "lab"]);
  });

  it("E22 a new entry is appended after the existing ones", async () => {
    seed([{ type: "tailscale" }]);
    expect((await putEntry(homeEntry())).statusCode).toBe(200);
    expect(readCfg().tls.sources.map((s: any) => s.id ?? s.type)).toEqual(["tailscale", "home"]);
  });
});

describe("E23 stale tab race", () => {
  it("E23 concurrent PUT home + PUT lab keep tailscale and both entries, serialized on the config save chain", async () => {
    seed([{ type: "tailscale" }, homeEntry()]);
    // Hold the SAME chain PUT /api/config uses: both per-entry writes must queue behind it.
    const gate = deferred();
    const held = runOnConfigSaveChain(() => gate.promise);
    writeSpy.mockClear();
    const before = cfgBytes();
    const a = putEntry(homeEntry({ domains: ["dash.example.com", "b.example.com"] })); // tab A: edited home
    const b = putEntry(acmeDnsEntry("lab", { domains: ["lab.example.com"] })); // tab B: new lab
    await new Promise((r) => setTimeout(r, 60));
    expect(writeSpy).not.toHaveBeenCalled();
    expect(cfgBytes()).toBe(before);
    gate.resolve();
    await held;
    const [ra, rb] = await Promise.all([a, b]);
    expect([ra.statusCode, rb.statusCode]).toEqual([200, 200]);
    expect(writeSpy).toHaveBeenCalledTimes(2);
    const ids = readCfg().tls.sources.map((s: any) => s.id ?? s.type);
    expect(ids).toEqual(["tailscale", "home", "lab"]);
    expect(readCfg().tls.sources[1].domains).toEqual(["dash.example.com", "b.example.com"]);
  });

  it("E23 a racing PUT /api/config on another key cannot drop an entry written meanwhile", async () => {
    seed([{ type: "tailscale" }]);
    const [a, b] = await Promise.all([putEntry(homeEntry()), putJson(app, "/api/config", { tls: { enabled: false } })]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(readCfg().tls.sources.map((s: any) => s.id ?? s.type)).toEqual(["tailscale", "home"]);
  });
});

describe("E24 corrupt config refuses", () => {
  it("E24 PUT and DELETE answer 409 and leave the bytes alone", async () => {
    writeCfgRaw("{not json");
    writeSpy.mockClear();
    const put = await putEntry(homeEntry());
    const del1 = await del("home");
    expect(put.statusCode).toBe(409);
    expect(del1.statusCode).toBe(409);
    expect(put.json().error).toContain("not valid JSON");
    expect(cfgBytes()).toBe("{not json");
    expect(writeSpy).not.toHaveBeenCalled();
    expect(fake.calls.reconcile).toBe(0);
  });

  it("E24 a JSON non-object config is corrupt too", async () => {
    writeCfgRaw("[1,2]");
    expect((await putEntry(homeEntry())).statusCode).toBe(409);
    expect(cfgBytes()).toBe("[1,2]");
  });
});

describe("E13 API redaction", () => {
  it("E13 GET /api/config projects solver.configured and never a secret", async () => {
    seed([homeEntry(), acmeDnsEntry("lab", { domains: ["lab.example.com"] })]);
    await env.credentials.save("home", "cloudflare", { token: ACME_TOKEN });
    await env.credentials.save("lab", "acme-dns", { user: "acme-user-1234", key: "acme-key-123456" });
    // lab: only the user label -> not configured
    const res = await app.inject({ method: "GET", url: "/api/config" });
    expect(res.statusCode).toBe(200);
    const sources = res.json().data.tls.sources;
    expect(sources[0].solver.configured).toBe(true);
    expect(sources[1].solver.configured).toBe(true);
    for (const secret of [ACME_TOKEN, "acme-user-1234", "acme-key-123456"]) expect(res.body).not.toContain(secret);
    // config.json holds none of them either
    for (const secret of [ACME_TOKEN, "acme-user-1234", "acme-key-123456"]) expect(cfgBytes()).not.toContain(secret);
    expect(fs.existsSync(cfgFile())).toBe(true);
  });

  it("E13 a source without credentials projects configured:false", async () => {
    seed([homeEntry()]);
    const res = await app.inject({ method: "GET", url: "/api/config" });
    expect(res.json().data.tls.sources[0].solver.configured).toBe(false);
  });
});
