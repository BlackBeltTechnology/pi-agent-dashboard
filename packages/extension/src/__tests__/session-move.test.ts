/**
 * Explicit session move: overlap, then commit (D11; tasks 9.3b, 9.3c).
 *
 * `ConnectionManager` holds exactly one socket, and `updateUrl()` sets the URL
 * then immediately calls `handleDisconnect()` — so "moving" today is a GAP, not
 * a handover: the origin is torn down before the target exists, and anything
 * sent in between is buffered against a socket that will never come back.
 *
 * The coordinator instead runs two connections briefly and swaps only on a
 * successful commit. The property under test is the one a user would actually
 * notice — **exactly one connection owns sends at every instant**. Two owners
 * duplicates a prompt; zero owners drops it. Both are silent.
 *
 * Test-plan #X7, #X8, #X9; scenarios 12.13, 12.14, 12.20.
 * See change: add-pi-gateway-transport-identity.
 */
import { describe, expect, it, vi } from "vitest";
import { decideRetarget } from "../endpoint-resolution.js";
import {
  assessTranscriptFollow,
  createMoveCoordinator,
  type MovableConnection,
} from "../session-move.js";

/** A ConnectionManager stand-in recording every frame it was asked to send. */
function fakeConnection(url: string) {
  const sent: unknown[] = [];
  let connected = false;
  let closed = false;
  const conn: MovableConnection & {
    url: string;
    sent: unknown[];
    closed: boolean;
    inbound?: (msg: unknown) => void;
  } = {
    url,
    sent,
    get closed() {
      return closed;
    },
    connect() {
      connected = true;
    },
    disconnect() {
      closed = true;
      connected = false;
    },
    send(m: unknown) {
      sent.push(m);
    },
    get isConnected() {
      return connected;
    },
    onMessage(handler: (msg: unknown) => void) {
      conn.inbound = handler;
    },
  };
  return conn;
}

function setup(opts: { timeoutMs?: number } = {}) {
  const made: ReturnType<typeof fakeConnection>[] = [];
  const origin = fakeConnection("ws://origin");
  origin.connect();
  const coord = createMoveCoordinator({
    origin,
    sessionId: "sess-A",
    connect: (url) => {
      const c = fakeConnection(url);
      made.push(c);
      return c;
    },
    timeoutMs: opts.timeoutMs,
  });
  return { coord, origin, made, target: () => made[0] };
}

/** Drive the target through provisional acceptance. */
function acceptProvisional(target: ReturnType<typeof fakeConnection>, instanceId = "instance-target") {
  target.connect();
  target.inbound?.({
    type: "provisional_accepted",
    sessionId: "sess-A",
    instanceId,
    token: "tok-1",
  });
}

describe("send ownership during a move (task 9.3c)", () => {
  it("keeps the ORIGIN owning sends while the target is only provisional", async () => {
    const { coord, origin, target } = setup();
    const move = coord.begin({ targetUrl: "ws://target", expectInstanceId: "instance-target" });
    acceptProvisional(target());

    // The target is connected and accepted — but has NOT committed, so it must
    // not receive session traffic yet. This is the window where a naive
    // implementation double-sends.
    coord.send({ type: "event", n: 1 });
    expect(origin.sent).toContainEqual({ type: "event", n: 1 });
    expect(target().sent).not.toContainEqual({ type: "event", n: 1 });

    await move;
  });

  it("transfers send ownership to the target exactly at commit, with no frame sent twice", async () => {
    const { coord, origin, target } = setup();
    const move = coord.begin({ targetUrl: "ws://target", expectInstanceId: "instance-target" });
    acceptProvisional(target());
    coord.send({ n: "before" });
    const result = await move;
    expect(result.ok).toBe(true);

    coord.send({ n: "after" });

    expect(origin.sent).toContainEqual({ n: "before" });
    expect(origin.sent).not.toContainEqual({ n: "after" });
    expect(target().sent).toContainEqual({ n: "after" });
    expect(target().sent).not.toContainEqual({ n: "before" });
  });

  it("releases the origin only AFTER the commit is acknowledged", async () => {
    const { coord, origin, target } = setup();
    const move = coord.begin({ targetUrl: "ws://target", expectInstanceId: "instance-target" });
    acceptProvisional(target());
    // Still open: the origin is the live bridge until the handover completes.
    expect(origin.closed).toBe(false);
    await move;
    expect(origin.closed).toBe(true);
  });

  it("sends the commit frame carrying the token the target minted", async () => {
    const { coord, target } = setup();
    const move = coord.begin({ targetUrl: "ws://target", expectInstanceId: "instance-target" });
    acceptProvisional(target());
    await move;
    expect(target().sent).toContainEqual(
      expect.objectContaining({ type: "session_move_commit", sessionId: "sess-A", token: "tok-1" }),
    );
  });
});

