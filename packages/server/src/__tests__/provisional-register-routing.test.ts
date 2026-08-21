/**
 * #X9 / #X7 (tasks 9.3a, 9.3a-ii) — a provisional registration against a LIVE
 * gateway takes no routing entry, and a refused one leaves the origin serving.
 *
 * The pure `decideClaim` test proves the decision; this proves the wiring. B4's
 * whole point is that the danger lives in the side effects — `connections.set()`
 * runs the instant a register lands, and after it the origin's sends are
 * dropped by the ownership gate. A decision that is correct but reached too
 * late fixes nothing, so the assertion is on the routing map and on delivery,
 * not on the reply.
 *
 * See change: add-pi-gateway-transport-identity (D11).
 */
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createPiGateway } from "../pi/pi-gateway.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { delay, until, waitForBind, waitForOpen } from "./pi-gateway-duplicate-register.test.js";

const gateways: Array<{ stop: () => void }> = [];
const sockets: WebSocket[] = [];

afterEach(() => {
  for (const ws of sockets.splice(0)) ws.terminate();
  for (const g of gateways.splice(0)) g.stop();
});

async function startGateway() {
  const sessions = createMemorySessionManager();
  const gw = createPiGateway(sessions, { pingInterval: 0, instanceId: "instance-target" });
  // Delivery is observed at `onEvent` — the exact hook the ownership gate
  // guards. A frame from a socket that no longer owns the entry never reaches
  // it, so this is the assertion that would break if routing had moved.
  const delivered: Array<{ sessionId: string; msg: any }> = [];
  gw.onEvent = (sessionId, msg) => delivered.push({ sessionId, msg });
  gw.start(0, "127.0.0.1");
  gateways.push(gw);
  const port = await waitForBind(gw);
  return { gw, sessions, port, delivered };
}

async function connect(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  ws.on("error", () => {});
  sockets.push(ws);
  await waitForOpen(ws);
  return ws;
}

const nextMessage = (ws: WebSocket, timeoutMs = 2000) =>
  new Promise<any>((resolve, reject) => {
    const onMsg = (raw: Buffer) => {
      ws.off("message", onMsg);
      resolve(JSON.parse(raw.toString()));
    };
    ws.on("message", onMsg);
    setTimeout(() => reject(new Error("no message")), timeoutMs).unref?.();
  });

describe("provisional registration does not claim routing (#X9)", () => {
  it("leaves the origin owning the entry, and still delivering", async () => {
    const { gw, sessions, port, delivered } = await startGateway();

    const origin = await connect(port);
    origin.send(
      JSON.stringify({
        type: "session_register",
        sessionId: "sess-A",
        cwd: "/tmp",
        source: "tui",
        pid: 4242,
      }),
    );
    await until(() => sessions.get("sess-A")?.source === "tui");
    expect(gw.isSessionConnected("sess-A")).toBe(true);

    // The move target: SAME pid, which is what makes this dangerous — the
    // same-pid fast-accept would hand over routing with no probe at all.
    const target = await connect(port);
    target.send(
      JSON.stringify({
        type: "session_register",
        sessionId: "sess-A",
        cwd: "/tmp",
        source: "tui",
        pid: 4242,
        provisional: true,
      }),
    );
    const reply = await nextMessage(target);
    expect(reply.type).toBe("provisional_accepted");
    // The target's identity travels back, so the origin can verify it before
    // committing (task 9.7).
    expect(reply.instanceId).toBe("instance-target");
    expect(reply.token).toBeTruthy();

    await delay(50);
    // Routing untouched: the origin is still the connected bridge...
    expect(gw.isSessionConnected("sess-A")).toBe(true);
    // ...and the origin's traffic still lands, which is the property the
    // ownership gate would silently break if the entry had moved.
    origin.send(
      JSON.stringify({ type: "first_message_update", sessionId: "sess-A", firstMessage: "from-origin" }),
    );
    await until(() => delivered.some((d) => d.msg.firstMessage === "from-origin"));
    expect(delivered.at(-1)?.sessionId).toBe("sess-A");
  });

  it("refuses a provisional for an unknown session without killing anything (#X10)", async () => {
    const { port } = await startGateway();
    const target = await connect(port);
    target.send(
      JSON.stringify({
        type: "session_register",
        sessionId: "no-such-session",
        cwd: "/tmp",
        source: "tui",
        provisional: true,
      }),
    );
    const reply = await nextMessage(target);
    // NOT `register_rejected`: the bridge treats that as terminal for the
    // session and sets `intentionalClose` (task 9.3a-i).
    expect(reply.type).toBe("provisional_rejected");
    expect(Object.keys(reply)).toEqual(["type"]);
    // The socket stays open — a refused move is not a severed bridge.
    await delay(50);
    expect(target.readyState).toBe(WebSocket.OPEN);
  });

  it("creates no session as a side effect of a provisional register", async () => {
    // A plain register auto-creates a placeholder session. A provisional must
    // not, or asking about a session would CREATE it.
    const { sessions, port } = await startGateway();
    const target = await connect(port);
    target.send(
      JSON.stringify({
        type: "session_register",
        sessionId: "ghost-session",
        cwd: "/tmp",
        source: "tui",
        provisional: true,
      }),
    );
    await nextMessage(target);
    await delay(50);
    expect(sessions.get("ghost-session")).toBeUndefined();
    expect(sessions.listAll()).toHaveLength(0);
  });
});
