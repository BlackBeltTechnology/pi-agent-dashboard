/**
 * GET /api/sessions/:sessionId/entry/:entryId — full custom-entry payload from
 * the on-disk JSONL (change: add-custom-entry-renderer-slot; spec:
 * dashboard-server).
 *
 * Covers test-plan E12 (untruncated payload; proves it did NOT come from the
 * 4 KB-capped event store) and X4–X9 (unknown / unflushed / off-branch /
 * cross-session / traversal / network-guard negative paths).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import { registerSessionRoutes } from "../routes/session-routes.js";

const PASSTHRU_GUARD = async () => {};

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

type Entry = Record<string, unknown>;

function jsonl(entries: Entry[]): string {
  return entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

describe("GET /api/sessions/:sessionId/entry/:entryId", () => {
  let fastify: FastifyInstance;
  let tmpDir: string;
  let sessionFile: string;
  let sessionFileB: string;
  let manager: { listAll: () => never[]; get: (id: string) => unknown };

  function writeEntries(entries: Entry[]): void {
    writeFileSync(sessionFile, jsonl(entries));
  }

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "custom-entry-"));
    sessionFile = join(tmpDir, "s1.jsonl");
    sessionFileB = join(tmpDir, "s2.jsonl");
    manager = {
      listAll: () => [],
      get: (id: string) =>
        id === "s1"
          ? { id, cwd: "/tmp", sessionFile }
          : id === "s2"
            ? { id, cwd: "/tmp", sessionFile: sessionFileB }
            : undefined,
    };
    fastify = Fastify();
    registerSessionRoutes(fastify, {
      sessionManager: manager as never,
      eventStore: createMemoryEventStore(() => false),
      networkGuard: PASSTHRU_GUARD,
    });
    await fastify.ready();
    vi.mocked(readFileSync).mockClear();
  });

  afterEach(async () => {
    if (fastify) await fastify.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("E12: returns the FULL payload from JSONL, above the 4 KB store cap", async () => {
    const bigData = {
      observations: Array.from({ length: 60 }, (_, i) => ({ content: `obs-${i}-${"x".repeat(200)}` })),
    };
    writeEntries([
      { type: "session", id: "s1", cwd: "/tmp" },
      { type: "custom", id: "abc", parentId: null, customType: "om.observations.recorded", data: bigData },
    ]);

    const res = await fastify.inject({ method: "GET", url: "/api/sessions/s1/entry/abc" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.data.customType).toBe("om.observations.recorded");
    expect(body.data.payload).toEqual(bigData);
    // Byte length exceeds the event store's 4 KB per-string cap.
    expect(JSON.stringify(body.data.payload).length).toBeGreaterThan(4000);
  });

  it("X4: unknown entryId → 404", async () => {
    writeEntries([{ type: "session", id: "s1", cwd: "/tmp" }]);
    const res = await fastify.inject({ method: "GET", url: "/api/sessions/s1/entry/ghost" });
    expect(res.statusCode).toBe(404);
  });

  it("X5: an unflushed entry is a 404; a later request after the flush returns 200", async () => {
    writeEntries([{ type: "session", id: "s1", cwd: "/tmp" }]);
    const first = await fastify.inject({ method: "GET", url: "/api/sessions/s1/entry/late" });
    expect(first.statusCode).toBe(404);

    // The flush appends the entry (a later assistant message would do this in pi).
    writeEntries([
      { type: "session", id: "s1", cwd: "/tmp" },
      { type: "custom", id: "late", parentId: null, customType: "om.reflections.recorded", data: { reflections: [] } },
    ]);
    const second = await fastify.inject({ method: "GET", url: "/api/sessions/s1/entry/late" });
    expect(second.statusCode).toBe(200);
  });

  it("X6: an entry outside the active leaf→root branch → 404", async () => {
    writeEntries([
      { type: "session", id: "s1", cwd: "/tmp" },
      { type: "custom", id: "e1", parentId: null, customType: "om.x", data: {} },
      { type: "custom", id: "on-branch", parentId: "e1", customType: "om.x", data: { on: true } },
      { type: "custom", id: "off-branch", parentId: "e1", customType: "om.x", data: { off: true } },
      { type: "custom", id: "leaf", parentId: "on-branch", customType: "om.x", data: {} },
    ]);
    expect((await fastify.inject({ method: "GET", url: "/api/sessions/s1/entry/off-branch" })).statusCode).toBe(404);
    expect((await fastify.inject({ method: "GET", url: "/api/sessions/s1/entry/on-branch" })).statusCode).toBe(200);
  });

  it("X7: a valid entryId from a DIFFERENT session is not returned under this one", async () => {
    writeEntries([
      { type: "session", id: "s1", cwd: "/tmp" },
      { type: "custom", id: "s1-entry", parentId: null, customType: "om.x", data: { mine: true } },
    ]);
    // Session B holds a real entry with a distinct id + payload.
    writeFileSync(
      sessionFileB,
      jsonl([
        { type: "session", id: "s2", cwd: "/tmp" },
        { type: "custom", id: "s2-entry", parentId: null, customType: "om.x", data: { secret: "session-B-only" } },
      ]),
    );
    const res = await fastify.inject({ method: "GET", url: "/api/sessions/s1/entry/s2-entry" });
    expect(res.statusCode).toBe(404);
    // Session B's payload is NOT returned.
    expect(res.payload).not.toContain("session-B-only");
    // ...and the same id resolves fine under its OWN session.
    const ok = await fastify.inject({ method: "GET", url: "/api/sessions/s2/entry/s2-entry" });
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.payload).data.payload).toEqual({ secret: "session-B-only" });
  });

  it("X8: traversal-shaped identifiers are rejected and read only the addressed session file", async () => {
    writeEntries([
      { type: "session", id: "s1", cwd: "/tmp" },
      { type: "custom", id: "safe", parentId: null, customType: "om.x", data: {} },
    ]);
    for (const evil of ["..%2F..%2Fetc%2Fpasswd", "..%2f..%2fetc%2fpasswd", "a%2Fb"]) {
      const res = await fastify.inject({ method: "GET", url: `/api/sessions/s1/entry/${evil}` });
      expect(res.statusCode, evil).toBe(404);
    }
    // A spied reader proves no filesystem path outside the addressed session
    // was read: every readFileSync call targeted the session file.
    const paths = vi.mocked(readFileSync).mock.calls.map((c) => String(c[0]));
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => p === sessionFile)).toBe(true);
  });

  it("X9: the route is guarded by the shared network guard", async () => {
    writeEntries([{ type: "session", id: "s1", cwd: "/tmp" }]);
    const guarded = Fastify();
    registerSessionRoutes(guarded, {
      sessionManager: manager as never,
      eventStore: createMemoryEventStore(() => false),
      networkGuard: async (_req, reply) => {
        reply.code(403).send({ error: "forbidden" });
      },
    });
    await guarded.ready();
    const res = await guarded.inject({ method: "GET", url: "/api/sessions/s1/entry/abc" });
    expect(res.statusCode).toBe(403);
    await guarded.close();
  });
});
