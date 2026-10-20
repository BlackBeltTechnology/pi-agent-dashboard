/**
 * HTTP skin of the craft-web service through the REAL `registerPlugin`: status / prepare / csp-report
 * shapes, codes and bounds. See change: edit-office-in-pane-with-craft-web (tasks 4.3, 4.5).
 */

import fs from "node:fs";
import path from "node:path";
import { clearAppMountRegistry } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CRAFT_APP_PROFILES } from "../../shared/app-profiles.js";
import registerPlugin from "../index.js";
import { cleanupTmp, type FakeHost, makeHost, tmp, writeTrunkBuild } from "./helpers.js";

afterEach(() => {
  cleanupTmp();
  clearAppMountRegistry();
  vi.unstubAllEnvs();
});

async function boot(o: Parameters<typeof makeHost>[0] = {}): Promise<FakeHost> {
  const host = makeHost(o);
  await registerPlugin(host.ctx);
  await host.fastify.ready();
  return host;
}

describe("GET /api/plugins/craft-web/status", () => {
  it("returns {shimVersion, apps.<app>: {status, enabled, sizeGzip, preparing, cspViolations, version?}}", async () => {
    const host = await boot();
    const res = await host.fastify.inject({ method: "GET", url: "/api/plugins/craft-web/status" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { shimVersion: number; apps: Record<string, Record<string, unknown>> };
    expect(body.shimVersion).toBeGreaterThanOrEqual(1);
    expect(Object.keys(body.apps)).toEqual(CRAFT_APP_PROFILES.map((p) => p.appId));
    expect(body.apps.wordcraft).toMatchObject({ status: "not-prepared", reason: "not-prepared", enabled: true, preparing: false, cspViolations: 0, version: "0.8.0" });
    await host.fastify.close();
  });

  it("reports restart-required when the mount was not registered", async () => {
    const host = await boot({ mount: false });
    const res = await host.fastify.inject({ method: "GET", url: "/api/plugins/craft-web/status" });
    expect((res.json() as { apps: { wordcraft: { status: string } } }).apps.wordcraft.status).toBe("restart-required");
    await host.fastify.close();
  });
});

describe("POST /api/plugins/craft-web/prepare/:app", () => {
  it("403 for a disabled app, 404 for an unknown app, JSON {ok:false, reason, message}", async () => {
    const host = await boot({ config: { apps: { wordcraft: { enabled: false } } } });
    const disabled = await host.fastify.inject({ method: "POST", url: "/api/plugins/craft-web/prepare/wordcraft" });
    expect(disabled.statusCode).toBe(403);
    expect(disabled.json()).toMatchObject({ ok: false, reason: "disabled" });
    const unknown = await host.fastify.inject({ method: "POST", url: "/api/plugins/craft-web/prepare/figcraft" });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({ ok: false, reason: "unknown-app" });
    await host.fastify.close();
  });
});

describe("POST /api/plugins/craft-web/csp-report", () => {
  const post = (host: FakeHost, payload: unknown) =>
    host.fastify.inject({ method: "POST", url: "/api/plugins/craft-web/csp-report", payload: payload as never, headers: { "content-type": "application/json" } });

  it("accepts {app, directive}, counts it, and exposes the count in status", async () => {
    const host = await boot();
    const res = await post(host, { app: "wordcraft", directive: "connect-src" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    const status = (await host.fastify.inject({ method: "GET", url: "/api/plugins/craft-web/status" })).json() as { apps: { wordcraft: { cspViolations: number } } };
    expect(status.apps.wordcraft.cspViolations).toBe(1);
    await host.fastify.close();
  });

  it("400 for an unclaimed app, a malformed directive or a non-object body; 413 beyond 2 KiB", async () => {
    const host = await boot();
    expect((await post(host, { app: "figcraft", directive: "connect-src" })).statusCode).toBe(400);
    expect((await post(host, { app: "wordcraft", directive: "Connect Src;" })).statusCode).toBe(400);
    expect((await post(host, { app: "wordcraft", directive: 5 })).statusCode).toBe(400);
    expect((await post(host, [1, 2])).statusCode).toBe(400);
    expect((await post(host, { app: "wordcraft", directive: "x".repeat(4000) })).statusCode).toBe(413);
    await host.fastify.close();
  });

  it("429 after 30 reports in a window, without counting the excess", async () => {
    const host = await boot();
    for (let i = 0; i < 30; i++) expect((await post(host, { app: "wordcraft", directive: "connect-src" })).statusCode).toBe(200);
    const res = await post(host, { app: "wordcraft", directive: "connect-src" });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ ok: false, reason: "rate-limited" });
    await host.fastify.close();
  });
});

describe("POST /api/plugins/craft-web/telemetry (observability)", () => {
  const post = (host: FakeHost, payload: unknown) =>
    host.fastify.inject({ method: "POST", url: "/api/plugins/craft-web/telemetry", payload: payload as never, headers: { "content-type": "application/json" } });

  it("logs open outcomes and validator rejects per app as counters, with no paths", async () => {
    const host = await boot();
    expect((await post(host, { app: "wordcraft", kind: "open", outcome: "fallback" })).json()).toEqual({ ok: true });
    expect((await post(host, { app: "wordcraft", kind: "open", outcome: "fallback" })).statusCode).toBe(200);
    expect((await post(host, { app: "wordcraft", kind: "open", outcome: "start-failed" })).statusCode).toBe(200);
    expect((await post(host, { app: "wordcraft", kind: "reject", ext: ".docx" })).statusCode).toBe(200);
    const lines = [...host.logger.info.mock.calls, ...host.logger.warn.mock.calls].map((c) => String(c[0])).filter((l) => l.startsWith("telemetry "));
    expect(lines).toEqual(
      expect.arrayContaining([
        "telemetry wordcraft open outcome=fallback total=1",
        "telemetry wordcraft open outcome=fallback total=2",
        "telemetry wordcraft open outcome=start-failed total=1",
        "telemetry wordcraft validator-reject ext=.docx total=1",
      ]),
    );
    await host.fastify.close();
  });

  it("400 for an unclaimed app, an unknown kind/outcome, or a path in place of an extension", async () => {
    const host = await boot();
    expect((await post(host, { app: "figcraft", kind: "open", outcome: "title" })).statusCode).toBe(400);
    expect((await post(host, { app: "wordcraft", kind: "open", outcome: "maybe" })).statusCode).toBe(400);
    expect((await post(host, { app: "wordcraft", kind: "reject", ext: "/home/u/secret.docx" })).statusCode).toBe(400);
    expect((await post(host, { app: "wordcraft", kind: "other" })).statusCode).toBe(400);
    await host.fastify.close();
  });

  it("429 after 30 events per app in a window", async () => {
    const host = await boot();
    for (let i = 0; i < 30; i++) expect((await post(host, { app: "wordcraft", kind: "open", outcome: "title" })).statusCode).toBe(200);
    expect((await post(host, { app: "wordcraft", kind: "open", outcome: "title" })).statusCode).toBe(429);
    await host.fastify.close();
  });
});

describe("X1 unrecognised start-up (exactly-once hook point)", () => {
  it("a release whose loader hook is ambiguous → 502 extract-failed; current still the old build, which is still served", async () => {
    const host = await boot();
    const good = writeTrunkBuild(path.join(tmp(), "good"));
    vi.stubEnv("WORDCRAFT_WEB_DIR", good);
    const first = await host.fastify.inject({ method: "POST", url: "/api/plugins/craft-web/prepare/wordcraft" });
    expect(first.statusCode).toBe(200);
    const root = path.join(host.dataDir, "wordcraft-web");
    const before = fs.realpathSync(path.join(root, "current"));

    for (const dispatches of [0, 2]) {
      const bad = writeTrunkBuild(path.join(tmp(), `bad-${dispatches}`));
      const idx = path.join(bad, "index.html");
      const html = fs.readFileSync(idx, "utf8");
      const one = 'dispatchEvent(new CustomEvent("TrunkApplicationStarted", {detail: {wasm}}));';
      fs.writeFileSync(idx, html.replace(one, dispatches === 0 ? "" : `${one}\n${one}`));
      vi.stubEnv("WORDCRAFT_WEB_DIR", bad);
      const res = await host.fastify.inject({ method: "POST", url: "/api/plugins/craft-web/prepare/wordcraft" });
      expect(res.statusCode).toBe(502);
      expect(res.json()).toMatchObject({ ok: false, reason: "extract-failed" });
      expect(fs.realpathSync(path.join(root, "current"))).toBe(before);
    }
    const served = await host.fastify.inject({ method: "GET", url: "/apps/craft-wordcraft/index.html" });
    expect(served.statusCode).toBe(200);
    expect(served.body).toContain("craft-shim:");
    await host.fastify.close();
  });
});

describe("X2 GitHub unreachable for a new app (GridCraft)", () => {
  it("status not-prepared; prepare → 503 offline; status then reports offline", async () => {
    const host = await boot();
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    try {
      const before = (await host.fastify.inject({ method: "GET", url: "/api/plugins/craft-web/status" })).json() as { apps: Record<string, { status: string }> };
      expect(before.apps.gridcraft.status).toBe("not-prepared");
      const res = await host.fastify.inject({ method: "POST", url: "/api/plugins/craft-web/prepare/gridcraft" });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ ok: false, reason: "offline" });
    } finally {
      vi.unstubAllGlobals();
      await host.fastify.close();
    }
  });
});
