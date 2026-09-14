/**
 * registerPlugin wiring (change extract-mcp-client-plugin, task 6.1): the
 * adapter-version diagnostic runs lazily on the FIRST POST /mcp, not at
 * registration; an absent `mcp-client.config` service reads as `unknown`; and
 * the plugin declares no manifest `dependsOn` (the config service is a package
 * dependency, so a missing plugin degrades rather than blocking load).
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { ADAPTER_VERSION_FLOOR } from "@blackbelt-technology/pi-dashboard-mcp-client-plugin/core";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerPlugin } from "../index.js";

interface CtxHandle {
  ctx: ServerPluginContext;
  app: ReturnType<typeof Fastify>;
  warnings: string[];
}

function makeCtx(config: { adapterVerdict: () => unknown } | undefined): CtxHandle {
  const warnings: string[] = [];
  const app = Fastify();
  const consumed: Record<string, unknown> = {
    "mcp-client.config": config,
  };
  const ctx = {
    logger: {
      info: () => {},
      warn: (m: string) => warnings.push(m),
      error: () => {},
    },
    consume: (name: string) => consumed[name],
    provide: () => {},
    fastify: app,
    sessionManager: { listAll: () => [] },
    sendToSession: () => false,
    spawnSession: async () => ({}),
    abortSession: async () => false,
    onEvent: () => () => {},
    registerPiHandler: () => {},
    onSessionEnded: () => {},
  } as unknown as ServerPluginContext;
  return { ctx, app, warnings };
}

const ADAPTER_MSG = "upgrade now";

let cfgDir: string;
beforeEach(() => {
  // Sandbox provisioning: the plugin writes the Pi-global mcp.json at
  // registration, and PI_CODING_AGENT_DIR is where the adapter resolves it.
  cfgDir = mkdtempSync(join(tmpdir(), "mcp-server-cfg-"));
  process.env.PI_CODING_AGENT_DIR = cfgDir;
});
afterEach(() => {
  delete process.env.PI_CODING_AGENT_DIR;
  rmSync(cfgDir, { recursive: true, force: true });
});

describe("registerPlugin adapter diagnostic (task 6.1)", () => {
  it("does not probe at registration; warns once on the first /mcp request", async () => {
    const adapterVerdict = vi.fn(() => ({
      kind: "below-floor",
      installed: "2.19.0",
      floor: ADAPTER_VERSION_FLOOR,
      message: ADAPTER_MSG,
    }));
    const { ctx, app, warnings } = makeCtx({ adapterVerdict });
    await registerPlugin(ctx);
    await app.ready();

    // Registration must NOT have probed or warned.
    expect(adapterVerdict).not.toHaveBeenCalled();
    expect(warnings.filter((w) => w.includes(ADAPTER_MSG))).toHaveLength(0);

    // First POST /mcp fires it exactly once.
    await app.inject({ method: "POST", url: "/mcp", payload: {} });
    expect(adapterVerdict).toHaveBeenCalledTimes(1);
    expect(warnings.filter((w) => w.includes(ADAPTER_MSG))).toHaveLength(1);

    // Second POST does not repeat it.
    await app.inject({ method: "POST", url: "/mcp", payload: {} });
    expect(adapterVerdict).toHaveBeenCalledTimes(1);
    expect(warnings.filter((w) => w.includes(ADAPTER_MSG))).toHaveLength(1);

    await app.close();
  });

  it("an absent service still warns once on first request, reading as `unknown`", async () => {
    const { ctx, app, warnings } = makeCtx(undefined);
    await registerPlugin(ctx);
    await app.ready();
    await app.inject({ method: "POST", url: "/mcp", payload: {} });
    expect(warnings.filter((w) => w.includes("unknown"))).toHaveLength(1);
    await app.close();
  });
});

describe("manifest (task 6.1)", () => {
  it("declares no dependsOn — the config service is a package dependency", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../../../package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      "pi-dashboard-plugin"?: { dependsOn?: string[] };
    };
    expect(pkg["pi-dashboard-plugin"]?.dependsOn).toBeUndefined();
    expect(pkg.dependencies?.["@blackbelt-technology/pi-dashboard-mcp-client-plugin"]).toBeTruthy();
  });
});
