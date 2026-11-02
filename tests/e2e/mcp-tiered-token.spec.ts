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
import { expect, narrowTrust, test } from "./fixtures.js";
import { readBaselineFile, readConfig } from "./helpers/trust-access.js";
import { BASE_URL } from "./lifecycle.js";
import { compareTrust, pickTrust } from "./reap-core.js";

const E2E_AUTH_SECRET = "e2e-auth-secret-32-chars-longxxxx";
const SESSION_USER = { sub: "e2e@example.com", name: "e2e operator", username: "e2e", provider: "github" };
const MCP_VERSION = "2026-07-28";
const META = { "io.modelcontextprotocol/protocolVersion": MCP_VERSION };

let sessionToken = "";

const authedHeaders = () => ({ cookie: `${COOKIE_NAME}=${sessionToken}` });

/**
 * Narrow the harness trust seed so the auth hook runs the cookie branch.
 * Test scope: `narrowTrust` snapshots here and the reap fixture restores right
 * after the test — on failure and timeout too, where an `afterAll` never ran
 * (#832). See change: triage-browser-e2e-offbox-poison.
 */
async function armOperatorSession(request: import("@playwright/test").APIRequestContext): Promise<void> {
  sessionToken = signToken(SESSION_USER, E2E_AUTH_SECRET);
  await narrowTrust(request, { trustedNetworks: [], auth: { bypassUrls: ["/v1/"] } });
}

async function mint(
  request: import("@playwright/test").APIRequestContext,
  tier: "observe" | "control" | "operate",
): Promise<string> {
  const res = await request.post("/api/paired-devices", {
    headers: { ...authedHeaders(), "content-type": "application/json" },
    data: { label: `e2e-${tier}-${Date.now()}`, tier },
  });
  if (!res.ok()) throw new Error(`mint failed: HTTP ${res.status()} ${await res.text()}`);
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
  // F4/F2 — runs BEFORE this spec narrows: whatever ran before (a describe-scope
  // group such as lan-knock, or this spec's own previous test) must have left the
  // harness exactly at its boot baseline. Test-scope narrowing is restored by the
  // reap fixture straight after each test; describe scope when this file's first
  // test starts.
  test.beforeEach(async () => {
    const file = readBaselineFile();
    test.skip(!file?.baseline, "no boot trust baseline recorded (no readable config path)");
    const read = await readConfig(file?.credential ?? false);
    expect(read.status).toBe(200);
    expect(compareTrust(file?.baseline ?? undefined, pickTrust(read.data)).message).toBe("");
  });

  test.beforeEach(async ({ request, context }) => {
    await armOperatorSession(request);
    await context.addCookies([{ name: COOKIE_NAME, value: sessionToken, url: BASE_URL }]);
  });

  test("F8 — while narrowed, the operator read works and the credential-free read is refused", async () => {
    const operator = await readConfig(true);
    expect(operator.status, "operator config read must be admitted while narrowed").toBe(200);
    expect(operator.data?.trustedNetworks).toEqual([]);
    const anonymous = await readConfig(false);
    expect([401, 403]).toContain(anonymous.status);
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
  // close-security-map-high-findings D2 (test-plan #E57): the answer tools are gone
  // at every tier; the tier behaviour of the other tools is unchanged.
  test("D2 — prompt_response is absent / unknown-tool at every tier; other tools unchanged", async ({ request }) => {
    for (const tier of ["observe", "control", "operate"] as const) {
      const token = await mint(request, tier);
      const list = await mcp(request, token, rpc("tools/list"));
      expect(list.status(), tier).toBe(200);
      const names = ((await list.json()) as { result: { tools: Array<{ name: string }> } }).result.tools.map(
        (t) => t.name,
      );
      expect(names, tier).not.toContain("prompt_response");
      expect(names, tier).not.toContain("extension_ui_response");
      expect(names.includes("send_prompt"), `${tier} send_prompt`).toBe(tier !== "observe");
      expect(names.includes("force_kill"), `${tier} force_kill`).toBe(tier === "operate");

      for (const name of ["prompt_response", "extension_ui_response"]) {
        const call = await mcp(
          request,
          token,
          rpc("tools/call", { name, arguments: { sessionId: "e2e-no-such-session", promptId: "p", answer: "x" } }),
        );
        expect(call.status(), `${tier} ${name}`).toBe(404);
        expect(call.headers()["www-authenticate"], `${tier} ${name}`).toBeUndefined();
        const body = (await call.json()) as { error: { code: number; message: string } };
        expect(body.error.code).toBe(-32601);
        expect(body.error.message).toBe(`Unknown tool: ${name}`);
      }
    }
  });
});
