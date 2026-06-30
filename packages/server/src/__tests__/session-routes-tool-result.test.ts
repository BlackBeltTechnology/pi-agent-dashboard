/**
 * GET /api/sessions/:sessionId/tool-result/:toolCallId returns the full
 * stored tool result, 404 when in-flight or evicted.
 *
 * See change: adopt-pi-071-072-073-features (C.1).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerSessionRoutes } from "../routes/session-routes.js";
import { createMemoryEventStore, type EventStore } from "../memory-event-store.js";

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

  it("returns 404 for an evicted / unknown session", async () => {
    const res = await fastify.inject({ method: "GET", url: "/api/sessions/ghost/tool-result/t3" });
    expect(res.statusCode).toBe(404);
  });
});
