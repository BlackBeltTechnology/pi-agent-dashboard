/**
 * registerPlugin: builds the service over pi's MCP config, consumes the host
 * trust rule, provides it BEFORE routes, and a dependent plugin observes it.
 * See change: migrate-mcp-to-pi-builtin; earlier: extract-mcp-client-plugin (task 4.1).
 */

import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import registerPlugin from "../index.js";

function fakeCtx(services: Record<string, unknown> = {}) {
  const app = Fastify();
  const provided = new Map<string, unknown>(Object.entries(services));
  const warns: string[] = [];
  const ctx = {
    logger: { info: () => {}, warn: (m: string) => warns.push(m), error: () => {} },
    consume: (name: string) => provided.get(name),
    provide: (name: string, value: unknown) => {
      provided.set(name, value);
    },
    fastify: app,
    networkGuard: async () => {},
    getPluginConfig: () => ({}),
  } as unknown as ServerPluginContext;
  return { ctx, provided, app, warns };
}

describe("registerPlugin", () => {
  it("provides mcp-client.config and mounts the routes", async () => {
    const { ctx, provided, app } = fakeCtx({ "host.isProjectTrusted": () => true });
    await registerPlugin(ctx);
    const svc = provided.get("mcp-client.config") as { ensureServerEntry?: unknown; checkConfigFiles?: unknown };
    expect(typeof svc.ensureServerEntry).toBe("function");
    expect(typeof svc.checkConfigFiles).toBe("function");
    await app.ready();
    expect(app.hasRoute({ method: "GET", url: "/api/mcp-client/effective" })).toBe(true);
    expect(app.hasRoute({ method: "GET", url: "/api/mcp-client/live" })).toBe(true);
    expect(app.hasRoute({ method: "PUT", url: "/api/mcp-client/servers/:name" })).toBe(true);
    expect(app.hasRoute({ method: "PUT", url: "/api/mcp-client/settings" })).toBe(false);
    expect(app.hasRoute({ method: "GET", url: "/api/mcp-client/adapter" })).toBe(false);
    await app.close();
  });

  it("warns once when the host trust service is missing", async () => {
    const { ctx, warns, app } = fakeCtx();
    await registerPlugin(ctx);
    expect(warns.filter((w) => w.includes("host.isProjectTrusted"))).toHaveLength(1);
    await app.close();
  });
});
