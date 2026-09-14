import { expect, test } from "./fixtures.js";
import { gatewayUrlWithTicket, pairDeviceBearer } from "./helpers/bridge-credential.js";
import { BASE_URL } from "./lifecycle.js";

// L3 — the wired per-session MCP credential (test-plan #F1, #F5, #F6;
// change: wire-mcp-session-token).
//
// These specs drive the REAL delivery path end to end from the harness host:
//
//   pairing → bridge-scoped ticket → pi-gateway WebSocket → session_register
//   → plugin_pi_message("mcp/mint-token") → mcp_token_minted (the
//   session-private lane) → POST /mcp with that bearer.
//
// No production seam is mocked or backdoored: the credential is minted by the
// mcp-server plugin exactly as a real bridge receives it, attributed to the
// socket key, and honoured by /mcp's auth boundary.
//
// What the docker harness CANNOT host is a real pi-mcp-adapter inside a
// harness session (the image does not install it), so the env-assignment +
// header-command leg inside a real pi process is verified at L1 (F2/F3/F4,
// mcp-token-delivery.test.ts) and by the qa process-surface probe (X9), not
// here. Every assertion below exercises live server behaviour.
//
// The dashboard port is NEVER hardcoded: the `page` fixture baseURL comes from
// `.pi-test-harness.json#dashboardPort` (see fixtures.ts / global-setup.ts).

const MCP_VERSION = "2026-07-28";
const META_VERSION_KEY = "io.modelcontextprotocol/protocolVersion";
const ADVERTISED_TOOLS = ["list_sessions", "send_prompt", "spawn_session", "abort"];

interface HealthBody {
  pid?: number;
  piGatewayPort?: number | null;
}

async function health(request: import("@playwright/test").APIRequestContext): Promise<HealthBody> {
  const res = await request.get("/api/health");
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as HealthBody;
}

/** One bridge-socket "session" that mints its /mcp credential like a real bridge. */
class BridgeSession {
  readonly sessionId: string;
  readonly cwd: string;
  private ws: WebSocket | null = null;
  private bearer: string | null = null;
  token: string | null = null;

  constructor(sessionId: string, cwd: string) {
    this.sessionId = sessionId;
    this.cwd = cwd;
  }

  private async bearerOnce(): Promise<string> {
    if (!this.bearer) this.bearer = await pairDeviceBearer(BASE_URL);
    return this.bearer;
  }

  /** Connect, register, and await the mint reply on the session-private lane. */
  async connectAndMint(piGatewayPort: number): Promise<string> {
    const url = await gatewayUrlWithTicket(BASE_URL, piGatewayPort, await this.bearerOnce());
    const ws = new WebSocket(url);
    const messages: Array<Record<string, unknown>> = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("bridge open timeout")), 10_000);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("bridge socket error"));
      }, { once: true });
      ws.addEventListener("message", (ev) => {
        try {
          messages.push(JSON.parse(String(ev.data)));
        } catch {
          /* non-JSON frame */
        }
      });
    });
    this.ws = ws;

    // Register first: the mint is attributed to the socket's registered key.
    ws.send(JSON.stringify({
      type: "session_register",
      sessionId: this.sessionId,
      cwd: this.cwd,
      source: "tui",
      pid: 700000 + Math.floor(Math.random() * 99999),
    }));

    // D3/D5: ask for the credential; the plaintext comes back on THIS socket
    // only, as `mcp_token_minted`.
    const minted = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("mint reply timeout")), 10_000);
      ws.addEventListener("message", (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as { type?: string; token?: unknown };
          if (msg.type === "mcp_token_minted" && typeof msg.token === "string") {
            clearTimeout(timer);
            resolve(msg.token);
          }
        } catch {
          /* non-JSON frame */
        }
      });
    });
    ws.send(JSON.stringify({
      type: "plugin_pi_message",
      sessionId: this.sessionId,
      pluginId: "mcp-server",
      messageType: "mcp/mint-token",
      payload: {},
    }));
    this.token = await minted;
    return this.token;
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}

/** A JSON-RPC tools/list against /mcp with a session bearer. */
async function mcpCall(
  request: import("@playwright/test").APIRequestContext,
  token: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await request.post("/mcp", {
    headers: {
      authorization: `Bearer ${token}`,
      "mcp-protocol-version": MCP_VERSION,
      "content-type": "application/json",
    },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method,
      params: { _meta: { [META_VERSION_KEY]: MCP_VERSION }, ...params },
    },
    timeout: 15_000,
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* non-JSON (should not happen on /mcp) */
  }
  return { status: res.status(), body };
}

