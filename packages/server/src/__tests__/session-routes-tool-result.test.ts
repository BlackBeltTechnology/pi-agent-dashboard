/**
 * GET /api/sessions/:sessionId/tool-result/:toolCallId returns the full
 * stored tool result, 404 when in-flight or evicted.
 *
 * See change: adopt-pi-071-072-073-features (C.1).
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryEventStore, type EventStore } from "../persistence/memory-event-store.js";
import { registerSessionRoutes } from "../routes/session-routes.js";

const PASSTHRU_GUARD = async () => {};

function makeSessionManager(): any {
  return { listAll: () => [], get: () => undefined };
}

describe("GET /api/sessions/:sessionId/tool-result/:toolCallId", () => {
  let fastify: FastifyInstance;
  let eventStore: EventStore;

  beforeEach(async () => {
    eventStore = createMemoryEventStore(() => false);
    fastify = Fastify();
    registerSessionRoutes(fastify, {
      sessionManager: makeSessionManager(),
      eventStore,
      networkGuard: PASSTHRU_GUARD,
    });
    await fastify.ready();
  });

  afterEach(async () => {
    if (fastify) await fastify.close();
  });

  it("returns 200 with the full result for a completed tool call", async () => {
    eventStore.insertEvent("s1", {
      eventType: "tool_execution_end",
      timestamp: 1,
      data: { toolCallId: "t1", result: "full output here", isError: false },
    });
    const res = await fastify.inject({ method: "GET", url: "/api/sessions/s1/tool-result/t1" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.result).toBe("full output here");
    expect(body.isError).toBe(false);
  });

  it("returns 404 for an in-flight tool call (no end event)", async () => {
    eventStore.insertEvent("s1", {
      eventType: "tool_execution_start",
      timestamp: 1,
      data: { toolCallId: "t2", toolName: "bash", args: {} },
    });
    const res = await fastify.inject({ method: "GET", url: "/api/sessions/s1/tool-result/t2" });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.payload).error).toMatch(/in flight|unknown/);
  });

  // See change: render-nested-tool-calls — test-plan E19. A nested id carries
  // `/`; Fastify decodes `%2F` into one `:toolCallId` param, a raw `/` 404s.
  it("serves a nested call's stored end via an encoded id; raw `/` 404s", async () => {
    eventStore.insertEvent("s1", {
      eventType: "tool_execution_end",
      timestamp: 1,
      data: {
        toolCallId: "call_1/1",
        parentToolCallId: "call_1",
        result: { content: [{ type: "text", text: "nested out" }] },
        isError: false,
      },
    });
    const ok = await fastify.inject({ method: "GET", url: "/api/sessions/s1/tool-result/call_1%2F1" });
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.payload).result).toEqual({ content: [{ type: "text", text: "nested out" }] });
    const raw = await fastify.inject({ method: "GET", url: "/api/sessions/s1/tool-result/call_1/1" });
    expect(raw.statusCode).toBe(404);
  });

  it("returns 404 for an evicted / unknown session", async () => {
    const res = await fastify.inject({ method: "GET", url: "/api/sessions/ghost/tool-result/t3" });
    expect(res.statusCode).toBe(404);
  });
});

// See change: distinguish-tool-result-pending-vs-gone (test-plan E7–E12).
describe("GET tool-result — pending vs gone", () => {
  let fastify: FastifyInstance;
  let eventStore: EventStore;
  let inFlight: Set<string>;
  let stats: { pending: number; gone: number };
  let resolverActive = false;
  let owners: Record<string, { iss: string; sub: string } | undefined> = {};

  /** Trim `id`'s end out of `sid` so the store records the eviction. */
  function evict(store: EventStore, sid: string, id: string): void {
    store.insertEvent(sid, { eventType: "tool_execution_end", timestamp: 1, data: { toolCallId: id, result: "x" } });
    store.insertEvent(sid, { eventType: "stats_update", timestamp: 2, data: {} });
    store.insertEvent(sid, { eventType: "stats_update", timestamp: 3, data: {} });
  }

  beforeEach(async () => {
    // cap 2, no slack: the end is trimmed by the next inserts.
    eventStore = createMemoryEventStore(() => false, 100, 2);
    inFlight = new Set();
    stats = { pending: 0, gone: 0 };
    resolverActive = false;
    owners = {};
    fastify = Fastify();
    registerSessionRoutes(fastify, {
      sessionManager: { listAll: () => [], get: (id: string) => (owners[id] ? { id, principalOwner: owners[id] } : undefined) } as any,
      eventStore,
      networkGuard: PASSTHRU_GUARD,
      isResolverActive: () => resolverActive,
      isToolInFlight: (sid, id) => inFlight.has(`${sid}/${id}`),
      toolResultStats: stats,
    });
    await fastify.ready();
  });

  afterEach(async () => {
    if (fastify) await fastify.close();
  });

  const get = (url: string) => fastify.inject({ method: "GET", url });

  it("E7: a stored end is 200", async () => {
    eventStore.insertEvent("s", { eventType: "tool_execution_end", timestamp: 1, data: { toolCallId: "abc", result: "out", isError: false } });
    const res = await get("/api/sessions/s/tool-result/abc");
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ result: "out", isError: false });
  });

  it("E8: an evicted end is 410 with or without ?pending=1", async () => {
    evict(eventStore, "s", "abc");
    expect(eventStore.findToolEndEvent("s", "abc")).toBeUndefined();
    for (const url of ["/api/sessions/s/tool-result/abc", "/api/sessions/s/tool-result/abc?pending=1"]) {
      const res = await get(url);
      expect(res.statusCode).toBe(410);
      expect(JSON.parse(res.payload)).toEqual({ error: "result no longer available" });
    }
  });

  it("E9: a re-stored end wins over the eviction record", async () => {
    evict(eventStore, "s", "abc");
    eventStore.insertEvent("s", { eventType: "tool_execution_end", timestamp: 9, data: { toolCallId: "abc", result: "again" } });
    const res = await get("/api/sessions/s/tool-result/abc");
    expect(res.statusCode).toBe(200);
  });

  it("E10: in-flight answers 202 only for pending=1 exactly", async () => {
    inFlight.add("s/abc");
    const ok = await get("/api/sessions/s/tool-result/abc?pending=1");
    expect(ok.statusCode).toBe(202);
    expect(JSON.parse(ok.payload)).toEqual({ pending: true });
    for (const q of ["", "?pending=true", "?pending=0", "?pending=1&pending=1"]) {
      const res = await get(`/api/sessions/s/tool-result/abc${q}`);
      expect(res.statusCode, q).toBe(404);
    }
  });

  it("E11: in-flight survives a trimmed start", async () => {
    eventStore.insertEvent("s", { eventType: "tool_execution_start", timestamp: 1, data: { toolCallId: "abc", toolName: "bash" } });
    eventStore.insertEvent("s", { eventType: "stats_update", timestamp: 2, data: {} });
    eventStore.insertEvent("s", { eventType: "stats_update", timestamp: 3, data: {} });
    eventStore.insertEvent("s", { eventType: "stats_update", timestamp: 4, data: {} });
    inFlight.add("s/abc");
    const res = await get("/api/sessions/s/tool-result/abc?pending=1");
    expect(res.statusCode).toBe(202);
  });

  it("E12: unknown session is 404; an owner-gate rejection never yields 410/202", async () => {
    const unknown = await get("/api/sessions/ghost/tool-result/abc?pending=1");
    expect(unknown.statusCode).toBe(404);

    evict(eventStore, "s", "abc");
    inFlight.add("s/xyz");
    owners.s = { iss: "i", sub: "anna" };
    resolverActive = true; // request carries no principal
    const gone = await get("/api/sessions/s/tool-result/abc");
    expect(gone.statusCode).toBe(404);
    const pending = await get("/api/sessions/s/tool-result/xyz?pending=1");
    expect(pending.statusCode).toBe(404);
    expect(stats).toEqual({ pending: 0, gone: 0 });
  });

  it("counts 202 and 410 answers in the stats sink", async () => {
    evict(eventStore, "s", "abc");
    inFlight.add("s/run");
    await get("/api/sessions/s/tool-result/abc");
    await get("/api/sessions/s/tool-result/run?pending=1");
    await get("/api/sessions/s/tool-result/nothing?pending=1");
    expect(stats).toEqual({ pending: 1, gone: 1 });
  });
});

