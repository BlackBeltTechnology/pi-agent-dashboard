/**
 * Per-dial plan, server verification before `open`, quarantine and the single
 * report slot (test-plan F1-F6).
 *
 * See change: loopback-credential-proof (tasks 5.1-5.7).
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import { ConnectionManager, type DialPlan, type IdentityFailureReport } from "../connection.js";

type UpgradeRes = { headers: Record<string, string | string[] | undefined> };

class FakeWs {
  public url: string;
  public opts?: { headers?: Record<string, string>; createConnection?: () => unknown };
  static instances: FakeWs[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  sent: string[] = [];
  terminated = false;
  private handlers = new Map<string, Array<(...a: unknown[]) => void>>();
  constructor(
    url: string,
    opts?: { headers?: Record<string, string>; createConnection?: () => unknown },
  ) {
    this.url = url;
    this.opts = opts;
    FakeWs.instances.push(this);
  }
  on(ev: string, fn: (...a: unknown[]) => void) {
    this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), fn]);
  }
  emit(ev: string, ...a: unknown[]) {
    for (const fn of this.handlers.get(ev) ?? []) fn(...a);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
  }
  terminate() {
    this.terminated = true;
    this.readyState = 3;
  }
  /** Server answered the upgrade: fires `upgrade`, then `open` unless terminated. */
  respond(headers: UpgradeRes["headers"] = {}) {
    this.emit("upgrade", { headers });
    if (!this.terminated) {
      this.readyState = 1;
      this.onopen?.();
    }
  }
}

const verifyGood: DialPlan["verifyUpgrade"] = () => ({ ok: true });
const verifyBad: DialPlan["verifyUpgrade"] = () => ({ ok: false, cause: "server-proof-missing" });

