/**
 * Perf budget for the bridge replay-exit flush at issue scale (#929).
 *
 * develop: the flush was ONE `event_replay` frame holding every stored event
 * (11,203 of 15,213 after compaction, ~80 MB). The flush now goes through the
 * subscribe-time windowing, so no frame may exceed `maxReplayEvents`.
 *
 * Shaped like `spike/spike-replay-walltime.test.ts`.
 * See change: fix-large-session-resume-replay (test-plan #P1).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createServer, type DashboardServer } from "../server.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("replay-exit flush at issue scale (test-plan #P1)", () => {
  let server: DashboardServer;
  const sockets: WebSocket[] = [];

  beforeEach(async () => {
    server = await createServer({
      port: 0, piPort: 0, host: "127.0.0.1", dev: true, autoShutdown: false,
      shutdownIdleSeconds: 999, tunnel: false,
    });
    await server.start();
  });

  afterEach(async () => {
    for (const s of sockets) s.close();
    sockets.length = 0;
    await server.stop();
  });

  it("P1: 15,213 issue-shaped events flush in frames no larger than the default window", async () => {
    const WINDOW = 2_000; // default maxReplayEvents
    const N = 15_213;
    const text = "x".repeat(5_300);
    const bridge = new WebSocket(`ws://127.0.0.1:${server.piPort()}`);
    const browser = new WebSocket(`ws://127.0.0.1:${server.httpPort()}/ws`);
    sockets.push(bridge, browser);
    const frames: number[] = [];
    let done = false;
    browser.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type !== "event_replay" || m.sessionId !== "big") return;
      frames.push(m.events.length);
      if (m.isLast) done = true;
    });
    await Promise.all([
      new Promise((r) => bridge.on("open", r)),
      new Promise((r) => browser.on("open", r)),
    ]);

    bridge.send(JSON.stringify({ type: "session_register", sessionId: "big", cwd: "/tmp", source: "cli", eventCount: 6531 }));
    await wait(50);
    browser.send(JSON.stringify({ type: "subscribe", sessionId: "big" }));
    await wait(100);
    frames.length = 0;
    done = false;

    const t0 = Date.now();
    for (let i = 0; i < N; i++) {
      const kind = i % 3;
      const event =
        kind === 0
          ? { eventType: "message_end", timestamp: t0, data: { message: { role: "assistant", content: [{ type: "text", text }] } } }
          : kind === 1
            ? { eventType: "tool_execution_start", timestamp: t0, data: { toolName: "Read", toolCallId: `c${i}`, args: { path: `/tmp/f${i}` } } }
            : { eventType: "tool_execution_end", timestamp: t0, data: { toolName: "Read", toolCallId: `c${i - 1}`, result: { content: [{ type: "text", text: text + text }] } } };
      bridge.send(JSON.stringify({ type: "event_forward", sessionId: "big", replay: true, event }));
    }
    bridge.send(JSON.stringify({ type: "replay_complete", sessionId: "big" }));
    while (!done && Date.now() - t0 < 120_000) await wait(100);

    expect(done).toBe(true);
    expect(Math.max(...frames)).toBeLessThanOrEqual(WINDOW);
    console.log("[P1]", JSON.stringify({ events: N, registerToFlushMs: Date.now() - t0, frames: frames.length, largestFrame: Math.max(...frames) }));
  }, 150_000);
});