// opt-in-out-of-cwd-session-diffs: GET /api/session-change/:sessionId/:toolCallId
describe("GET /api/session-change/:sessionId/:toolCallId", () => {
  let fastify: FastifyInstance;
  let tmpDir: string;
  let sessionFile: string;

  function managerWith(sessionFileById: Record<string, string | undefined>): any {
    return { listAll: () => [], get: (id: string) => (id in sessionFileById ? { id, cwd: "/tmp", sessionFile: sessionFileById[id] } : undefined) };
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "session-change-"));
    sessionFile = join(tmpDir, "s.jsonl");
    writeFileSync(
      sessionFile,
      [
        { type: "session", id: "s1", cwd: "/tmp" },
        { type: "message", id: "e1", parentId: null, message: { role: "assistant", content: [{ type: "toolCall", id: "tc-1", name: "write", arguments: { path: "/tmp/out.txt", content: "FULL" } }] } },
      ].map((e) => JSON.stringify(e)).join("\n") + "\n",
    );
  });

  afterEach(async () => {
    if (fastify) await fastify.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function build(manager: any): Promise<FastifyInstance> {
    const f = Fastify();
    registerSessionRoutes(f, { sessionManager: manager, eventStore: createMemoryEventStore(() => false), networkGuard: PASSTHRU_GUARD });
    await f.ready();
    return f;
  }

  it("returns 200 with the full payload for a known tool call", async () => {
    fastify = await build(managerWith({ s1: sessionFile }));
    const res = await fastify.inject({ method: "GET", url: "/api/session-change/s1/tc-1" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).data.content).toBe("FULL");
  });

  it("E6 — returns 404 for an unknown toolCallId", async () => {
    fastify = await build(managerWith({ s1: sessionFile }));
    const res = await fastify.inject({ method: "GET", url: "/api/session-change/s1/tc-missing" });
    expect(res.statusCode).toBe(404);
  });

  it("E7 — SECURITY: resolves only via sessionManager.sessionFile (no path built from sessionId)", async () => {
    // A path-looking / traversal sessionId that is NOT a registered session
    // must 404 — the route never constructs a filesystem path from the id.
    fastify = await build(managerWith({ s1: sessionFile }));
    const res = await fastify.inject({
      method: "GET",
      url: `/api/session-change/${encodeURIComponent("../../etc/passwd")}/tc-1`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 404 when the session has no sessionFile", async () => {
    fastify = await build(managerWith({ s1: undefined }));
    const res = await fastify.inject({ method: "GET", url: "/api/session-change/s1/tc-1" });
    expect(res.statusCode).toBe(404);
  });
});