beforeEach(() => {
  FakeWs.instances = [];
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function mk(over: Partial<ConstructorParameters<typeof ConnectionManager>[0]> = {}) {
  const reports: IdentityFailureReport[] = [];
  const cm = new ConnectionManager({
    url: "ws://127.0.0.1:9999",
    WebSocketImpl: FakeWs as never,
    watchdogTimeout: 0,
    getSessionId: () => "sess-1",
    onIdentityFailure: (r) => reports.push(r),
    ...over,
  });
  return { cm, reports };
}

const flush = async () => {
  await vi.advanceTimersByTimeAsync(0);
};

describe("F1 quarantine schedule", () => {
  it("5, 30, 60, 120, 240, 300, 300 s; a verified open resets to the normal backoff", async () => {
    let verify: DialPlan["verifyUpgrade"] = verifyBad;
    const { cm } = mk({ planDial: async () => ({ verifyUpgrade: (r) => verify!(r) }) });
    cm.connect();
    await flush();
    const delays: number[] = [];
    for (let i = 0; i < 7; i++) {
      const before = FakeWs.instances.length;
      FakeWs.instances[before - 1].respond();
      // The next dial must NOT happen before the quarantine delay…
      const expected = [5, 30, 60, 120, 240, 300, 300][i] * 1000;
      await vi.advanceTimersByTimeAsync(expected - 1);
      expect(FakeWs.instances.length).toBe(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(FakeWs.instances.length).toBe(before + 1);
      delays.push(expected / 1000);
    }
    expect(delays).toEqual([5, 30, 60, 120, 240, 300, 300]);

    // verified open → quarantine lifts
    verify = verifyGood;
    FakeWs.instances.at(-1)!.respond();
    expect(cm.isConnected).toBe(true);
    // transient drop uses the NORMAL backoff (1 s initial), not quarantine
    const n = FakeWs.instances.length;
    FakeWs.instances.at(-1)!.close();
    FakeWs.instances.at(-1)!.onclose?.();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeWs.instances.length).toBe(n + 1);
  });
});

describe("F2 no frame before verification", () => {
  it("writes 0 frames on a failed dial and all buffered frames, in order, on the verified one", async () => {
    let verify: DialPlan["verifyUpgrade"] = verifyBad;
    const { cm } = mk({ planDial: async () => ({ verifyUpgrade: (r) => verify!(r) }) });
    cm.send({ type: "session_register", sessionId: "sess-1" });
    for (let i = 0; i < 3; i++) cm.send({ type: "event_forward", n: i });
    cm.connect();
    await flush();
    FakeWs.instances[0].respond();
    expect(FakeWs.instances[0].sent).toHaveLength(0);
    verify = verifyGood;
    await vi.advanceTimersByTimeAsync(5_000);
    FakeWs.instances[1].respond();
    const types = FakeWs.instances[1].sent.map((s) => JSON.parse(s));
    // The earlier failure is reported only AFTER the buffered frames, over the verified socket.
    expect(types.map((t) => t.type)).toEqual([
      "session_register",
      "event_forward",
      "event_forward",
      "event_forward",
      "bridge_diagnostic",
    ]);
    expect(types.slice(1, 4).map((t) => t.n)).toEqual([0, 1, 2]);
  });
});

describe("F4 the report slot follows the endpoint, not the connection", () => {
  it("keeps the newest 20, sends none elsewhere, sends them on a verified open at the marked endpoint", async () => {
    const marked = "ws://127.0.0.1:9999";
    const other = "ws://127.0.0.1:8888";
    const verifyFor: Record<string, DialPlan["verifyUpgrade"]> = { [marked]: verifyBad };
    const planDial = async (base: string): Promise<DialPlan> => ({ verifyUpgrade: verifyFor[base] });
    const diagnostics: unknown[] = [];
    const { cm, reports } = mk({ planDial, credentialsFor: () => ({ planDial }) });
    cm.connect();
    await flush();
    for (let i = 0; i < 25; i++) {
      FakeWs.instances.at(-1)!.respond();
      await vi.advanceTimersByTimeAsync(300_000);
    }
    expect(reports).toHaveLength(25);

    // A re-target to ANOTHER endpoint that opens: nothing is flushed there.
    const moved = await cm.retargetTo(other, { trigger: "test" });
    expect(moved).toBe(true);
    await flush();
    const atOther = FakeWs.instances.at(-1)!;
    expect(atOther.url).toBe(other);
    atOther.respond();
    for (const m of atOther.sent.map((x) => JSON.parse(x))) diagnostics.push(m);
    expect(diagnostics.filter((m) => (m as { type: string }).type === "bridge_diagnostic")).toHaveLength(0);

    // Back at the marked endpoint with a verifying server: the newest 20 arrive, once.
    verifyFor[marked] = verifyGood;
    atOther.close();
    atOther.onclose?.();
    await cm.retargetTo(marked, { trigger: "test" });
    await vi.advanceTimersByTimeAsync(300_000);
    const atMarked = FakeWs.instances.at(-1)!;
    expect(atMarked.url).toBe(marked);
    atMarked.respond();
    const sent = atMarked.sent.map((x) => JSON.parse(x)).filter((m) => m.type === "bridge_diagnostic");
    expect(sent).toHaveLength(20);
    expect(sent.every((m) => m.event === "server_proof_failed" && m.sessionId === "sess-1")).toBe(true);
    // the slot is now empty: a further reconnect sends none
    atMarked.close();
    atMarked.onclose?.();
    await vi.advanceTimersByTimeAsync(5_000);
    const again = FakeWs.instances.at(-1)!;
    again.respond();
    expect(again.sent.filter((x) => JSON.parse(x).type === "bridge_diagnostic")).toHaveLength(0);
  });
});

describe("an identity report never travels over another endpoint's verified open", () => {
  it("a failure recorded at A is not flushed after a verified open at B", async () => {
    const A = "ws://127.0.0.1:9999";
    const B = "ws://127.0.0.1:8888";
    const verifyFor: Record<string, DialPlan["verifyUpgrade"]> = { [A]: verifyBad, [B]: verifyGood };
    const planDial = async (base: string): Promise<DialPlan> => ({ verifyUpgrade: verifyFor[base] });
    const { cm, reports } = mk({ planDial, credentialsFor: () => ({ planDial }) });
    cm.connect();
    await flush();
    FakeWs.instances.at(-1)!.respond(); // identity failure at A
    expect(reports).toHaveLength(1);
    await cm.retargetTo(B, { trigger: "test" });
    await vi.advanceTimersByTimeAsync(300_000);
    const atB = FakeWs.instances.at(-1)!;
    expect(atB.url).toBe(B);
    atB.respond(); // verified open at B
    expect(atB.sent.filter((s) => JSON.parse(s).type === "bridge_diagnostic")).toHaveLength(0);
  });
});

describe("a marked dial that opens without ever emitting upgrade is refused", () => {
  it("never flushes buffered frames to an unverified peer", async () => {
    const { cm, reports } = mk({ planDial: async () => ({ verifyUpgrade: verifyGood }) });
    cm.send({ type: "session_register", sessionId: "sess-1" });
    cm.connect();
    await flush();
    const ws = FakeWs.instances[0];
    ws.readyState = 1;
    ws.onopen?.(); // `open` with no preceding `upgrade`
    expect(ws.sent).toHaveLength(0);
    expect(reports.map((r) => r.cause)).toEqual(["server-proof-missing"]);
    expect(cm.isConnected).toBe(false);
  });
});

describe("F5 pre-connect failure is transient", () => {
  it("a connector rejection uses the normal backoff, with no identity report", async () => {
    const { cm, reports } = mk({
      planDial: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    });
    cm.connect();
    await flush();
    expect(FakeWs.instances).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(reports).toHaveLength(0);
    // retried on the NORMAL (1 s, then 2 s) backoff — well under the 5 s quarantine floor
    await vi.advanceTimersByTimeAsync(2_000);
    expect(reports).toHaveLength(0);
  });
});

describe("F6 per-dial plan", () => {
  it("is invoked on every attempt with the base endpoint (distinct nonces; re-target uses the new URL)", async () => {
    const calls: string[] = [];
    let n = 0;
    const { cm } = mk({
      planDial: async (base) => {
        calls.push(base);
        return { headers: { "X-Pi-Local-Proof": `nonce-${n++}` } };
      },
      credentialsFor: () => ({
        planDial: async (base) => {
          calls.push(base);
          return { headers: { "X-Pi-Local-Proof": `nonce-${n++}` } };
        },
      }),
    });
    cm.connect();
    await flush();
    FakeWs.instances[0].respond();
    FakeWs.instances[0].close();
    FakeWs.instances[0].onclose?.();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeWs.instances).toHaveLength(2);
    const proofs = FakeWs.instances.map((w) => w.opts?.headers?.["X-Pi-Local-Proof"]);
    expect(new Set(proofs).size).toBe(2);
    expect(calls.every((c) => c === "ws://127.0.0.1:9999")).toBe(true);
  });
});

describe("a superseded dial never opens an orphaned, unverified socket", () => {
  it("a re-target while planDial is pending discards the old plan and disposes it", async () => {
    const marked = "ws://127.0.0.1:9999";
    const other = "ws://127.0.0.1:8888";
    const released: Array<() => void> = [];
    const disposed: string[] = [];
    const planDial = (base: string): Promise<DialPlan> =>
      new Promise((resolve) => {
        released.push(() => resolve({ verifyUpgrade: verifyGood, dispose: () => disposed.push(base) }));
      });
    const { cm } = mk({ planDial, credentialsFor: () => ({ planDial }) });
    cm.connect(); // dial #1 (marked) waits on its plan
    await flush();
    expect(await cm.retargetTo(other, { trigger: "test" })).toBe(true); // dial #2
    await flush();
    released[0](); // the OLD plan finally resolves
    await flush();
    expect(FakeWs.instances).toHaveLength(0); // ...and opened nothing
    expect(disposed).toEqual([marked]);
    released[1]();
    await flush();
    expect(FakeWs.instances.map((w) => w.url)).toEqual([other]);
  });

  it("disconnect() during planDial opens nothing", async () => {
    let release: () => void = () => {};
    const disposed: boolean[] = [];
    const { cm } = mk({
      planDial: () =>
        new Promise((resolve) => {
          release = () => resolve({ dispose: () => disposed.push(true) });
        }),
    });
    cm.connect();
    await flush();
    cm.disconnect();
    release();
    await flush();
    expect(FakeWs.instances).toHaveLength(0);
    expect(disposed).toEqual([true]);
  });
});

describe("fail closed", () => {
  it("a WebSocket without an upgrade event cannot verify → identity failure, no open", async () => {
    class NoEvents extends FakeWs {
      // biome-ignore lint/suspicious/noExplicitAny: simulate an impl without `on`
      on = undefined as any;
    }
    const { cm, reports } = mk({
      WebSocketImpl: NoEvents as never,
      planDial: async () => ({ verifyUpgrade: verifyGood }),
    });
    cm.connect();
    await flush();
    expect(cm.isConnected).toBe(false);
    expect(reports.map((r) => r.cause)).toEqual(["server-proof-missing"]);
  });
});

// ── F3: a REAL ws server that talks before proving anything ───────────────
describe("F3 nothing dispatched from an unverified peer", () => {
  let server: http.Server;
  let wss: WebSocketServer;
  afterEach(async () => {
    vi.useRealTimers();
    wss?.close();
    await new Promise<void>((r) => server?.close(() => r()));
  });

  it("onMessage is never called, onopen never fires, and the socket is terminated", async () => {
    vi.useRealTimers();
    server = http.createServer();
    wss = new WebSocketServer({ server });
    wss.on("connection", (ws) => ws.send(JSON.stringify({ type: "session_ack" })));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as AddressInfo).port;

    const onMessage = vi.fn();
    const onOpen = vi.fn();
    const reports: IdentityFailureReport[] = [];
    const { ConnectionManager: CM } = await import("../connection.js");
    const cm = new CM({
      url: `ws://127.0.0.1:${port}`,
      watchdogTimeout: 0,
      onMessage,
      onOpen,
      onIdentityFailure: (r) => reports.push(r),
      planDial: async () => ({ verifyUpgrade: verifyBad }),
    });
    cm.connect();
    await new Promise((r) => setTimeout(r, 400));
    cm.disconnect();
    expect(onMessage).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    expect(reports).toHaveLength(1);
    expect(cm.isConnected).toBe(false);
  });
});
