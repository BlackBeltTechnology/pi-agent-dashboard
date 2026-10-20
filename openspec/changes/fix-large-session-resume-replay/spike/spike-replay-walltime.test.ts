import { it } from "vitest";
import { WebSocket } from "ws";
import { createServer } from "../server.js";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
it("replay wall time at issue scale", async () => {
  const server = await createServer({ port: 0, piPort: 0, host: "127.0.0.1", dev: true, autoShutdown: false, shutdownIdleSeconds: 999, tunnel: false });
  await server.start();
  const b = new WebSocket(`ws://127.0.0.1:${server.piPort()}`);
  await new Promise((r) => b.on("open", r));
  const br = new WebSocket(`ws://127.0.0.1:${server.httpPort()}/ws`);
  let flushAt = 0; let frames = 0;
  br.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.type === "event_replay" && m.sessionId === "big") { frames++; if (m.isLast) flushAt = Date.now(); } });
  await new Promise((r) => br.on("open", r));
  const N = 15_213; const text = "x".repeat(5_300);
  b.send(JSON.stringify({ type: "session_register", sessionId: "big", cwd: "/tmp", source: "cli", eventCount: 6531 }));
  await wait(50);
  br.send(JSON.stringify({ type: "subscribe", sessionId: "big" }));
  await wait(100);
  flushAt = 0; frames = 0;
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const kind = i % 3;
    const ev = kind === 0
      ? { eventType: "message_end", timestamp: t0, data: { message: { role: "assistant", content: [{ type: "text", text }] } } }
      : kind === 1
        ? { eventType: "tool_execution_start", timestamp: t0, data: { toolName: "Read", toolCallId: `c${i}`, args: { path: `/tmp/f${i}` } } }
        : { eventType: "tool_execution_end", timestamp: t0, data: { toolName: "Read", toolCallId: `c${i - 1}`, result: { content: [{ type: "text", text: text + text }] } } };
    b.send(JSON.stringify({ type: "event_forward", sessionId: "big", event: ev }));
  }
  const sentMs = Date.now() - t0;
  b.send(JSON.stringify({ type: "replay_complete", sessionId: "big" }));
  while (!flushAt && Date.now() - t0 < 180_000) await wait(100);
  console.log("[WALL]", JSON.stringify({ events: N, bridgeSendLoopMs: sentMs, registerToFlushMs: flushAt - t0, flushFrames: frames, stored: server.eventStore.getEvents("big", 1).length }));
  b.close(); br.close(); await server.stop();
}, 200_000);
