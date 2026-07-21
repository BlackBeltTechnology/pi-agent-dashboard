/**
 * Baseline CSP builder + hook. See change: improve-content-editor (§7).
 */
import Fastify from "fastify";
import { describe, it, expect } from "vitest";
import { buildCsp, resolveCspMode, registerCsp } from "../auth/csp.js";

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
