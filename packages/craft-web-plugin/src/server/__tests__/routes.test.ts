/**
 * HTTP skin of the craft-web service through the REAL `registerPlugin`: status / prepare / csp-report
 * shapes, codes and bounds. See change: edit-office-in-pane-with-craft-web (tasks 4.3, 4.5).
 */
import { clearAppMountRegistry } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { afterEach, describe, expect, it } from "vitest";
import registerPlugin from "../index.js";
import { cleanupTmp, type FakeHost, makeHost } from "./helpers.js";

afterEach(() => {
  cleanupTmp();
  clearAppMountRegistry();
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
    expect(Object.keys(body.apps)).toEqual(["wordcraft"]);
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
    const unknown = await host.fastify.inject({ method: "POST", url: "/api/plugins/craft-web/prepare/gridcraft" });
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
    expect((await post(host, { app: "gridcraft", directive: "connect-src" })).statusCode).toBe(400);
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
