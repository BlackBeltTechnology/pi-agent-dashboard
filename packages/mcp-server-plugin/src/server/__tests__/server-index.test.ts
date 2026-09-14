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
  infos: string[];
  piHandlers: Map<string, (msg: unknown, sessionId: string) => void>;
  /** Flip to `false` to simulate a closed bridge socket at delivery time. */
  setDeliverable: (ok: boolean) => void;
  sentMessages: Array<{ sessionId: string; msg: unknown }>;
}

function makeCtx(config: { adapterVerdict: () => unknown } | undefined): CtxHandle {
  const warnings: string[] = [];
  const infos: string[] = [];
  const piHandlers = new Map<string, (msg: unknown, sessionId: string) => void>();
  const sentMessages: Array<{ sessionId: string; msg: unknown }> = [];
  let deliverable = true;
  const app = Fastify();
  const consumed: Record<string, unknown> = {
    "mcp-client.config": config,
  };
  const ctx = {
    logger: {
      info: (m: string) => infos.push(m),
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
    registerPiHandler: (type: string, handler: (msg: unknown, sessionId: string) => void) => {
      piHandlers.set(type, handler);
    },
    sendExtensionMessage: (sessionId: string, msg: unknown) => {
      if (!deliverable) return false;
      sentMessages.push({ sessionId, msg });
      return true;
    },
    onSessionEnded: () => {},
  } as unknown as ServerPluginContext;
  return { ctx, app, warnings, infos, piHandlers, setDeliverable: (ok: boolean) => { deliverable = ok; }, sentMessages };
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

describe("X1/X5 — the mint reply rides the session-private lane", () => {
  it("X5 — mint → deliver logs the session id but NEVER the plaintext", async () => {
    const { ctx, app, piHandlers, infos, warnings, sentMessages } = makeCtx(undefined);
    await registerPlugin(ctx);
    await app.ready();

    const handler = piHandlers.get("mcp/mint-token");
    expect(handler).toBeDefined();
    handler?.({}, "session-x");

    // The plaintext was delivered exactly once, on the private lane.
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].sessionId).toBe("session-x");
    const token = (sentMessages[0].msg as { token: string }).token;
    expect(token.startsWith("mcp_")).toBe(true);
    expect((sentMessages[0].msg as { type: string }).type).toBe("mcp_token_minted");

    // Every log line, across both sinks: no plaintext, no mcp_ prefix.
    for (const line of [...infos, ...warnings]) {
      expect(line).not.toContain(token);
      expect(line).not.toContain("mcp_");
    }
    await app.close();
  });

  it("X1 — a closed bridge socket at delivery time is logged with the session id; /mcp keeps serving", async () => {
    const { ctx, app, piHandlers, warnings, infos, setDeliverable, sentMessages } = makeCtx(undefined);
    await registerPlugin(ctx);
    await app.ready();

    // The bridge WS dies just as the mint reply is sent.
    setDeliverable(false);
    expect(() => piHandlers.get("mcp/mint-token")?.({}, "session-gone")).not.toThrow();

    // The failure is surfaced, with the affected session id — never silent,
    // never a plaintext leak.
    const failureLines = warnings.filter((w) => w.includes("session-gone"));
    expect(failureLines.length).toBeGreaterThan(0);
    for (const line of [...infos, ...warnings]) expect(line).not.toContain("mcp_");
    expect(sentMessages).toHaveLength(0);

    // The endpoint still serves other callers (401 = alive and guarding).
    const res = await app.inject({ method: "POST", url: "/mcp", payload: {} });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
