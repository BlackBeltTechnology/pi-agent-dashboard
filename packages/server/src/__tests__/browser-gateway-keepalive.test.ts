/**
 * Browser socket protocol keepalive: ping every interval, terminate after two
 * consecutive unanswered pings, timer cleared on wss close
 * (test-plan #E10, #E11, #X2, #X5).
 *
 * Only `setInterval`/`clearInterval` are faked, so real TCP I/O (ping/pong
 * frames) still flows; each tick is followed by a short real wait for the
 * round-trip.
 *
 * See change: harden-ios-safari-memory-and-ws-diagnostics (design D2).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { type RealBrowserWsHarness, startRealBrowserWs, until } from "./helpers/real-browser-ws.js";

const INTERVAL = 1000;
const PREFIX = "[browser-gw] browser client disconnected (remaining:";

let errorSpy: ReturnType<typeof vi.spyOn>;
let harness: RealBrowserWsHarness | undefined;

const closeLines = (): string[] =>
  errorSpy.mock.calls.map((c: unknown[]) => String(c[0])).filter((l: string) => l.startsWith(PREFIX));

const settle = () => new Promise((r) => setTimeout(r, 30));

/** Advance one keepalive tick and let the ping/pong round-trip land. */
async function tick(): Promise<void> {
  vi.advanceTimersByTime(INTERVAL);
  await settle();
}

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
});

afterEach(async () => {
  await harness?.close();
  harness = undefined;
  vi.useRealTimers();
  errorSpy.mockRestore();
});

describe("responsive client stays connected (test-plan #E11)", () => {
  it("receives a ping every tick and is never terminated", async () => {
    harness = await startRealBrowserWs(INTERVAL);
    const ws = await harness.connect(); // autoPong: true (default)
    let pings = 0;
    ws.on("ping", () => pings++);
    for (let i = 0; i < 10; i++) await tick();
    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect(pings).toBeGreaterThanOrEqual(10);
    expect(closeLines()).toEqual([]);
  });
});

describe("one missed ping is tolerated (test-plan #E10)", () => {
  it("stays open when only the first ping goes unanswered", async () => {
    harness = await startRealBrowserWs(INTERVAL);
    const ws = await harness.connect({ autoPong: false });
    let seen = 0;
    ws.on("ping", (data) => {
      seen++;
      if (seen > 1) ws.pong(data);
    });
    for (let i = 0; i < 4; i++) await tick();
    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect(closeLines().some((l) => l.includes("cause=keepalive"))).toBe(false);
  });
});

describe("unresponsive client is terminated (test-plan #X2)", () => {
  it("terminates on tick 3 (not 2) with exactly one cause=keepalive code=1006 line", async () => {
    harness = await startRealBrowserWs(INTERVAL);
    const ws = await harness.connect({ autoPong: false });
    await tick();
    await tick();
    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect(harness.gateway.wss.clients.size).toBe(1);
    await tick();
    await until(() => closeLines().length > 0);
    const lines = closeLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("code=1006");
    expect(lines[0]).toMatch(/cause=keepalive$/);
  });
});

describe("server close clears the keepalive timer (test-plan #X5)", () => {
  it("sends no pings after wss close and leaves no interval scheduled", async () => {
    harness = await startRealBrowserWs(INTERVAL);
    const ws = await harness.connect();
    let pings = 0;
    ws.on("ping", () => pings++);
    await tick();
    expect(pings).toBe(1);
    const timersBefore = vi.getTimerCount();

    const h = harness;
    harness = undefined;
    await h.close(); // terminate clients, then wss.close() — the shutdown order

    expect(vi.getTimerCount()).toBe(timersBefore - 1);
    const pingsAtClose = pings;
    for (let i = 0; i < 5; i++) await tick();
    expect(pings).toBe(pingsAtClose);
  });
});
