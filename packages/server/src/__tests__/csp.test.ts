/**
 * Baseline CSP builder + hook. See change: improve-content-editor (§7).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AppMountRegistry, mountApp } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCsp, type CspMode, registerCsp, resolveCspMode, resolveTrustedTypesMode } from "../auth/csp.js";
import { createIndexHtmlSender } from "../lib/index-html.js";

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
    expect(res.headers["content-security-policy-report-only"]).toContain("default-src 'self'");
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
    expect(res.headers["content-security-policy-report-only"]).toContain("object-src 'none'");
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
  const RO = "content-security-policy-report-only";
  const EN = "content-security-policy";

  it.each([
    ["report", "report", { [RO]: "baseline+tt", [EN]: undefined }],
    ["enforce", "enforce", { [EN]: "baseline+tt", [RO]: undefined }],
    ["report", "enforce", { [RO]: "baseline", [EN]: "tt-only" }],
    ["enforce", "report", { [EN]: "baseline", [RO]: "tt-only" }],
  ] as const)("CSP %s + TT %s → directive only in the right header kind", async (csp, tt, want) => {
    const app = await appWith(csp, tt);
    const res = await app.inject({ method: "GET", url: "/" });
    for (const [header, shape] of Object.entries(want)) {
      const v = res.headers[header] as string | undefined;
      if (shape === undefined) expect(v, header).toBeUndefined();
      else if (shape === "tt-only") expect(v, header).toBe(TT);
      else if (shape === "baseline") {
        expect(v, header).toBe(buildCsp());
        expect(v).not.toContain("trusted-types");
      } else expect(v, header).toBe(`${buildCsp()}; ${TT}`);
    }
    await app.close();
  });

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
    expect(res.headers[RO]).toBe(TT);
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
