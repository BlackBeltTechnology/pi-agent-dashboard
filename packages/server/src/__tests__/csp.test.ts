/**
 * Baseline CSP builder + hook. See change: improve-content-editor (§7).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AppMountRegistry, mountApp } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildCsp,
  buildStrictCsp,
  type CspMode,
  cspNonceFor,
  markViteProxied,
  registerCsp,
  resolveCspMode,
  resolveTrustedTypesMode,
} from "../auth/csp.js";
import { cspReportPath } from "../auth/csp-report-paths.js";
import { createIndexHtmlSender } from "../lib/index-html.js";

const RO = "content-security-policy-report-only";
const EN = "content-security-policy";
/** Every value of a (possibly repeated) response header. */
const hv = (res: { headers: Record<string, unknown> }, name: string): string[] => [res.headers[name]].flat().filter((v): v is string => typeof v === "string");
const nonceOf = (v: string) => v.match(/'nonce-([^']+)'/)?.[1];
const isStrict = (v: string) => /script-src 'self'(?: 'nonce-[^']+')?;/.test(v);
const isBaseline = (v: string) => v.includes("script-src 'self' 'unsafe-inline' 'unsafe-eval'");

describe("buildCsp", () => {
  it("locks down the high-value directives", () => {
    const csp = buildCsp();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("worker-src 'self' blob:");
  });
});

describe("resolveCspMode", () => {
  it("defaults to report-only", () => {
    expect(resolveCspMode(undefined)).toBe("report");
    expect(resolveCspMode("garbage")).toBe("report");
  });
  it("honours enforce / off", () => {
    expect(resolveCspMode("enforce")).toBe("enforce");
    expect(resolveCspMode("off")).toBe("off");
  });
});

describe("registerCsp hook", () => {
  async function appWith(mode: Parameters<typeof registerCsp>[1]) {
    const app = Fastify({ logger: false });
    registerCsp(app, mode);
    app.get("/", async () => "ok");
    app.get("/live/x/", async () => "live");
    await app.ready();
    return app;
  }

  it("report mode sets the report-only header on own responses", async () => {
    const app = await appWith("report");
    const res = await app.inject({ method: "GET", url: "/" });
    expect(hv(res, RO).some((v) => v.includes("default-src 'self'"))).toBe(true);
    expect(res.headers["content-security-policy"]).toBeUndefined();
    await app.close();
  });

  it("enforce mode sets the enforcing header", async () => {
    const app = await appWith("enforce");
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.headers["content-security-policy"]).toContain("object-src 'none'");
    await app.close();
  });

  it("skips proxied/embedded prefixes (/live)", async () => {
    const app = await appWith("enforce");
    for (const url of ["/live/x/"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.headers["content-security-policy"], url).toBeUndefined();
    }
    await app.close();
  });

  it("off mode adds no header", async () => {
    const app = await appWith("off");
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.headers["content-security-policy"]).toBeUndefined();
    expect(res.headers["content-security-policy-report-only"]).toBeUndefined();
    await app.close();
  });
});

// ── add-plugin-capability-routes (D7): a `serveApp` response keeps its own enforced policy in EVERY mode ──
describe("registerCsp + serveApp mounts (test-plan #E14)", () => {
  const APP_CSP = "default-src 'self'";
  let tmp: string;
  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "csp-apps-")));
    fs.mkdirSync(path.join(tmp, "dist"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "dist", "index.html"), "<p>x</p>");
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  async function mounted(mode: Parameters<typeof registerCsp>[1]) {
    const app = Fastify({ logger: false });
    registerCsp(app, mode);
    app.get("/", async () => "ok");
    mountApp(
      {
        fastify: app,
        pluginId: "wall",
        packageRoot: tmp,
        dataDir: path.join(tmp, "data"),
        logger: { info() {}, warn() {}, error() {} },
        registry: new AppMountRegistry(),
      },
      { dir: path.join(tmp, "dist"), csp: APP_CSP },
    );
    await app.ready();
    return app;
  }

  it.each(["report", "enforce", "off"] as const)("%s mode: the app's enforcing header equals its declared value", async (mode) => {
    const app = await mounted(mode);
    for (const url of ["/apps/wall/", "/apps/wall/deep/link"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers["content-security-policy"], `${mode} ${url}`).toBe(APP_CSP);
    }
    await app.close();
  });

  it("report mode also carries the baseline report-only header on the mount", async () => {
    const app = await mounted("report");
    const res = await app.inject({ method: "GET", url: "/apps/wall/" });
    expect(hv(res, RO).some((v) => v.includes("object-src 'none'"))).toBe(true);
    await app.close();
  });

  it("enforce mode never overwrites the app's policy with the baseline", async () => {
    const app = await mounted("enforce");
    const res = await app.inject({ method: "GET", url: "/apps/wall/" });
    expect(res.headers["content-security-policy"]).toBe(APP_CSP);
    expect(res.headers["content-security-policy"]).not.toContain("unsafe-eval");
    await app.close();
  });

  it("off mode: the mount still sets its own policy while core pages get none", async () => {
    const app = await mounted("off");
    const own = await app.inject({ method: "GET", url: "/" });
    expect(own.headers["content-security-policy"]).toBeUndefined();
    await app.close();
  });
});

