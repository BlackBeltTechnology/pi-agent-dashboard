/**
 * Push dispatcher: hybrid cadence (devices on the unread edge, webhooks on
 * every trigger), per-(session, token) webhook coalescing, fire-and-forget.
 * Harness: pure unit style of `is-unread-trigger.test.ts`, stub transports.
 * See change: add-server-push-notifications
 * (test-plan #E9–#E14, #E26, #P2, #X1–#X4, #X16 pruning).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPushDispatcher, type FanoutContext } from "../push/push-dispatcher.js";
import { createPushTokenRegistry, type PushTokenRegistry } from "../push/push-token-registry.js";
import type { PushLogger, PushPayload, PushToken, PushTransport, PushTransportKind } from "../push/push-transports/types.js";

const flush = () => new Promise<void>((r) => setImmediate(r)).then(() => new Promise<void>((r) => setImmediate(r)));

const SUB = (n: number) =>
  JSON.stringify({ endpoint: `https://fcm.googleapis.com/fcm/send/SECRET${n}`, keys: { p256dh: "p", auth: "a" } });

function stubTransport(kind: PushTransportKind, impl?: (t: PushToken, p: PushPayload) => Promise<{ ok: boolean; gone?: boolean }>) {
  const sent: Array<{ token: PushToken; payload: PushPayload }> = [];
  const transport: PushTransport = {
    kind,
    send: vi.fn((token: PushToken, payload: PushPayload) => {
      sent.push({ token, payload });
      return impl ? impl(token, payload) : Promise.resolve({ ok: true });
    }),
  };
  return { transport, sent };
}

function captureLogger() {
  const lines: Array<{ level: string; msg: string; fields?: Record<string, unknown> }> = [];
  const logger: PushLogger = {
    info: (msg, fields) => lines.push({ level: "info", msg, fields }),
    warn: (msg, fields) => lines.push({ level: "warn", msg, fields }),
    error: (msg, fields) => lines.push({ level: "error", msg, fields }),
  };
  return { logger, lines };
}

const turnEnd = (unreadEdge: boolean): FanoutContext => ({
  eventType: "agent_end",
  after: { status: "idle", currentTool: null },
  payload: {},
  unreadEdge,
});

describe("push-dispatcher", () => {
  let tmpDir: string;
  let registry: PushTokenRegistry;
  let t: number;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "push-dispatcher-test-"));
    t = 0;
    registry = createPushTokenRegistry({ path: path.join(tmpDir, "push-tokens.json"), now: () => t });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function make(transports: Partial<Record<PushTransportKind, PushTransport>>, coalesceWindowMs = 30_000, logger?: PushLogger) {
    return createPushDispatcher({
      registry,
      transports,
      coalesceWindowMs,
      getSession: (id) => ({ id, name: "proj", cwd: "/tmp/proj", model: "m1" }) as any,
      logger: logger ?? captureLogger().logger,
      now: () => t,
    });
  }

  it("unreadEdge:false after the window → no device push, one webhook push (test-plan #E9)", async () => {
    const wp = stubTransport("web-push");
    const wh = stubTransport("webhook");
    registry.add({ deviceToken: SUB(1), transport: "web-push" });
    registry.add({ deviceToken: "http://192.168.1.20:8787/h", transport: "webhook" });
    const d = make({ "web-push": wp.transport, webhook: wh.transport });
    d.fanout("s", turnEnd(true));
    await flush();
    wp.sent.length = 0;
    wh.sent.length = 0;
    t = 31_000;
    d.fanout("s", turnEnd(false));
    await flush();
    expect(wp.sent).toHaveLength(0);
    expect(wh.sent).toHaveLength(1);
  });

  it("unreadEdge:true → each transport sends exactly once (test-plan #E10)", async () => {
    const wp = stubTransport("web-push");
    const fcm = stubTransport("fcm");
    const wh = stubTransport("webhook");
    registry.add({ deviceToken: SUB(1), transport: "web-push" });
    registry.add({ deviceToken: "fcm-token", transport: "fcm" });
    registry.add({ deviceToken: "http://192.168.1.20:8787/h", transport: "webhook" });
    const d = make({ "web-push": wp.transport, fcm: fcm.transport, webhook: wh.transport });
    d.fanout("s", turnEnd(true));
    await flush();
    expect(wp.sent).toHaveLength(1);
    expect(fcm.sent).toHaveLength(1);
    expect(wh.sent).toHaveLength(1);
    expect(wh.sent[0].payload).toMatchObject({ type: "session_attention", sessionId: "s", url: "/session/s" });
  });

  it("webhook coalescing boundary: t=0,10s,29 999,30 000,31 000 → sends at 0 and 30 000 (test-plan #E11)", async () => {
    const wh = stubTransport("webhook");
    registry.add({ deviceToken: "http://192.168.1.20:8787/h", transport: "webhook" });
    const d = make({ webhook: wh.transport }, 30_000);
    const sendTimes: number[] = [];
    (wh.transport.send as any).mockImplementation(() => {
      sendTimes.push(t);
      return Promise.resolve({ ok: true });
    });
    for (const at of [0, 10_000, 29_999, 30_000, 31_000]) {
      t = at;
      d.fanout("s", turnEnd(false));
      await flush();
    }
    expect(sendTimes).toEqual([0, 30_000]);
  });

  it("two sessions within 10 s → two webhook pushes (test-plan #E12)", async () => {
    const wh = stubTransport("webhook");
    registry.add({ deviceToken: "http://192.168.1.20:8787/h", transport: "webhook" });
    const d = make({ webhook: wh.transport });
    d.fanout("A", turnEnd(false));
    t = 5_000;
    d.fanout("B", turnEnd(false));
    await flush();
    expect(wh.sent.map((s) => s.payload.sessionId)).toEqual(["A", "B"]);
  });

  it("device tokens are not coalesced: a new edge 5 s later is delivered (test-plan #E13)", async () => {
    const wp = stubTransport("web-push");
    registry.add({ deviceToken: SUB(1), transport: "web-push" });
    const d = make({ "web-push": wp.transport });
    d.fanout("s", turnEnd(true));
    t = 5_000;
    d.fanout("s", turnEnd(true));
    await flush();
    expect(wp.sent).toHaveLength(2);
  });

  it("re-registering the same webhook keeps its window (test-plan #E14)", async () => {
    const wh = stubTransport("webhook");
    const first = registry.add({ deviceToken: "http://192.168.1.20:8787/h", transport: "webhook" });
    const d = make({ webhook: wh.transport });
    d.fanout("s", turnEnd(false));
    await flush();
    t = 1_000;
    const again = registry.add({ deviceToken: "http://192.168.1.20:8787/h", transport: "webhook" });
    expect(first.ok && again.ok && again.token.id === first.token.id).toBe(true);
    t = 2_000;
    d.fanout("s", turnEnd(false));
    await flush();
    expect(wh.sent).toHaveLength(1);
  });

  it("removing a token drops its coalescing entries", async () => {
    const wh = stubTransport("webhook");
    const r = registry.add({ deviceToken: "http://192.168.1.20:8787/h", transport: "webhook" });
    const d = make({ webhook: wh.transport });
    d.fanout("s", turnEnd(false));
    await flush();
    if (!r.ok) throw new Error("add");
    registry.remove(r.token.id);
    registry.add({ deviceToken: "http://192.168.1.20:8787/h", transport: "webhook" });
    t = 1_000;
    d.fanout("s", turnEnd(false));
    await flush();
    expect(wh.sent).toHaveLength(2);
  });

  it("sessionFilter [A]: session B → 0 sends, then A → 1 (test-plan #E26)", async () => {
    const wh = stubTransport("webhook");
    registry.add({ deviceToken: "http://192.168.1.20:8787/h", transport: "webhook", sessionFilter: ["A"] });
    const d = make({ webhook: wh.transport });
    d.fanout("B", turnEnd(true));
    await flush();
    expect(wh.sent).toHaveLength(0);
    d.fanout("A", turnEnd(true));
    await flush();
    expect(wh.sent).toHaveLength(1);
  });

  it("100 fanouts over 50 tokens do no synchronous fs read (test-plan #P2)", async () => {
    for (let i = 0; i < 50; i++) registry.add({ deviceToken: `http://192.168.1.${i}:8787/h`, transport: "webhook" });
    const wh = stubTransport("webhook");
    const d = make({ webhook: wh.transport }, 5_000);
    const readSpy = vi.spyOn(fs, "readFileSync");
    const existsSpy = vi.spyOn(fs, "existsSync");
    const statSpy = vi.spyOn(fs, "statSync");
    for (let i = 0; i < 100; i++) d.fanout(`s${i}`, turnEnd(i % 2 === 0));
    expect(readSpy).toHaveBeenCalledTimes(0);
    expect(existsSpy).toHaveBeenCalledTimes(0);
    expect(statSpy).toHaveBeenCalledTimes(0);
    await flush();
  });

  it("a synchronous throw in send is contained, logged with tokenId, others still sent (test-plan #X1)", async () => {
    const { logger, lines } = captureLogger();
    const bad = stubTransport("fcm", () => {
      throw new Error("sync boom");
    });
    const good = stubTransport("webhook");
    const r = registry.add({ deviceToken: "fcm-token", transport: "fcm" });
    registry.add({ deviceToken: "http://192.168.1.20:8787/h", transport: "webhook" });
    const d = make({ fcm: bad.transport, webhook: good.transport }, 30_000, logger);
    expect(() => d.fanout("s", turnEnd(true))).not.toThrow();
    await flush();
    expect(good.sent).toHaveLength(1);
    const err = lines.find((l) => l.level === "error" && r.ok && l.fields?.tokenId === r.token.id);
    expect(err).toBeDefined();
  });

  it("a rejected send produces no unhandledRejection and is logged (test-plan #X2)", async () => {
    const { logger, lines } = captureLogger();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const bad = stubTransport("webhook", () => Promise.reject(new Error("async boom")));
      registry.add({ deviceToken: "http://192.168.1.20:8787/h", transport: "webhook" });
      const d = make({ webhook: bad.transport }, 30_000, logger);
      d.fanout("s", turnEnd(true));
      await flush();
      await new Promise((r) => setTimeout(r, 10));
      expect(unhandled).toHaveBeenCalledTimes(0);
      expect(lines.some((l) => l.level === "error")).toBe(true);
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("an unknown persisted transport is skipped with a warning (test-plan #X4)", async () => {
    const file = path.join(tmpDir, "legacy.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        tokens: [
          { id: "pigeon", deviceToken: "coo", transport: "carrier-pigeon", registeredAt: 0, lastUsedAt: 0 },
          { id: "hook", deviceToken: "http://192.168.1.20:8787/h", transport: "webhook", registeredAt: 0, lastUsedAt: 0 },
        ],
      }),
    );
    registry = createPushTokenRegistry({ path: file });
    const { logger, lines } = captureLogger();
    const wh = stubTransport("webhook");
    const d = make({ webhook: wh.transport }, 30_000, logger);
    expect(() => d.fanout("s", turnEnd(true))).not.toThrow();
    await flush();
    expect(wh.sent).toHaveLength(1);
    expect(lines.some((l) => l.level === "warn" && l.fields?.tokenId === "pigeon")).toBe(true);
  });

  it("gone → pruned; ok → touch; failure → consecutiveFailures++ (outcome handling)", async () => {
    const results: Array<{ ok: boolean; gone?: boolean }> = [{ ok: false }, { ok: true }, { ok: false, gone: true }];
    const wh = stubTransport("webhook", () => Promise.resolve(results.shift()!));
    const r = registry.add({ deviceToken: "http://192.168.1.20:8787/h", transport: "webhook" });
    if (!r.ok) throw new Error("add");
    const d = make({ webhook: wh.transport });
    d.fanout("a", turnEnd(true));
    await flush();
    expect(registry.consecutiveFailures(r.token.id)).toBe(1);
    t = 7_000;
    d.fanout("b", turnEnd(true));
    await flush();
    expect(registry.consecutiveFailures(r.token.id)).toBe(0);
    expect(registry.get(r.token.id)?.lastUsedAt).toBe(7_000);
    d.fanout("c", turnEnd(true));
    await flush();
    expect(registry.get(r.token.id)).toBeUndefined();
  });

  it("logs one line per delivery with transport, redacted target, outcome and ms — never the secret", async () => {
    const { logger, lines } = captureLogger();
    const wp = stubTransport("web-push", () => Promise.resolve({ ok: false }));
    const wh = stubTransport("webhook", () => Promise.resolve({ ok: false }));
    registry.add({ deviceToken: SUB(1), transport: "web-push" });
    registry.add({ deviceToken: "https://hooks.example:8443/api/hooks/h1?key=s3cret", transport: "webhook", label: "nanoMuse" });
    const d = make({ "web-push": wp.transport, webhook: wh.transport }, 30_000, logger);
    d.fanout("s", turnEnd(true));
    await flush();
    const deliveries = lines.filter((l) => l.fields?.outcome !== undefined);
    expect(deliveries).toHaveLength(2);
    for (const l of deliveries) {
      expect(typeof l.fields?.ms).toBe("number");
      expect(typeof l.fields?.transport).toBe("string");
    }
    const all = JSON.stringify(lines);
    expect(all).toContain("nanoMuse (https://hooks.example:8443)");
    expect(all).toContain("fcm.googleapis.com browser");
    expect(all).not.toContain("s3cret");
    expect(all).not.toContain("/api/hooks/h1");
    expect(all).not.toContain("SECRET1");
  });

  it("test() bypasses cadence + coalescing and returns opaque results", async () => {
    const wh = stubTransport("webhook", () => Promise.resolve({ ok: false, status: 500 } as any));
    const r = registry.add({ deviceToken: "http://192.168.1.20:8787/h", transport: "webhook" });
    if (!r.ok) throw new Error("add");
    const d = make({ webhook: wh.transport });
    d.fanout("s", turnEnd(false));
    await flush();
    const results = await d.test();
    expect(results).toEqual([{ tokenId: r.token.id, ok: false }]);
    expect(wh.sent).toHaveLength(2);
    expect(wh.sent[1].payload.type).toBe("session_attention");
  });
});

describe("fire-and-forget lint on event-wiring.ts (test-plan #X3)", () => {
  function findAwaitedFanout(source: string): number {
    const sf = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, true);
    let hits = 0;
    const isFanoutCall = (n: ts.Node): boolean =>
      ts.isCallExpression(n) &&
      ((ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "fanout") ||
        (ts.isIdentifier(n.expression) && n.expression.text === "fanout"));
    const visit = (n: ts.Node) => {
      if (isFanoutCall(n)) {
        let p = n.parent;
        while (p && (ts.isParenthesizedExpression(p) || ts.isNonNullExpression(p) || ts.isAsExpression(p))) p = p.parent;
        if (p && ts.isAwaitExpression(p)) hits++;
        if (p && ts.isPropertyAccessExpression(p) && ["then", "catch", "finally"].includes(p.name.text)) hits++;
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return hits;
  }

  it("detects an awaited or chained fanout (positive control)", () => {
    expect(findAwaitedFanout("async function f(d:any){ await d?.fanout('s', {}); }")).toBe(1);
    expect(findAwaitedFanout("function f(d:any){ d.fanout('s', {}).then(() => 1); }")).toBe(1);
    expect(findAwaitedFanout("function f(d:any){ d?.fanout('s', {}); }")).toBe(0);
  });

  it("event-wiring.ts calls fanout and never awaits or chains it", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "event-wiring.ts"), "utf-8");
    expect(src).toMatch(/\.fanout\(/);
    expect(findAwaitedFanout(src)).toBe(0);
  });
});
