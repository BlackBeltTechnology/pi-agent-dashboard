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

async function startGateway(opts: { provisionalTtlMs?: number } = {}) {
  const sessions = createMemorySessionManager();
  const gw = createPiGateway(sessions, {
    pingInterval: 0,
    instanceId: "instance-target",
    provisionalTtlMs: opts.provisionalTtlMs,
  });
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

/**
 * #X8 (task 9.3b) — the commit is the instant routing transfers, end to end.
 *
 * Asserted on DELIVERY, not on the reply: the committing socket does not own
 * the entry when its commit frame arrives, so a gate placed even one branch too
 * early drops the frame that transfers ownership and the move hangs silently.
 */
describe("session_move_commit transfers routing (#X8)", () => {
  it("moves delivery from the origin to the target, and only on commit", async () => {
    const { gw, sessions, port, delivered } = await startGateway();

    const origin = await connect(port);
    origin.send(
      JSON.stringify({ type: "session_register", sessionId: "sess-M", cwd: "/tmp", source: "tui", pid: 7 }),
    );
    await until(() => sessions.get("sess-M")?.source === "tui");

    const target = await connect(port);
    target.send(
      JSON.stringify({
        type: "session_register",
        sessionId: "sess-M",
        cwd: "/tmp",
        source: "tui",
        pid: 7,
        provisional: true,
      }),
    );
    const accepted = await nextMessage(target);
    expect(accepted.type).toBe("provisional_accepted");

    // Pre-commit: the target's traffic is not routable — it owns nothing.
    target.send(JSON.stringify({ type: "first_message_update", sessionId: "sess-M", firstMessage: "too-early" }));
    await delay(50);
    expect(delivered.some((d) => d.msg.firstMessage === "too-early")).toBe(false);

    target.send(JSON.stringify({ type: "session_move_commit", sessionId: "sess-M", token: accepted.token }));
    await delay(80);

    // Post-commit: the target is served, and the gateway still reports the
    // session as connected throughout — the move is a handover, not a gap.
    expect(gw.isSessionConnected("sess-M")).toBe(true);
    target.send(JSON.stringify({ type: "first_message_update", sessionId: "sess-M", firstMessage: "from-target" }));
    await until(() => delivered.some((d) => d.msg.firstMessage === "from-target"));

    // And the origin, now displaced, can no longer speak for the session.
    origin.send(JSON.stringify({ type: "first_message_update", sessionId: "sess-M", firstMessage: "stale-origin" }));
    await delay(60);
    expect(delivered.some((d) => d.msg.firstMessage === "stale-origin")).toBe(false);
  });

  it("refuses a replayed commit token", async () => {
    const { port } = await startGateway();
    const origin = await connect(port);
    origin.send(
      JSON.stringify({ type: "session_register", sessionId: "sess-R", cwd: "/tmp", source: "tui" }),
    );
    await delay(50);

    const target = await connect(port);
    target.send(
      JSON.stringify({ type: "session_register", sessionId: "sess-R", cwd: "/tmp", source: "tui", provisional: true }),
    );
    const accepted = await nextMessage(target);
    target.send(JSON.stringify({ type: "session_move_commit", sessionId: "sess-R", token: accepted.token }));
    await delay(60);

    // A second commit must not re-transfer routing after the origin was released.
    const replay = await connect(port);
    replay.send(JSON.stringify({ type: "session_move_commit", sessionId: "sess-R", token: accepted.token }));
    const reply = await nextMessage(replay);
    expect(reply.type).toBe("provisional_rejected");
  });
});

/**
 * Task 9.3a-ii — the DIFFERENT-pid path, stated explicitly.
 *
 * The same-pid case is the dangerous one (it hits the no-probe fast-accept),
 * so it is where attention goes. But a move between two different pi processes
 * must be just as safe: a refused provisional leaves the origin registered and
 * serving, not displaced.
 */
describe("a refused provisional from a different pid leaves the origin serving (9.3a-ii)", () => {
  it("keeps the origin routed and delivering", async () => {
    const { gw, sessions, port, delivered } = await startGateway();
    const origin = await connect(port);
    origin.send(
      JSON.stringify({ type: "session_register", sessionId: "sess-D", cwd: "/tmp", source: "tui", pid: 100 }),
    );
    await until(() => sessions.get("sess-D")?.source === "tui");

    // A different process entirely, naming a session that does not exist here.
    const stranger = await connect(port);
    stranger.send(
      JSON.stringify({
        type: "session_register",
        sessionId: "absent-session",
        cwd: "/tmp",
        source: "tui",
        pid: 999,
        provisional: true,
      }),
    );
    expect((await nextMessage(stranger)).type).toBe("provisional_rejected");

    await delay(50);
    expect(gw.isSessionConnected("sess-D")).toBe(true);
    origin.send(JSON.stringify({ type: "first_message_update", sessionId: "sess-D", firstMessage: "still-here" }));
    await until(() => delivered.some((d) => d.msg.firstMessage === "still-here"));
  });
});

/**
 * #X8 (task 12.27) — the commit never arrives.
 *
 * The failure this guards against is not an error, it is a SILENCE: a target
 * that opens a provisional and then dies. If the provisional outlived it, a
 * commit arriving minutes later would yank routing away from an origin that had
 * been serving happily in the meantime.
 */
describe("a provisional that is never committed is discarded (#X8)", () => {
  it("expires, leaving the origin owning the session throughout", async () => {
    const ttl = 300;
    const { gw, sessions, port, delivered } = await startGateway({ provisionalTtlMs: ttl });

    const origin = await connect(port);
    origin.send(
      JSON.stringify({ type: "session_register", sessionId: "sess-T", cwd: "/tmp", source: "tui", pid: 5 }),
    );
    await until(() => sessions.get("sess-T")?.source === "tui");

    const target = await connect(port);
    target.send(
      JSON.stringify({
        type: "session_register",
        sessionId: "sess-T",
        cwd: "/tmp",
        source: "tui",
        pid: 5,
        provisional: true,
      }),
    );
    const accepted = await nextMessage(target);
    expect(accepted.type).toBe("provisional_accepted");

    // ...then the target goes silent past the TTL.
    await delay(ttl + 150);

    // A late commit is refused: the provisional is gone.
    target.send(JSON.stringify({ type: "session_move_commit", sessionId: "sess-T", token: accepted.token }));
    expect((await nextMessage(target)).type).toBe("provisional_rejected");

    // The origin never stopped owning the session — asserted on delivery,
    // which is what "owning the send ring" actually means.
    expect(gw.isSessionConnected("sess-T")).toBe(true);
    origin.send(JSON.stringify({ type: "first_message_update", sessionId: "sess-T", firstMessage: "origin-throughout" }));
    await until(() => delivered.some((d) => d.msg.firstMessage === "origin-throughout"));
  });
});
