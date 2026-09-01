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
import { decideResume, UNATTRIBUTED_REMOTE } from "../session/session-origin.js";
import { delay, until, waitForBind, waitForOpen } from "./pi-gateway-duplicate-register.test.js";

const gateways: Array<{ stop: () => void }> = [];
const sockets: WebSocket[] = [];

afterEach(() => {
  for (const ws of sockets.splice(0)) ws.terminate();
  for (const g of gateways.splice(0)) g.stop();
});

async function startGateway(opts: { provisionalTtlMs?: number; instanceId?: string } = {}) {
  const sessions = createMemorySessionManager();
  const gw = createPiGateway(sessions, {
    pingInterval: 0,
    instanceId: opts.instanceId ?? "instance-target",
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

  it("answers a provisional for an unknown session uniformly, claiming nothing (#X10)", async () => {
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
    // Originally this expected `provisional_rejected`, which broke every real
    // cross-instance move: a move TARGET has never heard of the session. The
    // refusal also leaked exactly what it meant to hide — accept-vs-reject told
    // any local caller whether a session lived on this instance. Answering the
    // same way either way is both correct and quieter.
    expect(reply.type).toBe("provisional_accepted");
    // Accepting grants NOTHING: no routing entry, no session (asserted by the
    // next test), and the token is useless without a commit.
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
  it("moves delivery to the target instance, and only on commit", async () => {
    // TWO gateways, because a move to the instance that already holds the
    // session is not a move — it is the hijack shape the commit handler now
    // refuses. Modelling origin and target as one gateway is what hid two
    // production-fatal defects before live verification found them.
    const A = await startGateway({ instanceId: "instance-origin" });
    const B = await startGateway({ instanceId: "instance-dest" });

    const origin = await connect(A.port);
    origin.send(
      JSON.stringify({ type: "session_register", sessionId: "sess-M", cwd: "/tmp", source: "tui", pid: 7 }),
    );
    await until(() => A.sessions.get("sess-M")?.source === "tui");

    const target = await connect(B.port);
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
    expect(accepted.instanceId).toBe("instance-dest");

    // Pre-commit: the target's traffic is not routable — it owns nothing on B.
    target.send(JSON.stringify({ type: "first_message_update", sessionId: "sess-M", firstMessage: "too-early" }));
    await delay(50);
    expect(B.delivered.some((d) => d.msg.firstMessage === "too-early")).toBe(false);
    expect(B.gw.isSessionConnected("sess-M")).toBe(false);

    target.send(JSON.stringify({ type: "session_move_commit", sessionId: "sess-M", token: accepted.token }));
    await delay(80);

    // Post-commit: B serves the target and has materialised the session it
    // had never heard of.
    expect(B.gw.isSessionConnected("sess-M")).toBe(true);
    expect(B.sessions.get("sess-M")?.cwd).toBe("/tmp");
    target.send(JSON.stringify({ type: "first_message_update", sessionId: "sess-M", firstMessage: "from-target" }));
    await until(() => B.delivered.some((d) => d.msg.firstMessage === "from-target"));

    // The ORIGIN's instance is untouched by a commit on another instance:
    // releasing it is the coordinator's job (session_moved, then disconnect),
    // not a side effect B may inflict remotely.
    expect(A.gw.isSessionConnected("sess-M")).toBe(true);
    origin.send(JSON.stringify({ type: "first_message_update", sessionId: "sess-M", firstMessage: "origin-still" }));
    await until(() => A.delivered.some((d) => d.msg.firstMessage === "origin-still"));
  });

  it("refuses a replayed commit token", async () => {
    // No incumbent on this gateway: it is the move DESTINATION. An origin
    // registered here would (correctly) make the commit a refused hijack.
    const { port } = await startGateway();
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
    // The stranger is answered, but a provisional confers no routing, so the
    // established session is untouched. That is the property under test — the
    // reply type is not what protects the origin, the absence of a claim is.
    expect((await nextMessage(stranger)).type).toBe("provisional_accepted");
    expect(gw.isSessionConnected("absent-session")).toBe(false);

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

/**
 * Task 13.4 — a move between two SEPARATE instances.
 *
 * Every other test in this file models origin and target as one gateway, which
 * is not a move at all: the target already knew the session, so the target-side
 * "do I know this session?" guard was never exercised. Two-instance
 * verification on real sockets found that guard refusing every genuine move
 * with `no-such-session` — the feature was dead in production while the suite
 * stayed green. This is the arm that fails if that guard comes back.
 */
describe("a session moves between two separate instances (task 13.4)", () => {
  it("the target adopts a session it has never heard of", async () => {
    const origin = await startGateway({ instanceId: "instance-origin" });
    const target = await startGateway({ instanceId: "instance-dest" });

    const originWs = await connect(origin.port);
    originWs.send(
      JSON.stringify({
        type: "session_register",
        sessionId: "sess-X",
        cwd: "/work/repo",
        source: "tui",
        pid: 41,
        sessionFile: "/work/repo/.pi/sess-X.jsonl",
      }),
    );
    await until(() => origin.sessions.get("sess-X") !== undefined);

    // The destination genuinely does not know this session.
    expect(target.sessions.get("sess-X")).toBeUndefined();

    const targetWs = await connect(target.port);
    targetWs.send(
      JSON.stringify({
        type: "session_register",
        sessionId: "sess-X",
        cwd: "/work/repo",
        source: "tui",
        pid: 41,
        sessionFile: "/work/repo/.pi/sess-X.jsonl",
        provisional: true,
      }),
    );
    const prov = await nextMessage(targetWs);
    expect(prov.type).toBe("provisional_accepted");
    expect(prov.instanceId).toBe("instance-dest");

    // Still claimed nothing: the origin owns the session until the commit.
    expect(target.sessions.get("sess-X")).toBeUndefined();
    expect(origin.gw.isSessionConnected("sess-X")).toBe(true);

    targetWs.send(JSON.stringify({ type: "session_move_commit", sessionId: "sess-X", token: prov.token }));
    await until(() => target.gw.isSessionConnected("sess-X"));

    // The destination can now RENDER it, not merely route to it — a routing
    // entry with no session record is a dashboard that drops the session.
    const adopted = target.sessions.get("sess-X");
    expect(adopted).toBeDefined();
    expect(adopted?.cwd).toBe("/work/repo");
    expect(adopted?.sessionFile).toBe("/work/repo/.pi/sess-X.jsonl");

    // And it actually serves traffic.
    targetWs.send(
      JSON.stringify({ type: "first_message_update", sessionId: "sess-X", firstMessage: "after-move" }),
    );
    await until(() => target.delivered.some((d) => d.msg.firstMessage === "after-move"));
  });

  it("refuses a replayed commit token at the destination", async () => {
    const origin = await startGateway({ instanceId: "instance-origin" });
    const target = await startGateway({ instanceId: "instance-dest" });
    const originWs = await connect(origin.port);
    originWs.send(
      JSON.stringify({ type: "session_register", sessionId: "sess-Y", cwd: "/w", source: "tui", pid: 9 }),
    );
    await until(() => origin.sessions.get("sess-Y") !== undefined);

    const targetWs = await connect(target.port);
    targetWs.send(
      JSON.stringify({
        type: "session_register",
        sessionId: "sess-Y",
        cwd: "/w",
        source: "tui",
        pid: 9,
        provisional: true,
      }),
    );
    const prov = await nextMessage(targetWs);
    targetWs.send(JSON.stringify({ type: "session_move_commit", sessionId: "sess-Y", token: prov.token }));
    await until(() => target.gw.isSessionConnected("sess-Y"));

    targetWs.send(JSON.stringify({ type: "session_move_commit", sessionId: "sess-Y", token: prov.token }));
    expect((await nextMessage(targetWs)).type).toBe("provisional_rejected");
  });
});

/**
 * The commit frame carries a sessionId AND a token, which are two separate
 * inputs. Honouring the wire id let a caller open a provisional for a
 * throwaway session and then commit naming a victim, taking the victim's
 * routing entry. Found by audit, not by any test above — every existing test
 * happened to send matching ids.
 */
describe("a commit cannot rename the session it was minted for", () => {
  it("refuses a commit that would displace a LIVE incumbent", async () => {
    // Nothing in the protocol proves the mover is the session's origin — the
    // token is minted for whoever asks. So the commit must never take a
    // session out of a live socket's hands, which is the one capability a
    // plain `session_register` (contention + liveness probe) would not grant.
    const { gw, sessions, port, delivered } = await startGateway();

    const victimWs = await connect(port);
    victimWs.send(
      JSON.stringify({ type: "session_register", sessionId: "sess-V", cwd: "/tmp", source: "tui", pid: 7 }),
    );
    await until(() => sessions.get("sess-V")?.source === "tui");

    // A provisional is still answered uniformly — it claims nothing, and
    // refusing here would leak whether the session lives on this instance.
    const attacker = await connect(port);
    attacker.send(
      JSON.stringify({
        type: "session_register",
        sessionId: "sess-V",
        cwd: "/tmp",
        source: "tui",
        pid: 9,
        provisional: true,
      }),
    );
    const prov = await nextMessage(attacker);
    expect(prov.type).toBe("provisional_accepted");

    // The commit is where it must stop.
    attacker.send(JSON.stringify({ type: "session_move_commit", sessionId: "sess-V", token: prov.token }));
    expect((await nextMessage(attacker)).type).toBe("provisional_rejected");

    // The victim still owns the session and is still served...
    expect(gw.isSessionConnected("sess-V")).toBe(true);
    victimWs.send(
      JSON.stringify({ type: "first_message_update", sessionId: "sess-V", firstMessage: "still-mine" }),
    );
    await until(() => delivered.some((d) => d.msg.firstMessage === "still-mine"));

    // ...and the attacker speaks for nothing.
    attacker.send(
      JSON.stringify({ type: "first_message_update", sessionId: "sess-V", firstMessage: "hijacked" }),
    );
    await delay(120);
    expect(delivered.some((d) => d.msg.firstMessage === "hijacked")).toBe(false);
  });

  it("refuses a commit whose sessionId does not match the token", async () => {
    const { gw, sessions, port, delivered } = await startGateway();

    const victimWs = await connect(port);
    victimWs.send(
      JSON.stringify({ type: "session_register", sessionId: "victim", cwd: "/tmp", source: "tui", pid: 7 }),
    );
    await until(() => sessions.get("victim") !== undefined);

    // A provisional for something else entirely.
    const attacker = await connect(port);
    attacker.send(
      JSON.stringify({
        type: "session_register",
        sessionId: "attacker-own",
        cwd: "/tmp",
        source: "tui",
        pid: 8,
        provisional: true,
      }),
    );
    const prov = await nextMessage(attacker);
    expect(prov.type).toBe("provisional_accepted");

    // Commit that token while naming the victim.
    attacker.send(JSON.stringify({ type: "session_move_commit", sessionId: "victim", token: prov.token }));
    expect((await nextMessage(attacker)).type).toBe("provisional_rejected");

    // The victim never moved: still routed to its own socket and still served.
    expect(gw.isSessionConnected("victim")).toBe(true);
    victimWs.send(
      JSON.stringify({ type: "first_message_update", sessionId: "victim", firstMessage: "still-mine" }),
    );
    await until(() => delivered.some((d) => d.msg.firstMessage === "still-mine"));

    // And the attacker's own frames are NOT attributed to the victim.
    attacker.send(
      JSON.stringify({ type: "first_message_update", sessionId: "victim", firstMessage: "stolen" }),
    );
    await delay(120);
    expect(delivered.some((d) => d.msg.firstMessage === "stolen")).toBe(false);
  });
});

/**
 * #E15 — the origin gate must be LIVE, not merely present.
 *
 * `attributeOrigin` and `decideResume` were fully implemented and fully
 * unit-tested while nothing ever set `originDeviceId`, so every session read
 * back as local and the gate was inert in shipped code. These assert the
 * wiring itself: what the gateway stamps onto a session it registers.
 */
describe("a session is attributed to the credential that registered it (#E15)", () => {
  const registerOver = async (opts: {
    peerAddressForTest?: string;
    deviceId?: string;
  }) => {
    const sessions = createMemorySessionManager();
    const gw = createPiGateway(sessions, {
      instanceId: "instance-local",
      peerAddressForTest: opts.peerAddressForTest,
      bridgeAuth: {
        consumeTicket: () => ({ ok: true as const, deviceId: opts.deviceId }),
        requireTicketOnLoopback: false,
        log: () => {},
      },
    });
    gw.onEvent = () => {};
    gateways.push(gw);
    await gw.start(0, "127.0.0.1");
    const port = await waitForBind(gw);

    const ws = await connect(port);
    ws.send(
      JSON.stringify({
        type: "session_register",
        sessionId: "sess-O",
        cwd: "/home/alice/proj",
        source: "tui",
        sessionFile: "/home/alice/.pi/sessions/sess-O.jsonl",
      }),
    );
    await until(() => sessions.get("sess-O") !== undefined);
    return sessions.get("sess-O");
  };

  it("leaves a loopback bridge unattributed — absent means local", async () => {
    const session = await registerOver({ deviceId: "device-7" });
    // Loopback is genuinely this host, so the ticket's device is irrelevant.
    expect(session?.originDeviceId).toBeUndefined();
  });

  it("names the paired device behind a remote bridge", async () => {
    const session = await registerOver({
      peerAddressForTest: "203.0.113.7",
      deviceId: "device-7",
    });
    expect(session?.originDeviceId).toBe("device-7");

    // ...and that is what makes the gate bite: this session's sessionFile is a
    // path on ANOTHER host, so reading it here would serve an unrelated file.
    const verdict = decideResume({
      origin: { local: false, deviceId: session?.originDeviceId },
      status: "ended",
    });
    expect(verdict.allow).toBe(false);
  });

  it("fails closed for an unattributable remote peer", async () => {
    const session = await registerOver({ peerAddressForTest: "203.0.113.7" });
    // NOT undefined: undefined reads back as "local", which is the opposite
    // of failing closed.
    expect(session?.originDeviceId).toBe(UNATTRIBUTED_REMOTE);
  });
});
