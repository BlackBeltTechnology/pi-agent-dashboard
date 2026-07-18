/**
 * Regression: ticketed WS upgrade must route on the URL PATH, not on an
 * exact-match of `request.url` (which includes the query string).
 *
 * Root cause (fix-ticketed-ws-upgrade-routing): paired/remote devices connect
 * to `/ws?ticket=<t>` because the durable bearer must never ride the socket
 * (F6). The old upgrade handler routed on `request.url === "/ws"`, so the
 * `?ticket=` query defeated the exact match and the authorized upgrade fell
 * through to `socket.destroy()` — the dashboard showed "Offline" after a
 * successful pairing.
 *
 * These tests boot a real server and drive the real HTTP-upgrade handler.
 * A `x-forwarded-for` header simulates a remote/tunnel client so the socket is
 * NOT treated as genuine-local — exactly the path a paired device takes — which
 * forces the ticket to be the thing that authorizes the upgrade.
 */
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";
import type { WsRouteScope } from "../auth/ws-ticket.js";

// A loopback source IP carrying a proxy-forwarding header is NOT genuine-local
// (D10, narrowed) — the same shape a zrok/tunnel-relayed device presents.
const REMOTE_HEADERS = { "x-forwarded-for": "203.0.113.7" } as const;

let handle: TestServerHandle | undefined;

afterEach(async () => {
  if (handle) await handle.stop();
  handle = undefined;
});

async function mintTicket(
  httpPort: number,
  scope: WsRouteScope,
  headers: Record<string, string> = {},
): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${httpPort}/api/ws-ticket`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ scope }),
  });
  const json = (await res.json()) as { success: boolean; data?: { ticket: string } };
  if (!json.success || !json.data?.ticket) {
    throw new Error(`ws-ticket mint failed: HTTP ${res.status}`);
  }
  return json.data.ticket;
}

/** Attempt a WS upgrade; resolve "open" on 101, "refused" on any failure. */
function tryConnect(
  url: string,
  headers: Record<string, string> = {},
): Promise<"open" | "refused"> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers });
    const done = (r: "open" | "refused") => {
      try {
        ws.close();
      } catch {
        /* best-effort */
      }
      resolve(r);
    };
    ws.on("open", () => done("open"));
    ws.on("error", () => done("refused"));
    ws.on("unexpected-response", () => done("refused"));
    setTimeout(() => done("refused"), 3000);
  });
}

describe("WS upgrade routing — no-auth-configured branch", () => {
  it("routes a validated ticketed /ws?ticket= remote upgrade to the browser gateway (101)", async () => {
    handle = await createTestServer();
    const ticket = await mintTicket(handle.httpPort, "browser");

    const result = await tryConnect(
      `ws://127.0.0.1:${handle.httpPort}/ws?ticket=${ticket}`,
      REMOTE_HEADERS,
    );

    expect(result).toBe("open");
  }, 15000);

  it("still admits a genuine-local bare /ws upgrade (no regression to the local path)", async () => {
    handle = await createTestServer();

    const result = await tryConnect(`ws://127.0.0.1:${handle.httpPort}/ws`);

    expect(result).toBe("open");
  }, 15000);

  it("refuses a remote bare /ws upgrade with no ticket", async () => {
    handle = await createTestServer();

    const result = await tryConnect(
      `ws://127.0.0.1:${handle.httpPort}/ws`,
      REMOTE_HEADERS,
    );

    expect(result).toBe("refused");
  }, 15000);

  it("refuses a reused ticket (single-use)", async () => {
    handle = await createTestServer();
    const ticket = await mintTicket(handle.httpPort, "browser");

    const first = await tryConnect(
      `ws://127.0.0.1:${handle.httpPort}/ws?ticket=${ticket}`,
      REMOTE_HEADERS,
    );
    expect(first).toBe("open");

    const second = await tryConnect(
      `ws://127.0.0.1:${handle.httpPort}/ws?ticket=${ticket}`,
      REMOTE_HEADERS,
    );
    expect(second).toBe("refused");
  }, 15000);

  it("refuses a browser-scope ticket presented to the terminal route (scope binding intact)", async () => {
    handle = await createTestServer();
    const ticket = await mintTicket(handle.httpPort, "browser");

    const result = await tryConnect(
      `ws://127.0.0.1:${handle.httpPort}/ws/terminal/term-x?ticket=${ticket}`,
      REMOTE_HEADERS,
    );

    expect(result).toBe("refused");
  }, 15000);
});

describe("WS upgrade routing — authConfig.secret configured branch", () => {
  const AUTH = { authConfig: { secret: "test-secret-abc", providers: {} } };

  it("routes a validated ticketed /ws?ticket= remote upgrade to the browser gateway (101)", async () => {
    handle = await createTestServer(AUTH);
    // Mint from localhost (genuine-local passes the networkGuard).
    const ticket = await mintTicket(handle.httpPort, "browser");

    const result = await tryConnect(
      `ws://127.0.0.1:${handle.httpPort}/ws?ticket=${ticket}`,
      REMOTE_HEADERS,
    );

    expect(result).toBe("open");
  }, 15000);

  it("refuses a remote bare /ws upgrade with no ticket", async () => {
    handle = await createTestServer(AUTH);

    const result = await tryConnect(
      `ws://127.0.0.1:${handle.httpPort}/ws`,
      REMOTE_HEADERS,
    );

    expect(result).toBe("refused");
  }, 15000);
});