describe("a failed move leaves the origin serving (#X7, task 9.3a-ii)", () => {
  it("aborts and keeps the origin when the target refuses the provisional", async () => {
    const { coord, origin, target } = setup();
    const move = coord.begin({ targetUrl: "ws://target", expectInstanceId: "instance-target" });
    target().connect();
    target().inbound?.({ type: "provisional_rejected" });

    const result = await move;
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.cause).toBe("refused");

    // The whole point: a refused move is a no-op, not an outage.
    expect(origin.closed).toBe(false);
    coord.send({ n: 1 });
    expect(origin.sent).toContainEqual({ n: 1 });
    expect(target().closed).toBe(true);
  });

  it("aborts when the target's instance id is not the one we verified", async () => {
    // Reaching the right ADDRESS is not reaching the right dashboard (D14):
    // an impostor at the expected address must not receive the session.
    const { coord, origin, target } = setup();
    const move = coord.begin({ targetUrl: "ws://target", expectInstanceId: "instance-target" });
    acceptProvisional(target(), "instance-IMPOSTOR");

    const result = await move;
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.cause).toBe("identity-mismatch");
    expect(origin.closed).toBe(false);
    expect(target().closed).toBe(true);
  });

  it("aborts on timeout, discarding the provisional exactly as on failure (9.3a-iii)", async () => {
    vi.useFakeTimers();
    try {
      const { coord, origin, target } = setup({ timeoutMs: 30_000 });
      const move = coord.begin({ targetUrl: "ws://target", expectInstanceId: "instance-target" });
      target().connect();
      // The target never answers.
      await vi.advanceTimersByTimeAsync(30_001);
      const result = await move;
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.cause).toBe("timeout");
      expect(origin.closed).toBe(false);
      expect(target().closed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is still sending on the origin after a failed move, not silently muted", async () => {
    // A coordinator that aborted but left ownership in limbo would look fine
    // and drop everything.
    const { coord, origin, target } = setup();
    const move = coord.begin({ targetUrl: "ws://target", expectInstanceId: "instance-target" });
    target().connect();
    target().inbound?.({ type: "provisional_rejected" });
    await move;

    coord.send({ n: "a" });
    coord.send({ n: "b" });
    expect(origin.sent).toContainEqual({ n: "a" });
    expect(origin.sent).toContainEqual({ n: "b" });
  });
});

describe("the coordinator refuses to start a move it cannot run safely", () => {
  it("refuses a second concurrent move", async () => {
    const { coord, target } = setup();
    const first = coord.begin({ targetUrl: "ws://t1", expectInstanceId: "instance-target" });
    const second = await coord.begin({ targetUrl: "ws://t2", expectInstanceId: "instance-target" });
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.cause).toBe("move-in-progress");
    acceptProvisional(target());
    await first;
  });

  it("reports the owner so a caller can never guess wrong", async () => {
    const { coord, target } = setup();
    expect(coord.owner()).toBe("origin");
    const move = coord.begin({ targetUrl: "ws://target", expectInstanceId: "instance-target" });
    acceptProvisional(target());
    await move;
    expect(coord.owner()).toBe("target");
  });
});

