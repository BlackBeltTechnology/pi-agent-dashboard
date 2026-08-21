/**
 * `plugin_pi_message` session attribution, at the gateway seam.
 *
 * A plugin makes TRUST decisions on the sessionId it is handed —
 * `mcp-server-plugin` mints a session-scoped credential from it — so the id must
 * be the connection's own registered session, never a field the bridge put in
 * the message body.
 *
 * This test exists because an earlier version of the change asserted that
 * property against a hand-written stand-in for the handler, which ignored the
 * body by construction. That test passed while the real gateway preferred
 * `msg.sessionId` over the socket key, making the whole guard spoofable. The
 * assertion has to run against the REAL dispatch path or it proves nothing.
 *
 * See change: add-dashboard-mcp-server.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createPiGateway } from "../pi/pi-gateway.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";

let gateway: ReturnType<typeof createPiGateway>;
let sockets: WebSocket[] = [];

/** Events the gateway fans out, as `(sessionId, msg)` pairs. */
let seen: Array<{ sessionId: string; msg: { type?: string; messageType?: string } }>;
let boundPort: number;

beforeEach(async () => {
  seen = [];
  const sessionManager = createMemorySessionManager();
  gateway = createPiGateway(sessionManager, { pingInterval: 0 });
  gateway.onEvent = (sessionId, msg) => {
    seen.push({ sessionId, msg: msg as { type?: string } });
  };
  gateway.start(0, "127.0.0.1");
  boundPort = await waitForBind(gateway);
});

afterEach(async () => {
  for (const s of sockets) {
    try {
      s.close();
    } catch {
      /* already gone */
    }
  }
  sockets = [];
  gateway?.stop();
});

/** Poll gateway.address() until the async listen resolves a port. */
async function waitForBind(g: { address(): number | string | null }): Promise<number> {
  for (let i = 0; i < 100; i++) {
    const port = g.address();
    if (typeof port === "number") return port;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("gateway did not bind a port");
}

/** Connect a bridge and register it as `sessionId`, as the extension does. */
async function connectAs(sessionId: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${boundPort}`);
  sockets.push(ws);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  ws.send(JSON.stringify({ type: "register", sessionId, cwd: "/tmp" }));
  await new Promise((r) => setTimeout(r, 50));
  return ws;
}

const listenFor = async (predicate: () => boolean, ms = 500) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && !predicate()) {
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("plugin_pi_message is attributed to the connection, not the body", () => {
  it("uses the registered session id when the body agrees", async () => {
    const ws = await connectAs("session-a");
    ws.send(
      JSON.stringify({
        type: "plugin_pi_message",
        sessionId: "session-a",
        pluginId: "mcp-server",
        messageType: "mcp/mint-token",
        payload: {},
      }),
    );

    await listenFor(() => seen.some((e) => e.msg.type === "plugin_pi_message"));
    const event = seen.find((e) => e.msg.type === "plugin_pi_message");
    expect(event?.sessionId).toBe("session-a");
  });

  it("IGNORES a body sessionId naming a different session (the spoof)", async () => {
    const ws = await connectAs("session-a");

    // Session A's socket claims to be session B. `sessionId` is a REQUIRED
    // field on this envelope, so it is always present — preferring it would
    // let any bridge mint a credential for any session it names.
    ws.send(
      JSON.stringify({
        type: "plugin_pi_message",
        sessionId: "session-b",
        pluginId: "mcp-server",
        messageType: "mcp/mint-token",
        payload: {},
      }),
    );

    await listenFor(() => seen.some((e) => e.msg.type === "plugin_pi_message"));
    const event = seen.find((e) => e.msg.type === "plugin_pi_message");

    expect(event).toBeDefined();
    expect(event?.sessionId).toBe("session-a");
    expect(event?.sessionId).not.toBe("session-b");
  });

  it("two connections minting with the same forged body get their own identities", async () => {
    const a = await connectAs("session-a");
    const b = await connectAs("session-b");

    const forged = {
      type: "plugin_pi_message",
      sessionId: "session-victim",
      pluginId: "mcp-server",
      messageType: "mcp/mint-token",
      payload: {},
    };
    a.send(JSON.stringify(forged));
    b.send(JSON.stringify(forged));

    await listenFor(
      () => seen.filter((e) => e.msg.type === "plugin_pi_message").length >= 2,
    );

    const attributed = seen
      .filter((e) => e.msg.type === "plugin_pi_message")
      .map((e) => e.sessionId)
      .sort();
    expect(attributed).toEqual(["session-a", "session-b"]);
    expect(attributed).not.toContain("session-victim");
  });
});
