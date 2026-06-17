/**
 * Unit tests for the `DrainingFakeWs` primitive itself (the timing model),
 * independent of the real gateway. Validates byte accounting, clamp-at-0
 * drain, FIFO head-of-line `timeToFlush`, and the readyState surface.
 *
 * See change: add-ws-broadcast-load-harness.
 */
import { describe, it, expect } from "vitest";
import { createDrainingWs } from "./helpers/draining-ws.js";

describe("DrainingFakeWs byte accounting", () => {
  it("accumulates bufferedAmount across sends with no intervening advance", () => {
    const ws = createDrainingWs({ drainRateBytesPerMs: 1000 });
    ws.send("a".repeat(1000));
    ws.send("b".repeat(2000));
    expect(ws.bufferedAmount).toBe(3000);
  });

  it("drains bufferedAmount at the configured rate on advance", () => {
    const ws = createDrainingWs({ drainRateBytesPerMs: 500 });
    ws.send("x".repeat(2000));
    ws.advance(2); // drains 1000
    expect(ws.bufferedAmount).toBe(1000);
  });

  it("clamps drain at zero, never negative", () => {
    const ws = createDrainingWs({ drainRateBytesPerMs: 1000 });
    ws.send("x".repeat(500));
    ws.advance(10); // would drain 10000
    expect(ws.bufferedAmount).toBe(0);
  });

  it("advances the virtual clock", () => {
    const ws = createDrainingWs({ drainRateBytesPerMs: 1000 });
    expect(ws.now()).toBe(0);
    ws.advance(5);
    ws.advance(3);
    expect(ws.now()).toBe(8);
  });
});

describe("DrainingFakeWs FIFO timeToFlush (head-of-line blocking)", () => {
  it("a small frame behind a large frame flushes later than alone", () => {
    const rate = 1000;

    // Small frame queued behind a large frame on a shared wire.
    const shared = createDrainingWs({ drainRateBytesPerMs: rate });
    shared.send(JSON.stringify({ type: "openspec_update", cwd: "/big", data: "X".repeat(100_000) }));
    shared.send(JSON.stringify({ type: "event", sessionId: "focused" }));
    const behind = shared.timeToFlush((r) => r.type === "event");

    // Same small frame enqueued alone on an empty wire.
    const alone = createDrainingWs({ drainRateBytesPerMs: rate });
    alone.send(JSON.stringify({ type: "event", sessionId: "focused" }));
    const solo = alone.timeToFlush((r) => r.type === "event");

    expect(behind).toBeDefined();
    expect(solo).toBeDefined();
    expect(behind!).toBeGreaterThan(solo!);
  });

  it("timeToFlush equals bytesAtEnqueue / drainRate", () => {
    const ws = createDrainingWs({ drainRateBytesPerMs: 100 });
    ws.send("x".repeat(500));
    const t = ws.timeToFlush((r) => r.bytes === 500);
    expect(t).toBe(5); // 500 bytes / 100 bytes-per-ms
  });

  it("returns undefined when no record matches", () => {
    const ws = createDrainingWs({ drainRateBytesPerMs: 100 });
    ws.send("x".repeat(100));
    expect(ws.timeToFlush((r) => r.type === "nope")).toBeUndefined();
  });

  it("flushTimes returns one value per matching record in send order", () => {
    const ws = createDrainingWs({ drainRateBytesPerMs: 100 });
    ws.send(JSON.stringify({ type: "event", sessionId: "f" })); // small
    ws.send("x".repeat(900)); // padding
    ws.send(JSON.stringify({ type: "event", sessionId: "f" })); // small, now behind padding
    const times = ws.flushTimes((r) => r.type === "event");
    expect(times).toHaveLength(2);
    expect(times[1]).toBeGreaterThan(times[0]);
  });
});

describe("DrainingFakeWs metadata parsing", () => {
  it("parses type/cwd/sessionId best-effort from JSON frames", () => {
    const ws = createDrainingWs({ drainRateBytesPerMs: 100 });
    ws.send(JSON.stringify({ type: "openspec_update", cwd: "/repo", data: {} }));
    const rec = ws.sent[0];
    expect(rec.type).toBe("openspec_update");
    expect(rec.cwd).toBe("/repo");
  });

  it("leaves fields undefined for non-JSON frames", () => {
    const ws = createDrainingWs({ drainRateBytesPerMs: 100 });
    ws.send("not json");
    expect(ws.sent[0].type).toBeUndefined();
    expect(ws.sent[0].bytes).toBe(8);
  });
});

describe("DrainingFakeWs surface", () => {
  it("exposes OPEN and readyState for the gateway guard", () => {
    const ws = createDrainingWs({ drainRateBytesPerMs: 100 });
    expect(ws.OPEN).toBe(1);
    expect(ws.readyState).toBe(1);
  });

  it("honors a non-OPEN initial readyState", () => {
    const ws = createDrainingWs({ drainRateBytesPerMs: 100, readyState: 3 });
    expect(ws.readyState).toBe(3);
  });

  it("close sets readyState to CLOSED and emits close", () => {
    const ws = createDrainingWs({ drainRateBytesPerMs: 100 });
    let closed = false;
    ws.on("close", () => { closed = true; });
    ws.close();
    expect(ws.readyState).toBe(3);
    expect(closed).toBe(true);
  });

  it("tracks peak bufferedAmount across drain cycles", () => {
    const ws = createDrainingWs({ drainRateBytesPerMs: 1000 });
    ws.send("x".repeat(5000));
    ws.advance(3); // drains 3000, buffer 2000
    ws.send("y".repeat(1000)); // buffer 3000 (below earlier peak)
    expect(ws.peakBufferedAmount()).toBe(5000);
  });
});