describe("the origin is told where the session went (task 9.3)", () => {
  it("sends session_moved on the ORIGIN before releasing it", async () => {
    const { coord, origin, target } = setup();
    const move = coord.begin({ targetUrl: "ws://target", expectInstanceId: "instance-target" });
    acceptProvisional(target());
    await move;

    expect(origin.sent).toContainEqual({
      type: "session_moved",
      sessionId: "sess-A",
      instanceId: "instance-target",
      endpoint: "ws://target",
    });
  });

  it("does not narrate a move that failed", async () => {
    // A `session_moved` after an abort would mark the session gone on the
    // dashboard that is still serving it.
    const { coord, origin, target } = setup();
    const move = coord.begin({ targetUrl: "ws://target", expectInstanceId: "instance-target" });
    target().connect();
    target().inbound?.({ type: "provisional_rejected" });
    await move;
    expect(origin.sent.some((m: any) => m?.type === "session_moved")).toBe(false);
  });
});

describe("a completed move pins the destination (task 9.2)", () => {
  it("pins nothing until a move actually completes", async () => {
    const { coord, target } = setup();
    expect(coord.pinnedEndpoint()).toBeUndefined();
    const move = coord.begin({ targetUrl: "ws://target", expectInstanceId: "instance-target" });
    // Mid-move: still nothing pinned, or an aborted move would leave the
    // session stuck to an instance that never took it.
    expect(coord.pinnedEndpoint()).toBeUndefined();
    acceptProvisional(target());
    await move;
    expect(coord.pinnedEndpoint()).toBe("ws://target");
  });

  it("pins nothing when the move fails", async () => {
    const { coord, target } = setup();
    const move = coord.begin({ targetUrl: "ws://target", expectInstanceId: "instance-target" });
    target().connect();
    target().inbound?.({ type: "provisional_rejected" });
    await move;
    expect(coord.pinnedEndpoint()).toBeUndefined();
  });

  it("feeds the EXISTING stickiness gate, so a reconnect returns to the moved-to instance", async () => {
    // The pin is only meaningful if it actually blocks a retarget. Asserted
    // through `decideRetarget` rather than re-implementing the rule here.
    const { coord, target } = setup();
    const move = coord.begin({ targetUrl: "ws://target", expectInstanceId: "instance-target" });
    acceptProvisional(target());
    await move;

    const decision = decideRetarget({
      current: { endpoint: coord.pinnedEndpoint() as string, instanceId: "instance-target" },
      candidate: { endpoint: "ws://origin", instanceId: "instance-origin" },
      pinned: coord.pinnedEndpoint() !== undefined,
      failed: true,
      identityVerified: true,
    });
    expect(decision.retarget).toBe(false);
    expect(decision.reason).toMatch(/pinned/);
  });
});

describe("ordering: the target registers BEFORE the origin closes (task 9.1)", () => {
  it("records target-connect strictly before origin-disconnect", async () => {
    // The invariant is an ORDERING, so it is asserted on a single interleaved
    // log. Two separate booleans could both end up true while the sequence in
    // between was still a gap with no live connection.
    const events: string[] = [];
    const origin = fakeConnection("ws://origin");
    origin.connect();
    const originDisconnect = origin.disconnect;
    origin.disconnect = () => {
      events.push("origin-disconnect");
      originDisconnect();
    };

    let target!: ReturnType<typeof fakeConnection>;
    const coord = createMoveCoordinator({
      origin,
      sessionId: "sess-A",
      connect: (url) => {
        target = fakeConnection(url);
        const targetConnect = target.connect;
        target.connect = () => {
          events.push("target-connect");
          targetConnect();
        };
        const targetSend = target.send;
        target.send = (m: any) => {
          if (m?.type === "session_move_commit") events.push("commit");
          targetSend(m);
        };
        return target;
      },
    });

    const move = coord.begin({ targetUrl: "ws://target", expectInstanceId: "instance-target" });
    // Fed directly: the coordinator already connected the target, so the
    // helper's own connect() would just duplicate the event.
    target.inbound?.({
      type: "provisional_accepted",
      sessionId: "sess-A",
      instanceId: "instance-target",
      token: "tok-1",
    });
    await move;

    expect(events).toEqual(["target-connect", "commit", "origin-disconnect"]);
  });
});

