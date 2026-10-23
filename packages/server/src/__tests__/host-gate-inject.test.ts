/**
 * X11 (test-plan expand-mcp-tiered-surface) — a device caller's `host` header is
 * forwarded through the REST binder, so an inject-mediated MCP call passes the
 * host gate in enforce mode; omitting it is the negative control.
 *
 * See change: expand-mcp-tiered-surface (D4).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { McpCaller } from "@blackbelt-technology/pi-dashboard-mcp-server-plugin/dispatch";
import { dispatchRpc } from "@blackbelt-technology/pi-dashboard-mcp-server-plugin/dispatch";
import type { GeneratedTool } from "@blackbelt-technology/pi-dashboard-mcp-server-plugin/manifest";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerCspReportSink } from "../auth/csp-report-sink.js";
import { CspReportStore } from "../auth/csp-report-store.js";
import { isHostAdmitted } from "../auth/host-admission.js";
import { createHostGate, HostGateState } from "../auth/host-gate.js";

const V = "2026-07-28";
const MODERN = { era: "modern" as const, version: V };
const meta = { _meta: { "io.modelcontextprotocol/protocolVersion": V } };
const deviceCaller: McpCaller = { kind: "device", deviceId: "d1", tier: "operate" };

const open: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((a) => a.close()));
});

const gatedTool: GeneratedTool = {
  name: "gated_fixture",
  description: "host-gated fixture",
  tier: "observe",
  annotations: { readOnlyHint: true, destructiveHint: false },
  inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
  bind: { kind: "rest", method: "GET", path: "/api/gated" },
  paramSplit: { path: [], queryAll: true },
  sessionTargeting: false,
};

async function mkApp(): Promise<FastifyInstance> {
  const app = Fastify();
  open.push(app);
  app.get("/api/gated", async (request, reply) => {
    const admitted = isHostAdmitted(request.headers.host, {
      allowedHosts: ["dash.local"],
      publicBaseUrls: [],
      configuredOrigins: [],
      getLiveTunnelOrigins: () => [],
      // No implicit local admission, so the negative control's default
      // `localhost` Host is genuinely refused.
      bindHost: "0.0.0.0",
    });
    if (!admitted) {
      reply.code(403);
      return { success: false, error: "host_not_admitted" };
    }
    return { success: true, data: { ok: true } };
  });
  await app.ready();
  return app;
}

async function call(app: FastifyInstance, headers: Record<string, unknown>) {
  const res = await dispatchRpc(
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { ...meta, name: "gated_fixture", arguments: {} } },
    MODERN,
    deviceCaller,
    {
      tools: [gatedTool],
      serverInfo: { name: "pi-dashboard", version: "0.7.0" },
      invokeTool: async () => ({}),
      inject: async ({ method, url, headers: h, remoteAddress }) => {
        const r = await app.inject({ method: method as "GET", url, headers: h, remoteAddress });
        let body: unknown = r.body;
        try {
          body = r.json();
        } catch {
          /* keep text */
        }
        return { statusCode: r.statusCode, body };
      },
    },
    { headers },
  );
  return res;
}

describe("X11 — the host gate sees the forwarded host", () => {
  it("admits when `host: dash.local` is forwarded", async () => {
    const app = await mkApp();
    const res = await call(app, { host: "dash.local" });
    expect(res.status).toBe(200);
    const body = res.body as unknown as { result: { isError?: boolean } };
    expect(body.result.isError).toBeFalsy();
  });

  it("negative control — an unadmitted forwarded host is refused", async () => {
    const app = await mkApp();
    // A loopback Host is admitted by design, so the negative control forwards an
    // unadmitted name: the gate refuses exactly what the header carries.
    const res = await call(app, { host: "evil.example" });
    const body = res.body as unknown as { result: { isError?: boolean; content: Array<{ text: string }> } };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("host_not_admitted");
  });
});

describe("WE35 — the host gate covers the CSP report sink", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  async function sinkApp(mode: "report" | "enforce") {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "csp-host-gate-"));
    dirs.push(dir);
    const store = new CspReportStore({ filePath: path.join(dir, "csp-reports.json"), warn: () => {} });
    const app = Fastify({ logger: false });
    open.push(app);
    const state = new HostGateState();
    app.addHook(
      "onRequest",
      createHostGate(() => ({ admission: { publicBaseUrls: [], allowedHosts: ["dash.local"], bindHost: "0.0.0.0" }, mode, envOverridden: false }), state, () => 8000),
    );
    app.get("/api/health", async () => ({ ok: true }));
    registerCspReportSink(app, { store, networkGuard: async () => {}, log: () => {} });
    await app.ready();
    return { app, store };
  }
  const report = JSON.stringify({ "csp-report": { "effective-directive": "script-src-elem" } });
  const postReport = (app: FastifyInstance, host: string) =>
    app.inject({
      method: "POST",
      url: "/__pi/csp-report/strict",
      remoteAddress: "203.0.113.9",
      headers: { host, "content-type": "application/csp-report" },
      payload: report,
    });

  it("report mode: an unadmitted Host still reaches the sink and is counted", async () => {
    const { app, store } = await sinkApp("report");
    const res = await postReport(app, "evil.example");
    expect(res.statusCode).toBe(204);
    expect(store.snapshot().counts.strict["script-src-elem"]).toBe(1);
  });

  it("enforce mode: an unadmitted Host is refused exactly like GET /api/health; nothing is counted", async () => {
    const { app, store } = await sinkApp("enforce");
    const health = await app.inject({ method: "GET", url: "/api/health", remoteAddress: "203.0.113.9", headers: { host: "evil.example" } });
    expect(health.statusCode).toBe(403);
    const res = await postReport(app, "evil.example");
    expect(res.statusCode).toBe(health.statusCode);
    expect(store.snapshot().counts.strict).toEqual({});
    expect(store.snapshot().dropped).toBe(0);
    // an admitted Host is unaffected
    expect((await postReport(app, "dash.local")).statusCode).toBe(204);
  });
});
