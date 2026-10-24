/**
 * `GET /api/events/stream` over a real socket: SSE framing, initial open
 * questions, session/type filters, visibility, heartbeat, close cleanup.
 * See change: add-agent-event-stream.
 */
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { type AgentEvent, createAgentEventHub } from "../../agent-events/agent-event-hub.js";
import { registerAgentEventStreamRoutes } from "../agent-event-stream-routes.js";

const anna = { iss: "kc", sub: "anna" };
const bela = { iss: "kc", sub: "bela" };

type Row = { id: string; sessionId: string; preview: string; type: string; sessionLabel: string };

interface Frame {
  id?: string;
  event?: string;
  data?: unknown;
  comment?: string;
}

function parseFrames(text: string): Frame[] {
  return text
    .split("\n\n")
    .filter((block) => block.trim() !== "")
    .map((block) => {
      const frame: Frame = {};
      for (const line of block.split("\n")) {
        if (line.startsWith(":")) frame.comment = line.slice(1).trim();
        else if (line.startsWith("id: ")) frame.id = line.slice(4);
        else if (line.startsWith("event: ")) frame.event = line.slice(7);
        else if (line.startsWith("data: ")) frame.data = JSON.parse(line.slice(6));
      }
      return frame;
    });
}

describe("agent event stream route", () => {
  const apps: FastifyInstance[] = [];
  const aborts: AbortController[] = [];

  afterEach(async () => {
    for (const a of aborts.splice(0)) a.abort();
    for (const a of apps.splice(0)) await a.close();
  });

  async function start(opts: { rows?: Row[]; active?: boolean; principal?: typeof anna; owners?: Record<string, typeof anna>; heartbeatMs?: number } = {}) {
    const rows = opts.rows ?? [];
    const hub = createAgentEventHub({ listQuestionRows: () => rows as never, ownerOf: (sid) => opts.owners?.[sid] });
    const app = Fastify();
    apps.push(app);
    app.addHook("onRequest", async (request) => {
      if (opts.principal) (request as unknown as { principal: typeof anna }).principal = opts.principal;
    });
    registerAgentEventStreamRoutes(app, {
      networkGuard: async () => {},
      hub,
      isResolverActive: () => opts.active ?? false,
      heartbeatMs: opts.heartbeatMs,
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = app.server.address() as { port: number };
    return { hub, app, rows, base: `http://127.0.0.1:${port}` };
  }

  /** Open the stream and return a reader that accumulates frames. */
  async function open(url: string) {
    const ctrl = new AbortController();
    aborts.push(ctrl);
    const res = await fetch(url, { signal: ctrl.signal });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const pump = (async () => {
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
    const frames = () => parseFrames(text);
    async function until(pred: (f: Frame[]) => boolean, ms = 2000): Promise<Frame[]> {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (pred(frames())) return frames();
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error(`timed out; frames: ${JSON.stringify(frames())}`);
    }
    return { res, frames, until, close: () => ctrl.abort(), pump };
  }

  const events = (frames: Frame[]) => frames.filter((f) => f.event && f.event !== "ready").map((f) => f.data as AgentEvent);

  it("sends SSE headers, a ready frame and the open questions first", async () => {
    const { base } = await start({ rows: [{ id: "q1", sessionId: "s1", preview: "Push?", type: "confirm", sessionLabel: "one" }] });
    const s = await open(`${base}/api/events/stream`);
    expect(s.res.status).toBe(200);
    expect(s.res.headers.get("content-type")).toBe("text/event-stream");
    expect(s.res.headers.get("cache-control")).toContain("no-cache");
    const frames = await s.until((f) => f.some((x) => x.event === "question_opened"));
    expect(frames[0]?.event).toBe("ready");
    expect(frames[1]).toMatchObject({ id: "1", event: "question_opened", data: { questionId: "q1", sessionId: "s1", preview: "Push?" } });
  });

  it("streams live transitions as numbered events", async () => {
    const { base, hub } = await start();
    const s = await open(`${base}/api/events/stream`);
    await s.until((f) => f.some((x) => x.event === "ready"));
    hub.onRegistryFrame({ type: "session_updated", sessionId: "s1", updates: { status: "streaming" } } as never);
    hub.onRegistryFrame({ type: "session_updated", sessionId: "s1", updates: { status: "idle" } } as never);
    const frames = await s.until((f) => events(f).length === 2);
    expect(events(frames)).toEqual([
      { type: "status", sessionId: "s1", to: "streaming" },
      { type: "status", sessionId: "s1", from: "streaming", to: "idle" },
    ]);
    expect(frames.filter((f) => f.id).map((f) => f.id)).toEqual(["1", "2"]);
  });

  it("filters by session and by type", async () => {
    const { base, hub } = await start();
    const s = await open(`${base}/api/events/stream?session=s1,s3&types=status`);
    await s.until((f) => f.some((x) => x.event === "ready"));
    hub.onRegistryFrame({ type: "session_updated", sessionId: "s2", updates: { status: "idle" } } as never);
    hub.onRegistryFrame({ type: "session_removed", sessionId: "s1" } as never);
    hub.onRegistryFrame({ type: "session_updated", sessionId: "s3", updates: { status: "idle" } } as never);
    const frames = await s.until((f) => events(f).length >= 1);
    await new Promise((r) => setTimeout(r, 50));
    expect(events(s.frames())).toEqual([{ type: "status", sessionId: "s3", to: "idle" }]);
    expect(frames[0]?.data).toEqual({ sessions: ["s1", "s3"], types: ["status"] });
  });

  it("rejects an unknown event type with 400", async () => {
    const { base } = await start();
    const res = await fetch(`${base}/api/events/stream?types=status,bogus`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: "unknown event type(s): bogus" });
  });

  it("applies session visibility when the ownership resolver is active", async () => {
    const { base, hub } = await start({ active: true, principal: anna, owners: { s1: anna, s2: bela } });
    const s = await open(`${base}/api/events/stream`);
    await s.until((f) => f.some((x) => x.event === "ready"));
    hub.onRegistryFrame({ type: "session_updated", sessionId: "s2", updates: { status: "idle" } } as never);
    hub.onRegistryFrame({ type: "session_updated", sessionId: "s1", updates: { status: "idle" } } as never);
    hub.onRegistryFrame({ type: "session_updated", sessionId: "s9", updates: { status: "idle" } } as never);
    await s.until((f) => events(f).length >= 1);
    await new Promise((r) => setTimeout(r, 50));
    expect(events(s.frames()).map((e) => e.sessionId)).toEqual(["s1"]);
  });

  it("sends heartbeat comments", async () => {
    const { base } = await start({ heartbeatMs: 20 });
    const s = await open(`${base}/api/events/stream`);
    await s.until((f) => f.some((x) => x.comment === "ping"));
  });

  it("unsubscribes when the client disconnects", async () => {
    const { base, hub } = await start();
    let listeners = 0;
    const orig = hub.subscribe;
    hub.subscribe = (l) => {
      listeners++;
      const un = orig(l);
      return () => {
        listeners--;
        un();
      };
    };
    const s = await open(`${base}/api/events/stream`);
    await s.until((f) => f.some((x) => x.event === "ready"));
    expect(listeners).toBe(1);
    s.close();
    const end = Date.now() + 2000;
    while (listeners !== 0 && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
    expect(listeners).toBe(0);
  });

  it("ends open streams when the server closes", async () => {
    const { base, app } = await start();
    const s = await open(`${base}/api/events/stream`);
    await s.until((f) => f.some((x) => x.event === "ready"));
    apps.splice(apps.indexOf(app), 1);
    await app.close();
    await s.pump;
  });
});
