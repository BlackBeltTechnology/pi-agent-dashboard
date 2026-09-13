/**
 * registerPlugin (change extract-mcp-client-plugin, task 4.1): builds the
 * service, provides it BEFORE routes, and a dependent plugin observes it.
 */

import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerPlugin } from "../index.js";

function fakeCtx(): { ctx: ServerPluginContext; provided: Map<string, unknown>; app: ReturnType<typeof Fastify> } {
  const app = Fastify();
  const provided = new Map<string, unknown>();
  const ctx = {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    consume: (name: string) => provided.get(name),
    provide: (name: string, value: unknown) => {
      provided.set(name, value);
    },
    fastify: app,
    networkGuard: async () => {},
    getPluginConfig: () => ({}),
  } as unknown as ServerPluginContext;
  return { ctx, provided, app };
}

describe("registerPlugin", () => {
  it("provides mcp-client.config and mounts the routes", async () => {
    const { ctx, provided, app } = fakeCtx();
    await registerPlugin(ctx);
    expect(provided.has("mcp-client.config")).toBe(true);
    await app.ready();
    expect(app.hasRoute({ method: "GET", url: "/api/mcp-client/effective" })).toBe(true);
    expect(app.hasRoute({ method: "PUT", url: "/api/mcp-client/servers/:name" })).toBe(true);
    await app.close();
  });

  it("a dependent plugin observes the service during its own registration", async () => {
    const { ctx, provided } = fakeCtx();
    await registerPlugin(ctx);
    // Simulate the loader invoking a dependsOn:["mcp-client"] plugin next.
    const observed = (provided.get("mcp-client.config") as { adapterVerdict?: unknown })?.adapterVerdict;
    expect(typeof observed).toBe("function");
  });
});
