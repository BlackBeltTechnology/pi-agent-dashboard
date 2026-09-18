/**
 * X11 (test-plan expand-mcp-tiered-surface) — a device caller's `host` header is
 * forwarded through the REST binder, so an inject-mediated MCP call passes the
 * host gate in enforce mode; omitting it is the negative control.
 *
 * See change: expand-mcp-tiered-surface (D4).
 */
import { dispatchRpc } from "@blackbelt-technology/pi-dashboard-mcp-server-plugin/dispatch";
import type { GeneratedTool } from "@blackbelt-technology/pi-dashboard-mcp-server-plugin/manifest";
import type { McpCaller } from "@blackbelt-technology/pi-dashboard-mcp-server-plugin/dispatch";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { isHostAdmitted } from "../auth/host-admission.js";

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
