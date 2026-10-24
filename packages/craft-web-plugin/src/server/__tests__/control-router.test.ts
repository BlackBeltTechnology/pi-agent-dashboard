/**
 * Control router (add-craft-live-control D1, D2, D7): choice, reason precedence, claim window, rate limit,
 * pinned routing, forged / late / lost results, kill switch, shape and size re-check.
 * Test-plan #E3 #E4 #E5 #E7 #E16 #E19 #X1 #X2 #X3 #X4.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTROL_PROBE, CONTROL_RUN, ERROR_MAX_BYTES, REPLY_MAX_BYTES } from "../../shared/control-protocol.js";
import { type ControlRouterReply, createControlRouter } from "../control-router.js";

type Sent = Record<string, any>;

function rig(o: { enabled?: () => boolean; real?: (p: string) => string | undefined } = {}) {
  const sent: Sent[] = [];
  let n = 0;
  const telemetry = vi.fn();
  const warn = vi.fn();
  const router = createControlRouter({
    broadcast: (m) => sent.push(m as Sent),
    sessionCwd: (id) => (id === "none" ? undefined : "/tmp/w"),
    liveControlEnabled: o.enabled ?? (() => true),
    realpath: o.real ?? (() => undefined),
    caseInsensitive: true,
    newId: () => `id${++n}`,
    appForPath: () => "vectorcraft",
    telemetry,
    log: { info: vi.fn(), warn },
  });
  const probes = () => sent.filter((m) => m.type === CONTROL_PROBE);
  const runs = () => sent.filter((m) => m.type === CONTROL_RUN);
  const claim = (ws: unknown, status: string, msSinceFocus: number, instanceId = `inst-${String(ws)}`, reqId = probes().at(-1)?.reqId) =>
    router.onClaim({ reqId, instanceId, status, msSinceFocus }, ws);
  return { router, sent, probes, runs, claim, telemetry, warn };
}

const go = (r: ReturnType<typeof rig>, extra: Record<string, unknown> = {}, sessionId = "S") =>
  r.router.request({ path: "/tmp/w/a.svg", method: "engine.execute", params: { command: "x" }, ...extra }, { sessionId });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("E3 choice among eligible claims", () => {
  async function pick(a: number, b: number, gapMs = 0): Promise<ControlRouterReply | { run: string }> {
    const r = rig();
    const p = go(r);
    r.claim("A", "eligible", a);
    if (gapMs) await vi.advanceTimersByTimeAsync(gapMs);
    r.claim("B", "eligible", b);
    await vi.advanceTimersByTimeAsync(400);
    if (r.runs().length === 0) return p;
    const run = r.runs()[0];
    r.router.onResult({ reqId: run.reqId, instanceId: run.instanceId, ok: true, result: 1 }, run.instanceId === "inst-A" ? "A" : "B");
    await p;
    return { run: run.instanceId };
  }

  it("the most recently focused wins when focused within 10 minutes", async () => {
    expect(await pick(60_000, 3_600_000)).toEqual({ run: "inst-A" });
    expect(await pick(3_600_000, 60_000)).toEqual({ run: "inst-B" });
    expect(await pick(599_999, 600_001)).toEqual({ run: "inst-A" });
  });

  it("both older than 10 minutes → ambiguous, no run is broadcast", async () => {
    const r = await pick(600_001, 700_000);
    expect(r).toMatchObject({ ok: false, code: "ambiguous" });
  });

  it("a tie goes to the earlier claim", async () => {
    expect(await pick(5_000, 5_000, 20)).toEqual({ run: "inst-A" });
  });

  it("a single eligible claim runs whatever its age", async () => {
    const r = rig();
    const p = go(r);
    r.claim("A", "eligible", 99_999_999);
    await vi.advanceTimersByTimeAsync(400);
    expect(r.runs()).toHaveLength(1);
    r.router.onResult({ reqId: r.runs()[0].reqId, instanceId: "inst-A", ok: true, result: { v: 1 } }, "A");
    expect(await p).toMatchObject({ ok: true, instance: "inst-A", result: { v: 1 } });
  });
});

describe("E4 reason precedence when nothing is eligible", () => {
  async function reasonOf(statuses: string[]) {
    const r = rig();
    const p = go(r);
    statuses.forEach((s, i) => r.claim(`w${i}`, s, 0, `i${i}`));
    await vi.advanceTimersByTimeAsync(2100);
    return p;
  }
  it.each([
    [["not-ready"], "not-ready"],
    [["unsupported", "not-visible"], "not-visible"],
    [["unsupported", "not-ready"], "not-ready"],
    [["unsupported"], "unsupported"],
    [["wrong-session"], "not-open"],
    [[], "not-open"],
  ])("%j → %s", async (statuses, code) => {
    expect(await reasonOf(statuses)).toMatchObject({ ok: false, code });
  });

  it("not-open names the full-operating-rights requirement", async () => {
    const r = await reasonOf([]);
    expect(r.ok === false && r.message).toMatch(/full operating rights/);
  });
});

describe("E5 claim window", () => {
  it("closes 300 ms after the first eligible claim: 399 ms counts, 401 ms does not", async () => {
    const r = rig();
    const p = go(r);
    await vi.advanceTimersByTimeAsync(100);
    r.claim("A", "eligible", 10_000);
    await vi.advanceTimersByTimeAsync(299); // t = 399
    r.claim("B", "eligible", 1_000);
    await vi.advanceTimersByTimeAsync(2); // t = 401: closed
    r.claim("C", "eligible", 1);
    expect(r.runs()).toHaveLength(1);
    expect(r.runs()[0].instanceId).toBe("inst-B");
    r.router.onResult({ reqId: r.runs()[0].reqId, instanceId: "inst-B", ok: true, result: 1 }, "B");
    await p;
  });

  it("with no eligible claim the router answers at 2000 ms", async () => {
    const r = rig();
    let settled = false;
    const p = go(r).then((x) => {
      settled = true;
      return x;
    });
    await vi.advanceTimersByTimeAsync(1990);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    expect(settled).toBe(true);
    expect(await p).toMatchObject({ ok: false, code: "not-open" });
  });
});

describe("path forms in the probe", () => {
  it("sends lexical, real and relative forms plus the case flag", async () => {
    const r = rig({ real: (p) => (p === "/tmp/w/a.svg" ? "/private/tmp/w/a.svg" : undefined) });
    void go(r, { path: "sub/../a.svg" });
    expect(r.probes()[0]).toMatchObject({ sessionId: "S", path: "/tmp/w/a.svg", realPath: "/private/tmp/w/a.svg", relPath: "a.svg", caseInsensitive: true });
    await vi.advanceTimersByTimeAsync(2100);
  });

  it("a path outside the cwd has no relative form; a session with no cwd is not-open", async () => {
    const r = rig();
    void go(r, { path: "/etc/x.svg" });
    expect(r.probes()[0].relPath).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2100);
    expect(await go(rig(), {}, "none")).toMatchObject({ ok: false, code: "not-open" });
  });
});

describe("E7 rate limit", () => {
  it("the 21st routed request within 10 s is rate_limited; a pinned host.state is served", async () => {
    const r = rig();
    // instance known from a first claim
    const first = go(r);
    r.claim("A", "eligible", 1);
    await vi.advanceTimersByTimeAsync(400);
    r.router.onResult({ reqId: r.runs()[0].reqId, instanceId: "inst-A", ok: true, result: 1 }, "A");
    await first;
    for (let i = 0; i < 19; i++) void go(r);
    expect(await go(r)).toMatchObject({ ok: false, code: "rate_limited" });
    const st = r.router.request({ method: "host.state", instance: "inst-A" }, { sessionId: "S" });
    const run = r.runs().at(-1) as Sent;
    expect(run).toMatchObject({ method: "host.state", instanceId: "inst-A" });
    r.router.onResult({ reqId: run.reqId, instanceId: "inst-A", ok: true, result: { unsaved: false } }, "A");
    expect(await st).toMatchObject({ ok: true });
    await vi.advanceTimersByTimeAsync(2100);
  });

  it("the window slides: after 10 s a request is admitted again", async () => {
    const r = rig();
    for (let i = 0; i < 20; i++) void go(r);
    await vi.advanceTimersByTimeAsync(10_001);
    void go(r);
    expect(r.probes().length).toBe(21);
    await vi.advanceTimersByTimeAsync(2100);
  });
});

describe("E16 pinned follow-ups", () => {
  async function opened() {
    const r = rig();
    const p = go(r);
    r.claim("A", "eligible", 1);
    await vi.advanceTimersByTimeAsync(400);
    r.router.onResult({ reqId: r.runs()[0].reqId, instanceId: "inst-A", ok: true, result: 1 }, "A");
    await p;
    return r;
  }

  it("an instance handle skips the probe and runs on the owner only", async () => {
    const r = await opened();
    const before = r.probes().length;
    const p = r.router.request({ method: "engine.execute", params: { command: "y" }, instance: "inst-A" }, { sessionId: "S" });
    expect(r.probes()).toHaveLength(before);
    expect(r.runs().at(-1)).toMatchObject({ instanceId: "inst-A", sessionId: "S", method: "engine.execute" });
    r.router.onResult({ reqId: r.runs().at(-1)?.reqId, instanceId: "inst-A", ok: true, result: 2 }, "A");
    expect(await p).toMatchObject({ ok: true, result: 2 });
  });

  it("an unknown handle, one of another session, or one reported gone → not-open", async () => {
    const r = await opened();
    expect(await r.router.request({ method: "host.state", instance: "nope" }, { sessionId: "S" })).toMatchObject({ ok: false, code: "not-open" });
    expect(await r.router.request({ method: "host.state", instance: "inst-A" }, { sessionId: "OTHER" })).toMatchObject({ ok: false, code: "not-open" });
    r.router.onGone({ instanceId: "inst-A" }, "intruder"); // only the owner socket may retire it
    const still = r.router.request({ method: "host.state", instance: "inst-A" }, { sessionId: "S" });
    expect(r.runs().at(-1)).toMatchObject({ instanceId: "inst-A" });
    r.router.onGone({ instanceId: "inst-A" }, "A");
    r.router.onResult({ reqId: r.runs().at(-1)?.reqId, instanceId: "inst-A", ok: true, result: {} }, "A");
    await still;
    expect(await r.router.request({ method: "host.state", instance: "inst-A" }, { sessionId: "S" })).toMatchObject({ ok: false, code: "not-open" });
  });

  it("the client's not-visible / not-open answers pass through", async () => {
    const r = await opened();
    const p = r.router.request({ method: "engine.execute", params: { command: "y" }, instance: "inst-A" }, { sessionId: "S" });
    r.router.onResult({ reqId: r.runs().at(-1)?.reqId, instanceId: "inst-A", ok: false, code: "not-visible", error: "tab hidden" }, "A");
    expect(await p).toMatchObject({ ok: false, code: "not-visible", message: "tab hidden" });
  });
});

describe("X1 / X2 forged and late results", () => {
  it("X1 a result from a second socket with the right ids is dropped and logged; the claiming socket's result wins", async () => {
    const r = rig();
    const p = go(r);
    r.claim("A", "eligible", 1);
    await vi.advanceTimersByTimeAsync(400);
    const run = r.runs()[0];
    r.router.onResult({ reqId: run.reqId, instanceId: run.instanceId, ok: true, result: "forged" }, "EVIL");
    expect(r.warn).toHaveBeenCalledTimes(1);
    r.router.onResult({ reqId: run.reqId, instanceId: run.instanceId, ok: true, result: "real" }, "A");
    expect(await p).toMatchObject({ ok: true, result: "real" });
    // once only
    r.router.onResult({ reqId: run.reqId, instanceId: run.instanceId, ok: true, result: "again" }, "A");
    expect(r.warn).toHaveBeenCalledTimes(2);
  });

  it("X1 a result naming another instance is dropped", async () => {
    const r = rig();
    const p = go(r);
    r.claim("A", "eligible", 1);
    await vi.advanceTimersByTimeAsync(400);
    r.router.onResult({ reqId: r.runs()[0].reqId, instanceId: "inst-other", ok: true, result: 1 }, "A");
    expect(r.warn).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(13_100);
    expect(await p).toMatchObject({ ok: false, code: "timeout" });
  });

  it("X2 a result after the 13 s TTL is dropped; the tool already returned timeout (outcome unknown)", async () => {
    const r = rig();
    const p = go(r);
    r.claim("A", "eligible", 1);
    await vi.advanceTimersByTimeAsync(400);
    const run = r.runs()[0];
    await vi.advanceTimersByTimeAsync(13_001);
    const res = await p;
    expect(res).toMatchObject({ ok: false, code: "timeout", message: expect.stringMatching(/outcome unknown/) });
    r.router.onResult({ reqId: run.reqId, instanceId: run.instanceId, ok: true, result: 1 }, "A");
    expect(r.warn).toHaveBeenCalled();
  });
});

describe("X3 / X4 socket loss", () => {
  it("X3 the claiming socket closing after the run broadcast → timeout, never not-open", async () => {
    const r = rig();
    const p = go(r);
    r.claim("A", "eligible", 1);
    await vi.advanceTimersByTimeAsync(400);
    // the socket is gone: no result ever arrives
    await vi.advanceTimersByTimeAsync(13_001);
    expect(await p).toMatchObject({ ok: false, code: "timeout" });
  });

  it("X4 the only claiming socket closing during the window → not-open (its claim no longer counts)", async () => {
    const r = rig();
    const ws = { readyState: 1 };
    const p = go(r);
    r.claim(ws, "eligible", 1, "inst-ws");
    ws.readyState = 3; // CLOSED before the window ends
    await vi.advanceTimersByTimeAsync(400);
    expect(r.runs()).toHaveLength(0);
    expect(await p).toMatchObject({ ok: false, code: "not-open" });
  });

  it("X4 a closed socket does not hide another eligible claim", async () => {
    const r = rig();
    const dead = { readyState: 3 };
    const p = go(r);
    r.claim(dead, "eligible", 1, "inst-dead");
    r.claim("B", "eligible", 50_000, "inst-B");
    await vi.advanceTimersByTimeAsync(400);
    expect(r.runs()[0].instanceId).toBe("inst-B");
    r.router.onResult({ reqId: r.runs()[0].reqId, instanceId: "inst-B", ok: true, result: 1 }, "B");
    await p;
  });
});

describe("E19 kill switch", () => {
  it("liveControl=false → disabled, no probe, read live", async () => {
    let on = false;
    const r = rig({ enabled: () => on });
    expect(await go(r)).toMatchObject({ ok: false, code: "disabled" });
    expect(r.probes()).toHaveLength(0);
    on = true;
    void go(r);
    expect(r.probes()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2100);
  });
});

describe("server-side shape and size re-check (D4)", () => {
  async function answer(msg: Record<string, unknown>): Promise<ControlRouterReply> {
    const r = rig();
    const p = go(r);
    r.claim("A", "eligible", 1);
    await vi.advanceTimersByTimeAsync(400);
    const run = r.runs()[0];
    r.router.onResult({ reqId: run.reqId, instanceId: run.instanceId, ...msg }, "A");
    return p;
  }

  it("ok must be boolean", async () => {
    expect(await answer({ ok: "yes", result: 1 })).toMatchObject({ ok: false, code: "app_error" });
  });

  it("result over 192 KiB → reply_too_large; at the cap it passes", async () => {
    const wrap = (n: number) => "x".repeat(n - 2); // JSON adds the two quotes
    expect(await answer({ ok: true, result: wrap(REPLY_MAX_BYTES) })).toMatchObject({ ok: true });
    expect(await answer({ ok: true, result: wrap(REPLY_MAX_BYTES + 1) })).toMatchObject({ ok: false, code: "reply_too_large" });
  });

  it("error text over 2 KiB is truncated to 2 KiB and kept an app_error; unknown codes become app_error", async () => {
    const a = await answer({ ok: false, error: "e".repeat(ERROR_MAX_BYTES + 1) });
    expect(a).toMatchObject({ ok: false, code: "app_error" });
    expect(a.ok === false && Buffer.byteLength(a.message)).toBe(ERROR_MAX_BYTES);
    expect(await answer({ ok: false, code: "rate_limited", error: "x" })).toMatchObject({ code: "app_error" });
    expect(await answer({ ok: false, code: "busy", error: "x" })).toMatchObject({ code: "busy" });
  });

  it("carries saveRequested / saveSeq through to the reply", async () => {
    expect(await answer({ ok: true, result: null, saveRequested: true, saveSeq: 4 })).toMatchObject({ ok: true, saveRequested: true, saveSeq: 4 });
  });
});

describe("telemetry", () => {
  it("reports one outcome and duration per request", async () => {
    const r = rig();
    const p = go(r);
    r.claim("A", "eligible", 1);
    await vi.advanceTimersByTimeAsync(400);
    r.router.onResult({ reqId: r.runs()[0].reqId, instanceId: "inst-A", ok: true, result: 1 }, "A");
    await p;
    expect(r.telemetry).toHaveBeenCalledWith("vectorcraft", "ok", expect.any(Number));
    expect(await go(rig({ enabled: () => false }))).toMatchObject({ code: "disabled" });
  });
});