test.describe("wired per-session MCP credential (wire-mcp-session-token)", () => {
  test("#F6 works out of the box — provisioned entry + minted session credential, no hand-editing", async ({ request }) => {
    // The harness container's mcp.json is NEVER hand-edited. The dashboard's
    // own provisioning wrote the entry on boot; the effective view proves the
    // auth transport is present and carries no credential at rest.
    // Host-side fetch (the bridge-credential helper's pattern): the specs dial
    // the published dashboard port directly.
    const raw = (await (
      await fetch(`${BASE_URL}/api/mcp-client/effective`)
    ).json()) as {
      servers?: Array<{ name: string; entry: Record<string, unknown> }>;
    };
    const effective = raw;
    const entry = effective.servers?.find((s) => s.name === "pi-dashboard")?.entry;
    expect(entry, "pi-dashboard entry must be provisioned out of the box").toBeTruthy();
    const cmd = entry?.requestHeadersCommand as
      | { command: string; args: string[]; env: Record<string, string> }
      | undefined;
    expect(cmd, "the D2 auth transport must be provisioned").toBeTruthy();
    expect(cmd?.env).toEqual({ PI_DASHBOARD_MCP_TOKEN: "${PI_DASHBOARD_MCP_TOKEN}" });
    for (const arg of cmd?.args ?? []) expect(arg).not.toContain("${");
    expect(JSON.stringify(effective)).not.toMatch(/mcp_[A-Za-z0-9_-]{10,}/);

    // A session's bridge mints over the private lane and the provisioned
    // endpoint serves a full tools/list to that credential — with zero
    // operator action anywhere in between.
    const port = (await health(request)).piGatewayPort;
    expect(port).toBeTruthy();
    const session = new BridgeSession("e2e-mcp-f6", "/tmp/e2e-mcp-f6");
    try {
      const token = await session.connectAndMint(port!);
      const { status, body } = await mcpCall(request, token, "tools/list");
      expect(status).toBe(200);
      const names = ((body.result as { tools?: Array<{ name: string }> }).tools ?? []).map((t) => t.name);
      expect(names).toEqual(ADVERTISED_TOOLS);
    } finally {
      session.close();
    }
  });

  test("#F5 two sessions in one cwd hold distinct credentials that resolve distinctly", async ({ request }) => {
    const port = (await health(request)).piGatewayPort;
    expect(port).toBeTruthy();
    // Same directory, same everything — the credential is what distinguishes.
    const cwd = "/tmp/e2e-mcp-f5-shared";
    const a = new BridgeSession("e2e-mcp-f5-a", cwd);
    const b = new BridgeSession("e2e-mcp-f5-b", cwd);
    try {
      const tokenA = await a.connectAndMint(port!);
      const tokenB = await b.connectAndMint(port!);
      expect(tokenA).not.toBe(tokenB);

      // Each self-target refusal proves the server resolves THAT token to
      // THAT session: send_prompt targeting one's own id is refused (403)…
      const selfA = await mcpCall(request, tokenA, "tools/call", {
        name: "send_prompt",
        arguments: { sessionId: "e2e-mcp-f5-a", text: "self" },
      });
      expect(selfA.status).toBe(403);
      expect(JSON.stringify(selfA.body)).toContain("SelfTargetRefused");

      const selfB = await mcpCall(request, tokenB, "tools/call", {
        name: "send_prompt",
        arguments: { sessionId: "e2e-mcp-f5-b", text: "self" },
      });
      expect(selfB.status).toBe(403);

      // …while the SAME token against the OTHER session is NOT self-targeting
      // (the resolved caller stays A — the body's claim cannot move it, E3).
      const cross = await mcpCall(request, tokenA, "tools/call", {
        name: "send_prompt",
        arguments: { sessionId: "e2e-mcp-f5-b", text: "cross" },
      });
      expect(cross.status).toBe(200);
    } finally {
      a.close();
      b.close();
    }
  });

  test("#F1 a dashboard restart re-delivers: the fresh token works and the stale one is refused", async ({ request }) => {
    const before = await health(request);
    expect(before.piGatewayPort).toBeTruthy();
    const session = new BridgeSession("e2e-mcp-f1", "/tmp/e2e-mcp-f1");
    try {
      const oldToken = await session.connectAndMint(before.piGatewayPort!);
      const pre = await mcpCall(request, oldToken, "tools/list");
      expect(pre.status).toBe(200);

      // Restart the dashboard server. The bridge socket dies mid-flight (the
      // restart tears the connection down); the server-side registry dies
      // with the old process — exactly the production restart shape.
      await request.post("/api/restart", { timeout: 10_000 }).catch(() => {
        // Transport error mid-restart is the expected shape of a success.
      });

      // Wait for the replacement process, then for its gateway port.
      let after: HealthBody | null = null;
      for (let i = 0; i < 60; i += 1) {
        await new Promise((r) => setTimeout(r, 1000));
        const now = await health(request).catch(() => null);
        if (now?.pid && now.pid !== before.pid && now.piGatewayPort) {
          after = now;
          break;
        }
      }
      expect(after, "a new server process with a gateway port must come up").toBeTruthy();

      // The stale token is now dead (in-memory registry died with the old
      // process) — presenting it is refused, exactly as before this change.
      await expect
        .poll(async () => (await mcpCall(request, oldToken, "tools/list")).status, {
          timeout: 30_000,
        })
        .toBe(401);

      // The bridge re-registers on reconnect; the mint re-runs; the FRESH
      // token reaches /mcp with no operator action.
      //
      // Scope note (CodeRabbit round 1): this drives the protocol as a bridge
      // CLIENT, so it pins the SERVER contract — re-registration yields a
      // fresh credential the endpoint honours while the stale one is refused.
      // The production bridge's own re-registration is the REAL reconnect
      // path (session-sync.ts sendStateSync → re-mint, D3) and is pinned at
      // L1 (session-sync.test.ts D3 block); the docker harness cannot observe
      // a real pi bridge's env/handshake (no adapter in the image).
      const freshToken = await session.connectAndMint(after!.piGatewayPort!);
      expect(freshToken).not.toBe(oldToken);
      const post = await mcpCall(request, freshToken, "tools/list");
      expect(post.status).toBe(200);
      const names = ((post.body.result as { tools?: Array<{ name: string }> }).tools ?? []).map((t) => t.name);
      expect(names).toEqual(ADVERTISED_TOOLS);
    } finally {
      session.close();
    }
  });
});
