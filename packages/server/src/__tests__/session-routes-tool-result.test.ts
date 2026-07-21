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

  it("returns 404 for an evicted / unknown session", async () => {
    const res = await fastify.inject({ method: "GET", url: "/api/sessions/ghost/tool-result/t3" });
    expect(res.statusCode).toBe(404);
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