describe("warning when the transcript cannot follow the move (task 9.8)", () => {
  it("says nothing when the target is on this host", () => {
    expect(assessTranscriptFollow({ targetUrl: "ws+unix:///tmp/gw.sock:/", sessionFile: "/s.jsonl" }))
      .toEqual({ follows: true });
    expect(assessTranscriptFollow({ targetUrl: "ws://127.0.0.1:8000", sessionFile: "/s.jsonl" }))
      .toEqual({ follows: true });
  });

  it("warns that history and resume stay behind on a remote target", () => {
    const v = assessTranscriptFollow({ targetUrl: "ws://203.0.113.9:8000", sessionFile: "/s.jsonl" });
    expect(v.follows).toBe(false);
    expect(v.warning).toMatch(/history and resume will not follow/);
  });

  it("warns when there is no transcript at all", () => {
    const v = assessTranscriptFollow({ targetUrl: "ws://127.0.0.1:8000" });
    expect(v.follows).toBe(false);
    expect(v.warning).toMatch(/no transcript file/);
  });

  it("warns before the move rather than after, and does not block it", async () => {
    const warnings: string[] = [];
    const origin = fakeConnection("ws://origin");
    origin.connect();
    let target!: ReturnType<typeof fakeConnection>;
    const coord = createMoveCoordinator({
      origin,
      sessionId: "sess-A",
      sessionFile: "/s.jsonl",
      warn: (l) => warnings.push(l),
      connect: (url) => {
        target = fakeConnection(url);
        return target;
      },
    });

    const move = coord.begin({
      targetUrl: "ws://203.0.113.9:8000",
      expectInstanceId: "instance-target",
    });
    // Already warned, before any outcome is known.
    expect(warnings.join("\n")).toMatch(/history and resume will not follow/);

    target.inbound?.({
      type: "provisional_accepted",
      sessionId: "sess-A",
      instanceId: "instance-target",
      token: "t",
    });
    // ...and the move still completes: this is advice, not a veto.
    expect((await move).ok).toBe(true);
  });
});

describe("a completed move is logged with origin, destination and initiator (task 10.4)", () => {
  it("names all three on the completion line", async () => {
    const logs: string[] = [];
    const origin = fakeConnection("ws://origin");
    origin.connect();
    let target!: ReturnType<typeof fakeConnection>;
    const coord = createMoveCoordinator({
      origin,
      sessionId: "sess-A",
      originEndpoint: "ws://origin",
      log: (l) => logs.push(l),
      connect: (url) => {
        target = fakeConnection(url);
        return target;
      },
    });

    const move = coord.begin({
      targetUrl: "ws://target",
      expectInstanceId: "instance-target",
      initiator: "/dashboard-connect",
    });
    target.inbound?.({
      type: "provisional_accepted",
      sessionId: "sess-A",
      instanceId: "instance-target",
      token: "t",
    });
    await move;

    const line = logs.find((l) => l.includes("move completed")) ?? "";
    expect(line).toMatch(/origin=ws:\/\/origin/);
    expect(line).toMatch(/destination=ws:\/\/target/);
    expect(line).toMatch(/initiator=\/dashboard-connect/);
    expect(line).toMatch(/session=sess-A/);
  });

  it("names origin and destination on an abort too", async () => {
    const logs: string[] = [];
    const origin = fakeConnection("ws://origin");
    origin.connect();
    let target!: ReturnType<typeof fakeConnection>;
    const coord = createMoveCoordinator({
      origin,
      sessionId: "sess-A",
      originEndpoint: "ws://origin",
      log: (l) => logs.push(l),
      connect: (url) => {
        target = fakeConnection(url);
        return target;
      },
    });
    const move = coord.begin({ targetUrl: "ws://target", expectInstanceId: "instance-target" });
    target.inbound?.({ type: "provisional_rejected" });
    await move;

    const line = logs.find((l) => l.includes("move aborted")) ?? "";
    expect(line).toMatch(/origin=ws:\/\/origin/);
    expect(line).toMatch(/destination=ws:\/\/target/);
    expect(line).toMatch(/cause=refused/);
  });
});
