/**
 * E2E: tiered MCP tokens against the real harness (change:
 * expand-mcp-tiered-surface, test-plan F6/F7).
 *
 * F6  an `observe` token's `tools/list` omits `send_prompt`; calling it is
 *     refused 403 with the `insufficient_scope` scope challenge.
 * F7  an `operate` token's `tools/list` contains `force_kill`, and the call
 *     reaches the tool (not a tier refusal).
 *
 * Tokens are minted through the real operator-gated route and presented to the
 * real `/mcp` endpoint — the auth + tier pipeline is not stubbed.
 */

import { COOKIE_NAME, signToken } from "../../packages/server/src/auth/auth.js";
import { expect, test } from "./fixtures.js";
import { BASE_URL } from "./lifecycle.js";

const E2E_AUTH_SECRET = "e2e-auth-secret-32-chars-longxxxx";
const SESSION_USER = { sub: "e2e@example.com", name: "e2e operator", username: "e2e", provider: "github" };
const MCP_VERSION = "2026-07-28";
const META = { "io.modelcontextprotocol/protocolVersion": MCP_VERSION };

let sessionToken = "";
let preTestConfig: { trustedNetworks?: unknown; auth?: Record<string, unknown> } | null = null;

const authedHeaders = () => ({ cookie: `${COOKIE_NAME}=${sessionToken}` });

async function armOperatorSession(request: import("@playwright/test").APIRequestContext): Promise<void> {
  sessionToken = signToken(SESSION_USER, E2E_AUTH_SECRET);
  const cur = (await (await request.get("/api/config", { headers: authedHeaders() })).json()).data as {
    trustedNetworks?: unknown;
    auth?: Record<string, unknown>;
  };
  preTestConfig = { trustedNetworks: cur?.trustedNetworks, auth: cur?.auth };
  await request.put("/api/config", {
    headers: authedHeaders(),
    data: { trustedNetworks: [], auth: { ...(cur?.auth ?? {}), bypassUrls: ["/v1/"] } },
  });
}

async function restoreOperatorSession(request: import("@playwright/test").APIRequestContext): Promise<void> {
  if (!preTestConfig) return;
  const cur = (await (await request.get("/api/config", { headers: authedHeaders() })).json()).data as {
    auth?: Record<string, unknown>;
  };
  await request.put("/api/config", {
    headers: authedHeaders(),
    data: {
      trustedNetworks: preTestConfig.trustedNetworks,
      auth: { ...(cur?.auth ?? {}), bypassUrls: preTestConfig.auth?.bypassUrls ?? ["/"] },
    },
  });
  preTestConfig = null;
}

async function mint(
  request: import("@playwright/test").APIRequestContext,
  tier: "observe" | "control" | "operate",
): Promise<string> {
  const res = await request.post("/api/paired-devices", {
    headers: { ...authedHeaders(), "content-type": "application/json" },
    data: { label: `e2e-${tier}-${Date.now()}`, tier },
  });
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { data: { token: string } };
  return body.data.token;
}

async function mcp(
  request: import("@playwright/test").APIRequestContext,
  token: string,
  payload: Record<string, unknown>,
) {
  return request.post("/mcp", {
    headers: {
      authorization: `Bearer ${token}`,
      "mcp-protocol-version": MCP_VERSION,
      "content-type": "application/json",
    },
    data: payload,
  });
}

const rpc = (method: string, params: Record<string, unknown> = {}) => ({
  jsonrpc: "2.0",
  id: 1,
  method,
  params: { _meta: META, ...params },
});

test.describe("tiered MCP tokens", () => {
  test.beforeEach(async ({ request, context }) => {
    await armOperatorSession(request);
    await context.addCookies([{ name: COOKIE_NAME, value: sessionToken, url: BASE_URL }]);
  });

  test.afterAll(async ({ request }) => {
    await restoreOperatorSession(request);
  });

  test("F6 — an observe token cannot see or call send_prompt", async ({ request }) => {
    const token = await mint(request, "observe");

    const list = await mcp(request, token, rpc("tools/list"));
    expect(list.status()).toBe(200);
    const names = ((await list.json()) as { result: { tools: Array<{ name: string }> } }).result.tools.map(
      (t) => t.name,
    );
    expect(names).not.toContain("send_prompt");
    expect(names).toContain("list_sessions");

    const call = await mcp(request, token, rpc("tools/call", { name: "send_prompt", arguments: { sessionId: "x", text: "hi" } }));
    expect(call.status()).toBe(403);
    const challenge = call.headers()["www-authenticate"] ?? "";
    expect(challenge).toContain("insufficient_scope");
    expect(challenge).toContain('scope="control"');
  });

  test("F7 — an operate token sees force_kill and the call reaches the tool", async ({ request }) => {
    const token = await mint(request, "operate");

    const list = await mcp(request, token, rpc("tools/list"));
    expect(list.status()).toBe(200);
    const names = ((await list.json()) as { result: { tools: Array<{ name: string }> } }).result.tools.map(
      (t) => t.name,
    );
    expect(names).toContain("force_kill");

    // A force_kill call is NOT tier-refused; the tool runs (an unknown session
    // yields a tool-level result, not a 403 scope challenge).
    const call = await mcp(request, token, rpc("tools/call", { name: "force_kill", arguments: { sessionId: "e2e-no-such-session" } }));
    expect(call.status()).toBe(200);
    const challenge = call.headers()["www-authenticate"];
    expect(challenge).toBeUndefined();
  });
});
