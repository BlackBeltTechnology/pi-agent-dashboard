/**
 * `GET /api/sessions/:sessionId/retained-transcript` — the HTTP surface of the
 * D12 read half.
 *
 * The refusal DECISIONS are unit-tested in `session/__tests__/retained-transcript.test.ts`.
 * What is tested here is what only the route can get wrong: which status code
 * carries which refusal, in what ORDER they are evaluated, and whether the
 * route is behind the network guard at all.
 *
 * The guard arm lives here rather than at L3 deliberately. The docker harness
 * treats a host request through the published port as trusted — the
 * known-guarded sibling `/api/session-file` answers it too — so an L3
 * assertion that the guard refuses would be asserting something that
 * environment cannot produce. A spy preHandler proves the wiring exactly, and
 * fails the moment someone drops `preHandler: networkGuard`.
 *
 * See change: serve-retained-remote-transcripts (tasks 1.1, 1.2, 1.3).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryEventStore, type EventStore } from "../persistence/memory-event-store.js";
import { registerSessionRoutes } from "../routes/session-routes.js";
import type { NetworkGuard } from "../routes/route-deps.js";
import { createRemoteTranscriptStore } from "../session/remote-transcript-store.js";

const REMOTE_ID = "sess-remote";
const LOCAL_ID = "sess-local";
const ARCHIVED_REMOTE_ID = "sess-archived-remote";

const TRANSCRIPT = [
  JSON.stringify({ type: "session", id: REMOTE_ID, timestamp: "2025-01-01T00:00:00Z" }),
  JSON.stringify({
    type: "message",
    id: "e1",
    parentId: null,
    timestamp: "2025-01-01T00:00:01Z",
    message: { role: "user", content: "from the other machine" },
  }),
];

let home: string;
let fastify: FastifyInstance;
let eventStore: EventStore;
let guard: NetworkGuard & ReturnType<typeof vi.fn>;

function sessionManagerStub(): any {
  const sessions: Record<string, unknown> = {
    [REMOTE_ID]: { id: REMOTE_ID, originDeviceId: "device-abc" },
    [LOCAL_ID]: { id: LOCAL_ID },
  };
  return { listAll: () => Object.values(sessions), get: (id: string) => sessions[id] };
}

function sessionArchiveStub(): any {
  return {
    getById: (id: string) =>
      id === ARCHIVED_REMOTE_ID
        ? {
            id,
            cwd: "/elsewhere",
            groupPath: "/elsewhere",
            endedAt: 1,
            archivedAt: 2,
            sessionFile: "/on/another/host.jsonl",
            originDeviceId: "device-abc",
          }
        : undefined,
  };
}

beforeEach(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-rtroute-"));
  eventStore = createMemoryEventStore(() => false);
  guard = vi.fn(async () => {}) as NetworkGuard & ReturnType<typeof vi.fn>;
  fastify = Fastify();
  registerSessionRoutes(fastify, {
    sessionManager: sessionManagerStub(),
    eventStore,
    networkGuard: guard,
    sessionArchive: sessionArchiveStub(),
    remoteTranscriptStore: createRemoteTranscriptStore({ homedir: home }),
  });
  await fastify.ready();
});

afterEach(async () => {
  if (fastify) await fastify.close();
  fs.rmSync(home, { recursive: true, force: true });
});

const get = (url: string) => fastify.inject({ method: "GET", url });

describe("GET /api/sessions/:sessionId/retained-transcript", () => {
  it("is behind the network guard", async () => {
    await get(`/api/sessions/${REMOTE_ID}/retained-transcript`);
    expect(
      guard,
      "the route serves a full-fidelity transcript without the network guard in front of it",
    ).toHaveBeenCalled();
  });

  it("serves a remote session's retained entries with its state", async () => {
    createRemoteTranscriptStore({ homedir: home }).append(REMOTE_ID, TRANSCRIPT, {
      restarted: true,
      complete: true,
    });
    const res = await get(`/api/sessions/${REMOTE_ID}/retained-transcript`);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.entries).toEqual(TRANSCRIPT);
    expect(body.data.state).toBe("complete");
  });

  it("reports a never-transferred remote session as absent, not as an error", async () => {
    const res = await get(`/api/sessions/${REMOTE_ID}/retained-transcript`);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).data).toEqual({ entries: [], state: "absent" });
  });

  it("serves an ARCHIVED remote session — the case where retention is the only copy", async () => {
    createRemoteTranscriptStore({ homedir: home }).append(ARCHIVED_REMOTE_ID, TRANSCRIPT, {
      restarted: true,
      complete: false,
    });
    const res = await get(`/api/sessions/${ARCHIVED_REMOTE_ID}/retained-transcript`);
    expect(res.statusCode, "an archived remote session 404'd — its origin host is gone").toBe(200);
    expect(JSON.parse(res.payload).data.state).toBe("incomplete");
  });

  it("refuses a LOCAL-origin session with 403", async () => {
    const res = await get(`/api/sessions/${LOCAL_ID}/retained-transcript`);
    expect(res.statusCode).toBe(403);
  });

  it("404s a session it has never heard of", async () => {
    const res = await get("/api/sessions/who-dis/retained-transcript");
    expect(res.statusCode).toBe(404);
  });

  it.each(["path", "file", "filePath", "sessionFile", "sessionDir", "dir", "cwd"])(
    "refuses a '%s' query field with 400",
    async (field) => {
      const res = await get(
        `/api/sessions/${REMOTE_ID}/retained-transcript?${field}=${encodeURIComponent("../../etc/passwd")}`,
      );
      expect(res.statusCode).toBe(400);
      expect(res.payload).not.toContain("root:");
    },
  );

  it("answers a path-bearing probe 400 whether or not the session exists", async () => {
    // Shape BEFORE subject. If the lookup ran first, an unknown id would answer
    // 404 and a known one 400 — two refusals differenced into an existence
    // oracle, which is exactly what the guard's ordering exists to deny.
    const known = await get(`/api/sessions/${REMOTE_ID}/retained-transcript?path=x`);
    const unknown = await get("/api/sessions/who-dis/retained-transcript?path=x");
    expect(known.statusCode).toBe(400);
    expect(unknown.statusCode).toBe(400);
  });

  it("cannot be steered to another session by a sessionId query rider", async () => {
    createRemoteTranscriptStore({ homedir: home }).append(REMOTE_ID, TRANSCRIPT, {
      restarted: true,
      complete: true,
    });
    // The subject is the ROUTE parameter. A rider naming a different session
    // must not change which transcript comes back.
    const res = await get(
      `/api/sessions/${REMOTE_ID}/retained-transcript?sessionId=${ARCHIVED_REMOTE_ID}`,
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).data.entries).toEqual(TRANSCRIPT);
  });

  it("reports 503 rather than 200-with-nothing when retention is not wired", async () => {
    const bare = Fastify();
    registerSessionRoutes(bare, {
      sessionManager: sessionManagerStub(),
      eventStore,
      networkGuard: async () => {},
    });
    await bare.ready();
    try {
      const res = await bare.inject({
        method: "GET",
        url: `/api/sessions/${REMOTE_ID}/retained-transcript`,
      });
      // "absent" would be a lie: nothing was consulted.
      expect(res.statusCode).toBe(503);
    } finally {
      await bare.close();
    }
  });
});