// decouple-plugins-from-core 6.4 — test-plan #E94 (BCSP: tightening script-src keeps the import map working).
describe("sendIndexWithImportMap under a nonce-based script-src (E94)", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "csp-index-"));
    fs.writeFileSync(path.join(dir, "index.html"), '<html><head><script type="module" src="/assets/i.js"></script></head></html>');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("the baseline does not adopt nonces yet: no nonce attribute is emitted without one", async () => {
    expect(buildCsp()).not.toContain("nonce-");
    const app = Fastify();
    const sender = createIndexHtmlSender(dir);
    app.get("/", (_req, reply) => sender.sendIndexWithImportMap(reply));
    const res = await app.inject("/");
    expect(res.body).toContain('<script type="importmap">');
    expect(res.body).not.toContain("nonce=");
    await app.close();
  });

  it("with a per-response nonce the importmap tag carries it", async () => {
    const app = Fastify();
    const sender = createIndexHtmlSender(dir);
    app.get("/", (_req, reply) => sender.sendIndexWithImportMap(reply, { nonce: "n1" }));
    const res = await app.inject("/");
    expect(res.body).toContain('<script type="importmap" nonce="n1">');
    await app.close();
  });
});

// ── harden-client-sinks (D7): independent PI_DASHBOARD_TRUSTED_TYPES mode ──
const TT = "require-trusted-types-for 'script'";

describe("resolveTrustedTypesMode (#E17)", () => {
  const CSP_RAW = [undefined, "off", "report", "enforce"] as const;
  it.each(CSP_RAW)("TT unset / junk follows CSP %s: off iff CSP off, else report", (cspRaw) => {
    const csp = resolveCspMode(cspRaw);
    for (const tt of [undefined, "junk", ""]) {
      expect(resolveTrustedTypesMode(tt, csp)).toBe(csp === "off" ? "off" : "report");
    }
  });
  it.each(CSP_RAW)("explicit TT values win over CSP %s", (cspRaw) => {
    const csp = resolveCspMode(cspRaw);
    for (const tt of ["off", "report", "enforce"] as const) expect(resolveTrustedTypesMode(tt, csp)).toBe(tt);
  });
  it("CSP enforce + TT unset → report (existing enforce users get no TT enforcement)", () => {
    expect(resolveTrustedTypesMode(undefined, "enforce")).toBe("report");
  });
});

