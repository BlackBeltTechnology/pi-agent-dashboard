/**
 * HTTP-level tests for the OpenSpec change-grouping routes.
 *
 * Covers tasks 3.11–3.13 and the spec scenarios under
 * `Requirement: Group CRUD REST routes` and `Requirement: Authentication and cwd validation`.
 *
 * See change: add-openspec-change-grouping.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { registerOpenSpecGroupRoutes } from "../routes/openspec-group-routes.js";
import { createOpenSpecGroupStore, type OpenSpecGroupStore } from "../openspec/openspec-group-store.js";

const PASSTHRU_GUARD = async () => {};
const DENY_GUARD = async (_req: any, reply: any) => {
  reply.code(403).send({ success: false, error: "forbidden" });
};

function makeSessionManager(cwd: string): any {
  return {
    listAll: () => [{ id: "s1", cwd, source: "tui" }],
  };
}
function makePreferencesStore(): any {
  return { getPinnedDirectories: () => [] };
}

describe("openspec group REST routes", () => {
  let tmpDir: string;
  let fastify: FastifyInstance;
  let store: OpenSpecGroupStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ogs-routes-"));
    store = createOpenSpecGroupStore({ debounceMs: 5 });
  });

  afterEach(async () => {
    if (fastify) await fastify.close();
    store.dispose();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function setup(opts: { networkGuard?: any } = {}) {
    fastify = Fastify();
    registerOpenSpecGroupRoutes(fastify, {
      sessionManager: makeSessionManager(tmpDir),
      preferencesStore: makePreferencesStore(),
      networkGuard: opts.networkGuard ?? PASSTHRU_GUARD,
      store,
    });
    await fastify.ready();
  }

  // ── GET ──────────────────────────────────────────────────────

  it("GET → returns the empty default when file is absent", async () => {
    await setup();
    const res = await fastify.inject({
      method: "GET",
      url: `/api/openspec/groups?cwd=${encodeURIComponent(tmpDir)}`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toEqual({
      success: true,
      data: { schemaVersion: 1, groups: [], assignments: {} },
    });
  });

  it("GET → 400 when cwd query is missing", async () => {
    await setup();
    const res = await fastify.inject({ method: "GET", url: "/api/openspec/groups" });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/cwd/i);
  });

  it("GET → 403 when cwd is not in the known-cwd set", async () => {
    await setup();
    const otherDir = await fs.mkdtemp(path.join(os.tmpdir(), "ogs-other-"));
    try {
      const res = await fastify.inject({
        method: "GET",
        url: `/api/openspec/groups?cwd=${encodeURIComponent(otherDir)}`,
      });
      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/cwd/i);
    } finally {
      await fs.rm(otherDir, { recursive: true, force: true });
    }
  });

  it("GET → 422 when on-disk file has unsupported schemaVersion", async () => {
    await setup();
    const file = path.join(tmpDir, "openspec", "groups", "groups.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ schemaVersion: 2, groups: [], assignments: {} }));
    const res = await fastify.inject({
      method: "GET",
      url: `/api/openspec/groups?cwd=${encodeURIComponent(tmpDir)}`,
    });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/schema/i);
  });

  it("network guard 403 short-circuits the route", async () => {
    await setup({ networkGuard: DENY_GUARD });
    const res = await fastify.inject({
      method: "GET",
      url: `/api/openspec/groups?cwd=${encodeURIComponent(tmpDir)}`,
    });
    expect(res.statusCode).toBe(403);
  });

  // ── POST ─────────────────────────────────────────────────────

  it("POST → 201 creates a group with generated id and order=0", async () => {
    await setup();
    const res = await fastify.inject({
      method: "POST",
      url: `/api/openspec/groups?cwd=${encodeURIComponent(tmpDir)}`,
      payload: { name: "UI", color: "#3b82f6" },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ id: "ui", name: "UI", color: "#3b82f6", order: 0 });
  });

  it("POST → collision suffix on duplicate name", async () => {
    await setup();
    await fastify.inject({
      method: "POST",
      url: `/api/openspec/groups?cwd=${encodeURIComponent(tmpDir)}`,
      payload: { name: "UI" },
    });
    const second = await fastify.inject({
      method: "POST",
      url: `/api/openspec/groups?cwd=${encodeURIComponent(tmpDir)}`,
      payload: { name: "UI" },
    });
    expect(second.statusCode).toBe(201);
    expect(JSON.parse(second.payload).data.id).toBe("ui-2");
  });

  it("POST → 400 on missing name", async () => {
    await setup();
    const res = await fastify.inject({
      method: "POST",
      url: `/api/openspec/groups?cwd=${encodeURIComponent(tmpDir)}`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  // ── PATCH ────────────────────────────────────────────────────

  it("PATCH → 200 updates name without changing id", async () => {
    await setup();
    const created = await fastify.inject({
      method: "POST",
      url: `/api/openspec/groups?cwd=${encodeURIComponent(tmpDir)}`,
      payload: { name: "UI" },
    });
    const id = JSON.parse(created.payload).data.id;
    const res = await fastify.inject({
      method: "PATCH",
      url: `/api/openspec/groups/${id}?cwd=${encodeURIComponent(tmpDir)}`,
      payload: { name: "Frontend" },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.id).toBe("ui");
    expect(body.data.name).toBe("Frontend");
  });

  it("PATCH → 404 on unknown id", async () => {
    await setup();
    const res = await fastify.inject({
      method: "PATCH",
      url: `/api/openspec/groups/does-not-exist?cwd=${encodeURIComponent(tmpDir)}`,
      payload: { name: "X" },
    });
    expect(res.statusCode).toBe(404);
  });

  // ── DELETE ───────────────────────────────────────────────────

  it("DELETE → 200 removes group and cascades through assignments", async () => {
    await setup();
    const a = await fastify.inject({
      method: "POST",
      url: `/api/openspec/groups?cwd=${encodeURIComponent(tmpDir)}`,
      payload: { name: "UI" },
    });
    const b = await fastify.inject({
      method: "POST",
      url: `/api/openspec/groups?cwd=${encodeURIComponent(tmpDir)}`,
      payload: { name: "Server" },
    });
    const aId = JSON.parse(a.payload).data.id;
    const bId = JSON.parse(b.payload).data.id;
    await fastify.inject({
      method: "PUT",
      url: `/api/openspec/groups/assignments?cwd=${encodeURIComponent(tmpDir)}`,
      payload: { changeName: "add-foo", groupId: aId },
    });
    await fastify.inject({
      method: "PUT",
      url: `/api/openspec/groups/assignments?cwd=${encodeURIComponent(tmpDir)}`,
      payload: { changeName: "fix-bar", groupId: bId },
    });
    const res = await fastify.inject({
      method: "DELETE",
      url: `/api/openspec/groups/${aId}?cwd=${encodeURIComponent(tmpDir)}`,
    });
    expect(res.statusCode).toBe(200);
    const data = await store.read(tmpDir);
    expect(data.assignments).toEqual({ "fix-bar": bId });
  });

  it("DELETE → 404 on unknown id", async () => {
    await setup();
    const res = await fastify.inject({
      method: "DELETE",
      url: `/api/openspec/groups/does-not-exist?cwd=${encodeURIComponent(tmpDir)}`,
    });
    expect(res.statusCode).toBe(404);
  });

  // ── PUT assignments ──────────────────────────────────────────

  it("PUT → 200 sets assignment", async () => {
    await setup();
    const created = await fastify.inject({
      method: "POST",
      url: `/api/openspec/groups?cwd=${encodeURIComponent(tmpDir)}`,
      payload: { name: "UI" },
    });
    const id = JSON.parse(created.payload).data.id;
    const res = await fastify.inject({
      method: "PUT",
      url: `/api/openspec/groups/assignments?cwd=${encodeURIComponent(tmpDir)}`,
      payload: { changeName: "add-foo", groupId: id },
    });
    expect(res.statusCode).toBe(200);
    const data = await store.read(tmpDir);
    expect(data.assignments).toEqual({ "add-foo": id });
  });

  it("PUT → 200 with null clears the entry", async () => {
    await setup();
    const created = await fastify.inject({
      method: "POST",
      url: `/api/openspec/groups?cwd=${encodeURIComponent(tmpDir)}`,
      payload: { name: "UI" },
    });
    const id = JSON.parse(created.payload).data.id;
    await fastify.inject({
      method: "PUT",
      url: `/api/openspec/groups/assignments?cwd=${encodeURIComponent(tmpDir)}`,
      payload: { changeName: "add-foo", groupId: id },
    });
    const res = await fastify.inject({
      method: "PUT",
      url: `/api/openspec/groups/assignments?cwd=${encodeURIComponent(tmpDir)}`,
      payload: { changeName: "add-foo", groupId: null },
    });
    expect(res.statusCode).toBe(200);
    const data = await store.read(tmpDir);
    expect(data.assignments).toEqual({});
  });

  it("PUT → 422 on unknown groupId", async () => {
    await setup();
    const res = await fastify.inject({
      method: "PUT",
      url: `/api/openspec/groups/assignments?cwd=${encodeURIComponent(tmpDir)}`,
      payload: { changeName: "add-foo", groupId: "does-not-exist" },
    });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/group/i);
  });

  it("PUT → tolerates unknown changeName and persists", async () => {
    await setup();
    const created = await fastify.inject({
      method: "POST",
      url: `/api/openspec/groups?cwd=${encodeURIComponent(tmpDir)}`,
      payload: { name: "UI" },
    });
    const id = JSON.parse(created.payload).data.id;
    const res = await fastify.inject({
      method: "PUT",
      url: `/api/openspec/groups/assignments?cwd=${encodeURIComponent(tmpDir)}`,
      payload: { changeName: "never-existed", groupId: id },
    });
    expect(res.statusCode).toBe(200);
    const data = await store.read(tmpDir);
    expect(data.assignments).toEqual({ "never-existed": id });
  });

  it("PUT → 400 on malformed body", async () => {
    await setup();
    const res = await fastify.inject({
      method: "PUT",
      url: `/api/openspec/groups/assignments?cwd=${encodeURIComponent(tmpDir)}`,
      payload: { changeName: 123, groupId: false },
    });
    expect(res.statusCode).toBe(400);
  });

  // ── 409 ConcurrentEditError mapping ──────────────────────────

  it("POST → 409 with current payload when the store reports a sustained race", async () => {
    fastify = Fastify();
    let strikes = 0;
    const racingStore = createOpenSpecGroupStore({
      debounceMs: 5,
      __testHookBeforeRename: async () => {
        strikes++;
        const file = path.join(tmpDir, "openspec", "groups", "groups.json");
        await fs.mkdir(path.dirname(file), { recursive: true });
        const future = new Date(Date.now() + 60_000 * strikes);
        await fs.writeFile(
          file,
          JSON.stringify({
            schemaVersion: 1,
            groups: [{ id: "external", name: `External-${strikes}`, order: 0 }],
            assignments: {},
          }),
        );
        await fs.utimes(file, future, future);
      },
    });
    try {
      registerOpenSpecGroupRoutes(fastify, {
        sessionManager: makeSessionManager(tmpDir),
        preferencesStore: makePreferencesStore(),
        networkGuard: PASSTHRU_GUARD,
        store: racingStore,
      });
      await fastify.ready();
      const res = await fastify.inject({
        method: "POST",
        url: `/api/openspec/groups?cwd=${encodeURIComponent(tmpDir)}`,
        payload: { name: "UI" },
      });
      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/concurrent/i);
      expect(body.data).toBeDefined();
      expect(body.data.groups).toHaveLength(1);
    } finally {
      racingStore.dispose();
    }
  });
});
