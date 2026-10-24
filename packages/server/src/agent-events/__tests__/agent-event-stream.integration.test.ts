/**
 * End-to-end through a real in-process server: bridge socket → gateway
 * registry frames + question store → agent event hub → `GET /api/events/stream`.
 * Harness modelled on `questions/__tests__/question-wiring.integration.test.ts`.
 * See change: add-agent-event-stream.
 */
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createServer, type DashboardServer, type ServerConfig } from "../../server.js";
import { proofFetch } from "../../test-support/local-credential-stamp.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const baseConfig: ServerConfig = { port: 0, piPort: 0, host: "127.0.0.1", dev: true, autoShutdown: false, shutdownIdleSeconds: 999, tunnel: false };

describe("agent event stream (integration)", () => {
  let server: DashboardServer;
  const sockets: WebSocket[] = [];
  const aborts: AbortController[] = [];

  afterEach(async () => {
    for (const a of aborts.splice(0)) a.abort();
    for (const s of sockets.splice(0)) s.close();
    await server.stop();
  });

  async function openStream(url: string) {
    const ctrl = new AbortController();
    aborts.push(ctrl);
    const res = await proofFetch(url, { signal: ctrl.signal });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          text += decoder.decode(value, { stream: true });
        }
      } catch {
        /* aborted */
      }
    })();
    const events = () =>
      text
        .split("\n\n")
        .map((block) => block.split("\n").find((l) => l.startsWith("data: ") && block.includes("\nevent: ") && !block.includes("event: ready")))
        .filter((l): l is string => l !== undefined)
        .map((l) => JSON.parse(l.slice(6)));
    async function until(pred: (e: any[]) => boolean, ms = 4000) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (pred(events())) return events();
        await wait(20);
      }
      throw new Error(`timed out; stream: ${text}`);
    }
    return { until, events };
  }

  it("streams session and question transitions from a live bridge", async () => {
    server = await createServer({ ...baseConfig });
    await server.start();
    const base = `http://127.0.0.1:${server.httpPort()}`;
    const stream = await openStream(`${base}/api/events/stream?session=ev1`);

    const bridge = new WebSocket(`ws://127.0.0.1:${server.piPort()}`);
    await new Promise<void>((resolve) => bridge.on("open", () => resolve()));
    sockets.push(bridge);
    const send = (msg: Record<string, unknown>) => bridge.send(JSON.stringify(msg));

    send({ type: "session_register", sessionId: "ev1", cwd: "/tmp", source: "cli" });
    send({ type: "replay_complete", sessionId: "ev1" });
    await stream.until((e) => e.some((x) => x.type === "session_added" && x.sessionId === "ev1"));

    send({ type: "prompt_request", sessionId: "ev1", promptId: "p1", prompt: { type: "confirm", question: "Proceed?" }, component: { type: "x", props: {} }, placement: "inline" });
    const opened = await stream.until((e) => e.some((x) => x.type === "question_opened"));
    const q = opened.find((x) => x.type === "question_opened");
    expect(q).toMatchObject({ sessionId: "ev1", questionType: "confirm", preview: "Proceed?" });

    send({ type: "prompt_dismiss", sessionId: "ev1", promptId: "p1" });
    await stream.until((e) => e.some((x) => x.type === "question_closed" && x.questionId === q.questionId && x.reason === "removed"));

    server.sessionManager.unregister("ev1");
    await stream.until((e) => e.some((x) => (x.type === "status" && x.to === "ended") || x.type === "session_removed"));
    expect(stream.events().every((x) => x.sessionId === "ev1")).toBe(true);
  });
});