describe("Trusted Types directive emission (#E18)", () => {
  async function appWith(csp: CspMode, tt: CspMode) {
    const app = Fastify({ logger: false });
    registerCsp(app, csp, tt);
    app.get("/", async () => "ok");
    app.get("/live/x", async () => "live");
    await app.ready();
    return app;
  }
  it("off + off registers no hook", async () => {
    const app = Fastify({ logger: false });
    let hooks = 0;
    const orig = app.addHook.bind(app);
    (app as unknown as { addHook: typeof app.addHook }).addHook = ((...a: Parameters<typeof app.addHook>) => {
      hooks++;
      return orig(...a);
    }) as typeof app.addHook;
    registerCsp(app, "off", "off");
    expect(hooks).toBe(0);
    await app.close();
  });

  it("TT on with CSP off still emits only the TT directive", async () => {
    const app = await appWith("off", "report");
    const res = await app.inject({ method: "GET", url: "/" });
    expect(hv(res, RO)).toHaveLength(1);
    expect(hv(res, RO)[0]!.split("; ")[0]).toBe(TT);
    expect(hv(res, RO)[0]).not.toContain("default-src");
    expect(res.headers[EN]).toBeUndefined();
    await app.close();
  });

  it("/live/ carries no directive", async () => {
    const app = await appWith("report", "enforce");
    const res = await app.inject({ method: "GET", url: "/live/x" });
    expect(res.headers[RO]).toBeUndefined();
    expect(res.headers[EN]).toBeUndefined();
    await app.close();
  });

  it("the baseline directive list is unchanged", () => {
    expect(buildCsp()).not.toContain("trusted-types");
  });

  it("a serveApp mount's own enforcing CSP stays byte-identical under TT enforce", async () => {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "csp-tt-")));
    try {
      fs.mkdirSync(path.join(tmp, "dist"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "dist", "index.html"), "<p>x</p>");
      const app = Fastify({ logger: false });
      registerCsp(app, "report", "enforce");
      mountApp(
        { fastify: app, pluginId: "wall", packageRoot: tmp, dataDir: path.join(tmp, "data"), logger: { info() {}, warn() {}, error() {} }, registry: new AppMountRegistry() },
        { dir: path.join(tmp, "dist"), csp: "default-src 'self'" },
      );
      await app.ready();
      const res = await app.inject({ method: "GET", url: "/apps/wall/" });
      expect(res.headers[EN]).toBe("default-src 'self'");
      await app.close();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("index.html carries the mode meta", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "csp-tt-index-"));
    try {
      fs.writeFileSync(path.join(dir, "index.html"), '<html><head><script type="module" src="/assets/i.js"></script></head></html>');
      for (const mode of ["off", "report", "enforce"] as const) {
        const app = Fastify();
        const sender = createIndexHtmlSender(dir, { trustedTypesMode: mode });
        app.get("/", (_req, reply) => sender.sendIndexWithImportMap(reply));
        const res = await app.inject("/");
        expect(res.body).toContain(`<meta name="pi-trusted-types" content="${mode}">`);
        expect(res.body.indexOf("pi-trusted-types")).toBeLessThan(res.body.indexOf('type="module"'));
        await app.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── harden-cors-and-csp-reporting (S3b, D9/D10): strict nonce policy + dual Report-Only ──
const P = (label: "baseline" | "strict" | "trusted-types") => cspReportPath(label);
const MODES: CspMode[] = ["off", "report", "enforce"];

/** WE14 invariants over every CSP-kind header value of one response. */
function assertTtTopology(ro: string[], en: string[], tt: CspMode): void {
  const all = [...ro, ...en];
  expect(all.reduce((n, v) => n + v.split(TT).length - 1, 0)).toBe(tt === "off" ? 0 : 1);
  if (tt !== "off") {
    const holder = all.filter((v) => v.includes(TT));
    expect(holder).toHaveLength(1);
    expect(en.includes(holder[0]!)).toBe(tt === "enforce");
  }
  for (const v of all) {
    expect(v).not.toContain(",");
    if (!isBaseline(v)) expect(v).not.toContain("'unsafe-eval'");
    if (isStrict(v)) expect(v).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
  }
}

describe("strict CSP emission", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "csp-strict-"));
    fs.writeFileSync(path.join(dir, "index.html"), '<html><head><script type="module" src="/assets/i.js"></script></head><body></body></html>');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  /** `vite` toggles per request: while true, `/` and `/assets/*` behave like a Vite-proxied response. */
  async function build(csp: CspMode, tt: CspMode, vite: { on: boolean } = { on: false }) {
    const app = Fastify({ logger: false });
    registerCsp(app, csp, tt);
    const sender = createIndexHtmlSender(dir);
    const html = (reply: Parameters<typeof cspNonceFor>[0]) => sender.sendIndexWithImportMap(reply, { nonce: cspNonceFor(reply) });
    const viteStub = (reply: Parameters<typeof cspNonceFor>[0]) => {
      if (!vite.on) return false;
      markViteProxied(reply);
      reply.type("text/html").send("<p>vite</p>");
      return true;
    };
    app.get("/", async (_req, reply) => (viteStub(reply) ? reply : html(reply)));
    app.get("/index.html", async (_req, reply) => html(reply));
    app.get("/assets/a.js", async (_req, reply) => (viteStub(reply) ? reply : reply.type("application/javascript").send("1")));
    app.get("/api/health", async () => ({ ok: true }));
    app.get("/sink", async (_req, reply) => reply.code(204).send());
    app.setNotFoundHandler(async (req, reply) => (req.url.startsWith("/api/") ? reply.code(404).send({ error: "nf" }) : html(reply)));
    await app.ready();
    return app;
  }
  const get = (app: Awaited<ReturnType<typeof build>>, url = "/") => app.inject({ method: "GET", url });

  it("WE11: report mode emits baseline + strict Report-Only naming their sinks; TT off emits nothing else", async () => {
    const app = await build("report", "off");
    const res = await get(app);
    const ro = hv(res, RO);
    expect(ro).toHaveLength(2);
    const base = ro.find(isBaseline)!;
    const strict = ro.find(isStrict)!;
    expect(base).toContain(`report-uri ${P("baseline")}`);
    expect(strict).toContain(`report-uri ${P("strict")}`);
    expect(res.headers[EN]).toBeUndefined();
    expect([...ro, ...hv(res, EN)].join()).not.toContain("require-trusted-types-for");
    const endpoints = String(res.headers["reporting-endpoints"]);
    expect(endpoints).toContain(`csp-baseline="${P("baseline")}"`);
    expect(endpoints).toContain(`csp-strict="${P("strict")}"`);
    expect(base).toContain("report-to csp-baseline");
    expect(strict).toContain("report-to csp-strict");
    await app.close();
  });

  it("WE11: report mode + TT enforce adds a TT-only enforcing header naming the trusted-types sink", async () => {
    const app = await build("report", "enforce");
    const res = await get(app);
    expect(hv(res, RO)).toHaveLength(2);
    expect(hv(res, RO).join()).not.toContain("require-trusted-types-for");
    const en = hv(res, EN);
    expect(en).toHaveLength(1);
    expect(en[0]!.split("; ")[0]).toBe(TT);
    expect(en[0]).not.toContain("default-src");
    expect(en[0]).toContain(`report-uri ${P("trusted-types")}`);
    expect(String(res.headers["reporting-endpoints"])).toContain(`csp-trusted-types="${P("trusted-types")}"`);
    await app.close();
  });

  it.each(["off", "report", undefined] as const)("WE12: enforce mode, TT %s", async (ttRaw) => {
    const tt = resolveTrustedTypesMode(ttRaw, "enforce");
    const app = await build("enforce", tt);
    const res = await get(app);
    const en = hv(res, EN);
    expect(en).toHaveLength(1);
    expect(isStrict(en[0]!)).toBe(true);
    expect(en[0]).toContain(`report-uri ${P("strict")}`);
    for (const v of [...en, ...hv(res, RO)]) expect(v).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    if (tt === "off") expect(res.headers[RO]).toBeUndefined();
    else {
      const ro = hv(res, RO);
      expect(ro).toHaveLength(1);
      expect(ro[0]!.split("; ")[0]).toBe(TT);
      expect(ro[0]).toContain(`report-uri ${P("trusted-types")}`);
    }
    await app.close();
  });

  it.each(["off", undefined, "report", "enforce"] as const)("WE13: CSP off, TT %s", async (ttRaw) => {
    const tt = resolveTrustedTypesMode(ttRaw, "off");
    const raw = Fastify({ logger: false });
    let hooks = 0;
    const orig = raw.addHook.bind(raw);
    (raw as unknown as { addHook: typeof raw.addHook }).addHook = ((...a: Parameters<typeof raw.addHook>) => {
      if (a[0] === "onSend") hooks++;
      return orig(...a);
    }) as typeof raw.addHook;
    registerCsp(raw, "off", tt);
    expect(hooks).toBe(tt === "off" ? 0 : 1);
    await raw.close();

    const app = await build("off", tt);
    const res = await get(app);
    if (tt === "off") {
      expect(res.headers[RO]).toBeUndefined();
      expect(res.headers[EN]).toBeUndefined();
      expect(res.headers["reporting-endpoints"]).toBeUndefined();
    } else {
      const kind = tt === "enforce" ? EN : RO;
      const other = tt === "enforce" ? RO : EN;
      expect(res.headers[other]).toBeUndefined();
      const v = hv(res, kind);
      expect(v).toHaveLength(1);
      expect(v[0]!.split("; ")[0]).toBe(TT);
      expect(v[0]).not.toMatch(/default-src|script-src/);
      expect(v[0]).not.toContain(P("baseline"));
      expect(v[0]).not.toContain(P("strict"));
    }
    await app.close();
  });

  describe("WE14: TT directive topology across the mode matrix", () => {
    const combos = MODES.flatMap((csp) => (["off", "report", "enforce", undefined] as const).flatMap((tt) => [false, true].map((dev) => [csp, tt, dev] as const)));
    it.each(combos)("CSP %s × TT %s × vite-dev %s", async (csp, ttRaw, dev) => {
      const tt = resolveTrustedTypesMode(ttRaw, csp);
      const app = await build(csp, tt, { on: dev });
      const res = await get(app);
      assertTtTopology(hv(res, RO), hv(res, EN), tt);
      await app.close();
    });
  });

  it.each([
    [undefined, "report"],
    ["", "report"],
    ["Enforce", "report"],
    ["ENFORCE", "report"],
    [" enforce", "report"],
    ["1", "report"],
    ["garbage", "report"],
    ["report", "report"],
    ["enforce", "enforce"],
    ["off", "off"],
  ] as const)("WE15: PI_DASHBOARD_CSP=%j → %s (default stays report)", (raw, want) => {
    expect(resolveCspMode(raw)).toBe(want);
  });

  it("WE16: strict and baseline differ only in script-src and the report tokens", async () => {
    const app = await build("report", "off");
    const ro = hv(await get(app), RO);
    const strip = (v: string) =>
      v
        .split("; ")
        .filter((d) => !/^(script-src|report-uri|report-to)\b/.test(d))
        .join("; ");
    const base = ro.find(isBaseline)!;
    const strict = ro.find(isStrict)!;
    expect(strip(strict)).toBe(strip(base));
    const scriptSrc = (v: string) => v.split("; ").find((d) => d.startsWith("script-src "))!;
    expect(scriptSrc(base)).toBe("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    expect(scriptSrc(strict).split(" ").slice(1)).toEqual(["'self'", expect.stringMatching(/^'nonce-[^']+'$/)]);
    for (const d of [
      "default-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "worker-src 'self' blob:",
      "connect-src 'self' ws: wss:",
      "frame-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'self'",
    ])
      expect(strict.split("; ")).toContain(d);
    expect(buildStrictCsp("abc")).toContain("script-src 'self' 'nonce-abc'");
    expect(buildStrictCsp()).toContain("script-src 'self';");
    await app.close();
  });

  it.each(["report", "enforce"] as const)("WE17: Vite-proxied responses (%s) get baseline only: no strict, nonce or destinations", async (csp) => {
    const app = await build(csp, "off", { on: true });
    for (const url of ["/", "/assets/a.js"]) {
      const res = await get(app, url);
      const all = [...hv(res, RO), ...hv(res, EN)];
      expect(all, url).toHaveLength(1);
      expect(isBaseline(all[0]!)).toBe(true);
      for (const [k, v] of Object.entries(res.headers)) {
        expect(String(v), k).not.toContain("nonce-");
        expect(String(v), k).not.toContain(P("baseline"));
        expect(String(v), k).not.toContain(P("strict"));
      }
    }
    // control: production + enforce → strict enforcing
    const prod = await build("enforce", "off");
    const res = await get(prod);
    expect(hv(res, EN).some(isStrict)).toBe(true);
    await app.close();
    await prod.close();
  });

  it("WE18: nonce is fresh per HTML response and matches its own import map", async () => {
    const app = await build("report", "off");
    const seen = new Set<string>();
    const check = (res: Awaited<ReturnType<typeof get>>, head: boolean) => {
      const nonce = nonceOf(hv(res, RO).find(isStrict)!)!;
      expect(nonce).toMatch(/^[A-Za-z0-9+/=_-]+$/);
      expect(Buffer.from(nonce, "base64")).toHaveLength(16);
      if (!head) expect(res.body).toContain(`<script type="importmap" nonce="${nonce}">`);
      expect(seen.has(nonce)).toBe(false);
      seen.add(nonce);
    };
    const urls = ["/", "/index.html", "/settings/security"];
    for (let i = 0; i < 1000; i++) check(await get(app, urls[i % urls.length]), false);
    for (let i = 0; i < 20; i++) check(await app.inject({ method: "HEAD", url: "/" }), true);
    const burst = await Promise.all(Array.from({ length: 100 }, (_, i) => get(app, urls[i % urls.length])));
    for (const res of burst) check(res, false);
    expect(seen.size).toBe(1120);
    await app.close();
  }, 60_000);

  it("WE19: no non-HTML response carries a nonce or reuses the preceding HTML nonce", async () => {
    for (const csp of ["report", "enforce"] as const) {
      const app = await build(csp, "off");
      const html = await get(app);
      const htmlNonce = nonceOf([...hv(html, RO), ...hv(html, EN)].find(isStrict)!)!;
      for (const url of ["/api/health", "/assets/a.js", "/sink", "/api/nope"]) {
        const res = await get(app, url);
        for (const v of [...hv(res, RO), ...hv(res, EN)]) {
          expect(v, `${csp} ${url}`).not.toContain("nonce-");
          expect(v).not.toContain(htmlNonce);
        }
      }
      await app.close();
    }
  });

  describe("WE21: route-level policies and /live/", () => {
    const APP_CSP = "default-src 'self'";
    const SANDBOX = "sandbox; default-src 'none'";
    let tmp: string;
    beforeEach(() => {
      tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "csp-we21-")));
      fs.mkdirSync(path.join(tmp, "dist"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "dist", "index.html"), "<p>x</p>");
    });
    afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

    const cells = MODES.flatMap((csp) => (["off", "enforce"] as const).map((tt) => [csp, tt] as const));
    it.each(cells)("CSP %s × TT %s", async (csp, tt) => {
      const app = Fastify({ logger: false });
      registerCsp(app, csp, tt);
      app.get("/api/file/raw", async (_req, reply) => reply.header(EN, SANDBOX).send("raw"));
      app.get("/live/x/y", async () => "live");
      mountApp(
        { fastify: app, pluginId: "wall", packageRoot: tmp, dataDir: path.join(tmp, "data"), logger: { info() {}, warn() {}, error() {} }, registry: new AppMountRegistry() },
        { dir: path.join(tmp, "dist"), csp: APP_CSP },
      );
      await app.ready();
      const mount = await app.inject("/apps/wall/");
      expect(mount.headers[EN]).toBe(APP_CSP);
      const raw = await app.inject("/api/file/raw");
      expect(raw.headers[EN]).toBe(SANDBOX);
      if (csp === "report") expect(hv(mount, RO)).toHaveLength(2);
      const live = await app.inject("/live/x/y");
      expect(live.headers[RO]).toBeUndefined();
      expect(live.headers[EN]).toBeUndefined();
      expect(live.headers["reporting-endpoints"]).toBeUndefined();
      await app.close();
    });
  });

  it.each([
    ["report", "report"],
    ["enforce", "enforce"],
    ["report", "enforce"],
    ["enforce", "report"],
  ] as const)("WE40: TT topology (CSP %s, TT %s)", async (csp, tt) => {
    const app = await build(csp, tt);
    const res = await get(app);
    const ro = hv(res, RO);
    const en = hv(res, EN);
    if (csp === tt) {
      const carrier = (csp === "report" ? ro.find(isBaseline) : en.find(isStrict))!;
      expect(carrier.split(TT)).toHaveLength(2);
      expect([...ro, ...en].filter((v) => v.includes(TT))).toHaveLength(1);
      expect([...ro, ...en].some((v) => v.startsWith(TT))).toBe(false); // no TT-only header
      if (csp === "report") expect(ro.find(isStrict)).not.toContain(TT);
      expect(carrier).toContain(`report-uri ${P(csp === "report" ? "baseline" : "strict")}`);
    } else {
      const only = [...ro, ...en].filter((v) => v.startsWith(TT));
      expect(only).toHaveLength(1);
      expect(only[0]).toContain(`report-uri ${P("trusted-types")}`);
      expect((tt === "enforce" ? en : ro).includes(only[0]!)).toBe(true);
    }
    await app.close();
  });

  it("WE41: Vite-proxied response under enforce carries the baseline policy enforcing", async () => {
    const app = await build("enforce", "off", { on: true });
    const res = await get(app);
    const en = hv(res, EN);
    expect(en).toHaveLength(1);
    expect(en[0]!.split("; ")).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    expect(res.headers[RO]).toBeUndefined();
    expect(en[0]).not.toContain("nonce-");
    await app.close();
  });

  it.each(MODES.slice(1).flatMap((c) => (["report", "enforce"] as const).map((t) => [c, t] as const)))("WE42: dev responses (CSP %s × TT %s) name no destination", async (csp, tt) => {
    const app = await build(csp, tt, { on: true });
    for (const url of ["/", "/assets/a.js"]) {
      const res = await get(app, url);
      expect(res.headers["reporting-endpoints"]).toBeUndefined();
      for (const v of [...hv(res, RO), ...hv(res, EN)]) {
        expect(v).not.toMatch(/report-uri|report-to|\/__pi\/csp-report\//);
      }
      expect([...hv(res, RO), ...hv(res, EN)].join()).toContain(TT);
    }
    await app.close();
  });

  it("WE43: dev detection is per response (Vite up → down → up)", async () => {
    const vite = { on: true };
    const app = await build("report", "off", vite);
    const probe = async () => {
      const res = await get(app);
      return { ro: hv(res, RO), body: res.body };
    };
    let r = await probe();
    expect(r.ro).toHaveLength(1);
    expect(r.ro[0]).not.toContain("nonce-");
    vite.on = false;
    r = await probe();
    expect(r.ro).toHaveLength(2);
    const strict = r.ro.find(isStrict)!;
    expect(nonceOf(strict)).toBeTruthy();
    expect(r.body).toContain(`nonce="${nonceOf(strict)}"`);
    vite.on = true;
    r = await probe();
    expect(r.ro).toHaveLength(1);
    expect(r.ro.join()).not.toContain("nonce-");
    await app.close();
  });

  it.each(["report", "enforce"] as const)("WE44: non-HTML responses (%s) carry strict without a nonce; HTML carries one", async (csp) => {
    const app = await build(csp, "off");
    const kind = csp === "enforce" ? EN : RO;
    for (const url of ["/api/health", "/assets/a.js", "/sink", "/api/nope"]) {
      const res = await get(app, url);
      const strict = hv(res, kind).find(isStrict);
      expect(strict, url).toBeDefined();
      expect(strict!.split("; ")).toContain("script-src 'self'");
      expect(strict).not.toContain("nonce-");
    }
    const html = hv(await get(app), kind).filter((v) => v.includes("nonce-"));
    expect(html).toHaveLength(1);
    await app.close();
  });

  it.each(["report", "enforce"] as const)("WP6: nonce + header cost on GET / is < 1 ms p99 (%s)", async (csp) => {
    const N = 10_000;
    const sample = async (withCsp: boolean) => {
      const app = Fastify({ logger: false });
      if (withCsp) registerCsp(app, csp, "off");
      const sender = createIndexHtmlSender(dir);
      app.get("/", (_req, reply) => (withCsp ? sender.sendIndexWithImportMap(reply, { nonce: cspNonceFor(reply) }) : sender.sendIndexWithImportMap(reply)));
      await app.ready();
      for (let i = 0; i < 500; i++) await app.inject("/"); // warm up
      const times: number[] = [];
      for (let i = 0; i < N; i++) {
        const t = performance.now();
        await app.inject("/");
        times.push(performance.now() - t);
      }
      await app.close();
      times.sort((a, b) => a - b);
      return times[Math.floor(N * 0.99)]!;
    };
    const off = await sample(false);
    const on = await sample(true);
    expect(on - off).toBeLessThan(1);
  }, 120_000);
});
